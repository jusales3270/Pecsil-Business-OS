#!/usr/bin/env node
/**
 * Etapa 0 do roteador de modelo e esforço (I-32, docs/PLANO-SARA-ROTEADOR.md): MEDIR antes de mudar. Só leitura.
 * Lê as perguntas feitas à SARA nos últimos N dias, roda o classificador de nível em cada uma (chamada curta no
 * Haiku) e compara o custo de hoje com o custo pela política padrão (lib/sara/politica.ts). Sai um relatório HTML
 * com o resumo por nível, por área e exemplos de cada nível, para o proprietário julgar antes de fixar os padrões.
 *
 * Uso: node --env-file=.env.local scripts/medir-nivel-sara.mjs --saida <arquivo.html> [--dias 60] [--url http://...:8000]
 * Precisa de SUPABASE_SERVICE_ROLE_KEY (leitura) e ANTHROPIC_API_KEY (classificador). Nada é gravado no banco.
 * O relatório tem perguntas reais da equipe: fica no computador de quem roda, nunca no repositório.
 */
import { writeFileSync } from "node:fs";
import { chamarClaude } from "../lib/sara/motor/anthropic.ts";
import { classificacaoDe, nivelFinal, NIVEIS, pedidoDoClassificador, ROTULO_NIVEL, MODELO_CLASSIFICADOR } from "../lib/sara/nivel.ts";
import { POLITICA_PADRAO, escolhaDoNivel } from "../lib/sara/politica.ts";
import { custoUsd, cotacao, emReais } from "../lib/sara/custo.ts";
import { doCatalogo } from "../lib/sara/modelos.ts";

const arg = (n, padrao) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : padrao; };
const DIAS = Math.max(1, Math.min(365, Number(arg("dias", "60")) || 60));
const URL_BANCO = arg("url", process.env.SUPABASE_INTERNAL_URL || "http://181.224.8.145:8000");
const SAIDA = arg("saida", "");
const chaveBanco = process.env.SUPABASE_SERVICE_ROLE_KEY, chaveIa = process.env.ANTHROPIC_API_KEY?.trim();
if (!SAIDA || !chaveBanco || !chaveIa) { console.error("Uso: node --env-file=.env.local scripts/medir-nivel-sara.mjs --saida <arquivo.html> [--dias 60]"); process.exit(1); }
const COT = cotacao(process.env.SARA_COTACAO_USD);

async function consulta(sql) {
  const r = await fetch(`${URL_BANCO}/pg/query`, { method: "POST", headers: { apikey: chaveBanco, authorization: `Bearer ${chaveBanco}`, "content-type": "application/json" }, body: JSON.stringify({ query: sql }) });
  if (!r.ok) throw new Error(`banco ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const linhas = await consulta(`select m.conversa_id, c.modulo, m.papel, m.texto, m.modelo, m.tokens_entrada, m.tokens_saida,
  m.ferramentas->'cache' as cache, m.ferramentas->'subagentes' as subagentes, (m.ferramentas->'tempos'->>'total_ms')::int as ms, m.created_at
  from sara_mensagens m join sara_conversas c on c.id = m.conversa_id
  where m.created_at > now() - interval '${DIAS} days'
  order by m.conversa_id, m.created_at, (m.papel = 'pessoa') desc`);

// Pergunta + resposta da SARA, com a resposta anterior da mesma conversa (para a continuação curta).
const pares = [], bomDia = [];
for (let i = 0; i < linhas.length - 1; i++) {
  const p = linhas[i], s = linhas[i + 1];
  if (p.papel !== "pessoa" || s.papel !== "sara" || p.conversa_id !== s.conversa_id) continue;
  // O "☀️ Bom dia" é rotina automática (trabalho fixo, sempre no nível rápido), não pergunta de alguém.
  if (String(p.texto ?? "").startsWith("☀️")) { bomDia.push(s); continue; }
  const anterior = [...linhas.slice(0, i)].reverse().find((x) => x.conversa_id === p.conversa_id && x.papel === "sara");
  pares.push({ modulo: p.modulo, conversa: p.conversa_id, pergunta: String(p.texto ?? ""), ultima: anterior?.texto ?? null, resposta: s });
}
console.log(`${pares.length} perguntas em ${DIAS} dias (fora ${bomDia.length} Bom dia automáticos); classificando…`);

const usoDe = (modelo, entrada, saida, cache) => ({ modelo, tokens_entrada: Number(entrada) || 0, tokens_saida: Number(saida) || 0, cache_lido: Number(cache?.lido) || 0, cache_gravado: Number(cache?.gravado) || 0 });
const subCusto = (subs) => (Array.isArray(subs) ? subs : []).reduce((t, x) => t + custoUsd(usoDe(x.modelo, x.tokensEntrada, x.tokensSaida, { lido: x.cacheLido, gravado: x.cacheGravado })), 0);

let custoClassificador = 0, falhas = 0;
const resultados = new Array(pares.length);
let proximo = 0;
async function trabalhador() {
  while (proximo < pares.length) {
    const i = proximo++, par = pares[i];
    const texto = par.pergunta;
    const ctx = { pergunta: texto.replace(/^[📷🎤📎]\s*/u, ""), ultimaResposta: par.ultima, central: par.modulo === "warroom", imagem: texto.startsWith("📷"), anexo: texto.startsWith("📎"), canal: texto.startsWith("🎤") ? "voz" : null };
    const r = await chamarClaude(pedidoDoClassificador(ctx), { chave: chaveIa, timeoutMs: 20_000 }).catch(() => null);
    const c = r?.ok ? classificacaoDe(r.mensagem) : null;
    if (r?.ok) custoClassificador += custoUsd(usoDe(MODELO_CLASSIFICADOR, r.mensagem.usage.input_tokens, r.mensagem.usage.output_tokens, null));
    if (!c) falhas++;
    resultados[i] = { ...par, c };
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${pares.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, trabalhador));

// Nível final (continuação curta herda o anterior da mesma conversa; o proprietário pode o profundo).
const anteriorPorConversa = new Map();
for (const r of resultados) {
  r.nivel = nivelFinal(r.c, { anterior: anteriorPorConversa.get(r.conversa) ?? null, pergunta: r.pergunta, podeProfundo: true, padrao: "padrao" });
  anteriorPorConversa.set(r.conversa, r.nivel);
  const s = r.resposta;
  r.real = custoUsd(usoDe(s.modelo, s.tokens_entrada, s.tokens_saida, s.cache)) + subCusto(s.subagentes);
  const e = escolhaDoNivel(POLITICA_PADRAO, r.nivel);
  const base = custoUsd(usoDe(e.modelo, s.tokens_entrada, s.tokens_saida, s.cache)) + subCusto(s.subagentes);
  // O pensar adaptativo (Opus, Fable) escreve mais tokens de saída: estimativa conservadora de 3× a saída.
  const pensa = doCatalogo(e.modelo)?.pensarMinimo === "adaptive";
  r.projetado = base;
  r.projetadoComPensar = pensa ? base + custoUsd(usoDe(e.modelo, 0, (Number(s.tokens_saida) || 0) * 2, null)) : base;
  r.escolha = e;
  r.ms = Number(s.ms) || null;
}

// ---- relatório ----
const mes = 30 / DIAS;
const reaisDe = (usd) => emReais(usd, COT).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const soma = (xs, f) => xs.reduce((t, x) => t + f(x), 0);
const mediana = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const porNivel = NIVEIS.map((n) => { const xs = resultados.filter((r) => r.nivel === n); return { n, xs }; });
const modulos = [...new Set(resultados.map((r) => r.modulo))].sort();
const total = { real: soma(resultados, (r) => r.real), proj: soma(resultados, (r) => r.projetado), projP: soma(resultados, (r) => r.projetadoComPensar) };

const linhaNivel = ({ n, xs }) => `<tr><td><b>${ROTULO_NIVEL[n]}</b><small>${esc(escolhaDoNivel(POLITICA_PADRAO, n).modelo.replace("claude-", ""))} · ${escolhaDoNivel(POLITICA_PADRAO, n).esforco}</small></td>
  <td class="n">${xs.length}</td><td class="n">${resultados.length ? Math.round((xs.length / resultados.length) * 100) : 0}%</td>
  <td class="n">${reaisDe(soma(xs, (r) => r.real) * mes)}</td><td class="n">${reaisDe(soma(xs, (r) => r.projetado) * mes)}</td><td class="n">${reaisDe(soma(xs, (r) => r.projetadoComPensar) * mes)}</td>
  <td class="n">${mediana(xs.map((r) => r.ms)) != null ? `${(mediana(xs.map((r) => r.ms)) / 1000).toFixed(1)} s` : "—"}</td><td class="n">${xs.filter((r) => r.c?.risco).length}</td></tr>`;
const linhaModulo = (m) => { const xs = resultados.filter((r) => r.modulo === m); return `<tr><td>${esc(m)}</td>${NIVEIS.map((n) => `<td class="n">${xs.filter((r) => r.nivel === n).length || ""}</td>`).join("")}<td class="n">${reaisDe(soma(xs, (r) => r.real) * mes)}</td><td class="n">${reaisDe(soma(xs, (r) => r.projetadoComPensar) * mes)}</td></tr>`; };
const exemplos = ({ n, xs }) => `<h3>${ROTULO_NIVEL[n]} <small>(${xs.length})</small></h3>${xs.length ? `<ul>${xs.slice(0, 10).map((r) => `<li><span class="mod">${esc(r.modulo)}</span> ${esc(r.pergunta.slice(0, 220))}${r.pergunta.length > 220 ? "…" : ""}<small>${esc(r.c?.motivo ?? "sem classificação: ficou no padrão")}${r.c?.risco ? " · risco" : ""} · hoje: ${esc(String(r.resposta.modelo ?? "").replace("claude-", ""))}</small></li>`).join("")}</ul>` : "<p class=\"vazio\">Nenhuma pergunta.</p>"}`;

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roteador da SARA — medição</title>
<style>:root{--fundo:#f6f7f9;--cartao:#fff;--texto:#1b1f24;--suave:#5b6470;--linha:#e3e6ea;--acento:#2457c5}
@media (prefers-color-scheme:dark){:root{--fundo:#111418;--cartao:#1a1f25;--texto:#e7eaee;--suave:#9aa3ad;--linha:#2a3038;--acento:#7aa2ff}}
body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1060px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 10px}h3{font-size:15px;margin:22px 0 6px}small{display:block;color:var(--suave);font-size:12.5px}
.cartao{background:var(--cartao);border:1px solid var(--linha);border-radius:12px;padding:16px;margin:12px 0;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:640px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--linha);vertical-align:top}th{font-size:12.5px;color:var(--suave);font-weight:600}td.n,th.n{text-align:right;white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.kpi b{font-size:22px;display:block}.kpi span{color:var(--suave);font-size:13px}
ul{padding-left:18px}li{margin:8px 0}.mod{font-size:11.5px;border:1px solid var(--linha);border-radius:6px;padding:1px 6px;margin-right:6px;color:var(--suave)}.vazio{color:var(--suave)}
.nota{color:var(--suave);font-size:13.5px}</style></head><body><main>
<h1>Roteador de modelo e esforço da SARA — medição</h1>
<small>Etapa 0 (I-32): só leitura. ${resultados.length} perguntas dos últimos ${DIAS} dias (fora ${bomDia.length} "Bom dia" automáticos, que ficam sempre no nível rápido), classificadas em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Valores por mês (o período foi ajustado para 30 dias), dólar a ${COT.toLocaleString("pt-BR")}.</small>
<div class="kpis cartao"><div class="kpi"><b>${reaisDe(total.real * mes)}</b><span>custo de hoje por mês</span></div>
<div class="kpi"><b>${reaisDe(total.proj * mes)}</b><span>com o roteador (mesmo volume de texto)</span></div>
<div class="kpi"><b>${reaisDe(total.projP * mes)}</b><span>com o roteador, contando o pensar do Opus (estimativa: saída ×3)</span></div>
<div class="kpi"><b>${reaisDe(custoClassificador * mes)}</b><span>custo do classificador por mês</span></div></div>
<p class="nota">A política medida é a padrão proposta: rápido = Haiku low; padrão = Sonnet medium; critério = Opus medium; profundo = Opus high. As SARAs das áreas que a central consulta continuam no Haiku. ${falhas ? `${falhas} perguntas não foram classificadas e ficaram no nível padrão.` : "Todas as perguntas foram classificadas."}</p>
<h2>Por nível</h2><div class="cartao"><table><thead><tr><th>Nível · modelo e esforço</th><th class="n">Perguntas</th><th class="n">%</th><th class="n">Hoje/mês</th><th class="n">Roteador/mês</th><th class="n">Com pensar/mês</th><th class="n">Tempo hoje (mediana)</th><th class="n">Com risco</th></tr></thead><tbody>${porNivel.map(linhaNivel).join("")}</tbody></table></div>
<h2>Por área</h2><div class="cartao"><table><thead><tr><th>SARA</th>${NIVEIS.map((n) => `<th class="n">${ROTULO_NIVEL[n]}</th>`).join("")}<th class="n">Hoje/mês</th><th class="n">Roteador com pensar/mês</th></tr></thead><tbody>${modulos.map(linhaModulo).join("")}</tbody></table></div>
<h2>Exemplos de cada nível (para conferir se a classificação faz sentido)</h2><div class="cartao">${porNivel.map(exemplos).join("")}</div>
<p class="nota">Como ler: "Roteador/mês" troca só o preço do modelo, com o mesmo volume de texto de hoje. "Com pensar" soma a estimativa do raciocínio do Opus, que escreve mais. O número real só aparece no modo sombra (Etapa 3), que registra o que o roteador escolheria em cada pergunta nova.</p>
</main></body></html>`;
writeFileSync(SAIDA, html);
console.log(`Relatório: ${SAIDA}`);
console.log(`Hoje/mês ${reaisDe(total.real * mes)} · roteador ${reaisDe(total.proj * mes)} · com pensar ${reaisDe(total.projP * mes)} · classificador ${reaisDe(custoClassificador * mes)}`);
console.log(porNivel.map(({ n, xs }) => `${n}: ${xs.length}`).join(" · "));
