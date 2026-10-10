#!/usr/bin/env node
/**
 * Simula um uso do modelo de decisão (Clef) sobre uma lista de casos, SEM GRAVAR NADA no
 * banco (PLANO-JEV, seção 6, passo 4). Gera um relatório HTML em ~/Downloads para o
 * proprietário marcar o que o modelo acertou — é assim que se calibram os limites antes
 * de ligar um uso.
 *
 *   node scripts/decisao-simular.mjs --casos casos.json [--modelo clef] [--alto 0.8] [--baixo 0.4] [--titulo "..."]
 *
 * casos.json:
 *   { "pergunta": { "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } },
 *     "casos": [ { "id": "1", "estado": "texto", "esperado": "opcional" }, ... ] }
 *
 * Todo estado passa pelo filtro de dado pessoal; o que for bloqueado não é enviado.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { filtrarEstado } from "../lib/decisao/guard.ts";
import { confiancaGeral, consultar, faixa, lerResposta, montarPedido, urlClef } from "../lib/decisao/core.ts";

const arg = (nome, padrao) => { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : padrao; };
const arquivo = arg("casos");
if (!arquivo || !existsSync(arquivo)) { console.error("Uso: node scripts/decisao-simular.mjs --casos <arquivo.json> [--modelo clef]"); process.exit(2); }
const modelo = arg("modelo") === "clef" ? "clef" : "clef-flash";
const limites = { alto: Number(arg("alto", "0.8")), baixo: Number(arg("baixo", "0.4")) };
const { pergunta, casos, titulo: tituloArquivo } = JSON.parse(readFileSync(arquivo, "utf8"));
const titulo = arg("titulo", tituloArquivo ?? "Simulação do modelo de decisão");

const env = { ...process.env };
if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.trim().startsWith("#")) env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); }
if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_TOKEN) { console.error("Faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN."); process.exit(2); }

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const linhas = [];
const tempos = [];
for (const [n, caso] of casos.entries()) {
  const filtro = filtrarEstado(caso.estado);
  if (!filtro.ok) { linhas.push({ caso, bloqueado: filtro.motivos.join(", ") }); continue; }
  try {
    const { json, ms } = await consultar({ fetch, url: urlClef(env.CLOUDFLARE_ACCOUNT_ID, modelo), token: env.CLOUDFLARE_AI_TOKEN, corpo: montarPedido(caso.estado, { resposta: pergunta }) });
    const { respostas } = lerResposta(json);
    const r = respostas.resposta;
    const conf = confiancaGeral(respostas);
    tempos.push(ms);
    const texto = r.type === "noul" ? `${r.valor >= 0.8 ? "sim" : r.valor <= 0.2 ? "não" : "incerto"} · ${Math.round(r.valor * 100)}%` : r.type === "choice" ? r.escolha : `${r.nota.toFixed(2)}${r.nivel ? ` · ${r.nivel}` : ""}`;
    linhas.push({ caso, texto, conf, faixa: faixa(conf, limites), ms });
  } catch (e) {
    linhas.push({ caso, erro: e.message });
  }
  process.stdout.write(`\r${n + 1}/${casos.length}`);
}
process.stdout.write("\n");

const conta = (f) => linhas.filter((l) => l.faixa === f).length;
const media = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : 0;
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px}p{color:#555}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f4f7}.azul{color:#1f6feb;font-weight:600}.alta{background:#eaf7ee}.media{background:#fff8e6}.baixa{background:#fdecec}small{color:#777}</style></head><body>
<h1>${esc(titulo)}</h1>
<p>Modelo <b>${modelo}</b> · ${casos.length} casos · faixas: alta ${conta("alta")}, média ${conta("media")}, baixa ${conta("baixa")} · bloqueados pelo filtro ${linhas.filter((l) => l.bloqueado).length} · erros ${linhas.filter((l) => l.erro).length} · tempo médio ${media} ms.<br>
Nada foi gravado no banco. A resposta do modelo está <span class="azul">em azul</span>: é sugestão, não dado apurado. Marque a coluna "Acertou?" e devolva para calibrar os limites (alto ${limites.alto}, baixo ${limites.baixo}).</p>
<p><b>Pergunta:</b> ${esc(pergunta.instructions)}</p>
<table><tr><th>#</th><th>Estado enviado</th><th>Resposta do modelo</th><th>Confiança</th><th>Esperado</th><th>Acertou?</th></tr>
${linhas.map((l, i) => `<tr class="${l.faixa ?? ""}"><td>${esc(l.caso.id ?? i + 1)}</td><td>${esc(l.caso.estado)}</td><td>${l.bloqueado ? `<small>não enviado: ${esc(l.bloqueado)}</small>` : l.erro ? `<small>erro: ${esc(l.erro)}</small>` : `<span class="azul">${esc(l.texto)}</span>`}</td><td>${l.conf !== undefined ? `${Math.round(l.conf * 100)}% <small>(${l.faixa})</small>` : ""}</td><td>${esc(l.caso.esperado ?? "")}</td><td><label><input type="checkbox"> sim</label></td></tr>`).join("\n")}
</table></body></html>`;
const destino = join(homedir(), "Downloads", `${titulo.replace(/[^\p{L}\p{N} -]/gu, "").slice(0, 60)} ${new Date().toISOString().slice(0, 10)}.html`);
writeFileSync(destino, html);
console.log(`Relatório: ${destino}`);
console.log(`Faixas: alta ${conta("alta")} · média ${conta("media")} · baixa ${conta("baixa")} · bloqueados ${linhas.filter((l) => l.bloqueado).length} · erros ${linhas.filter((l) => l.erro).length} · ${media} ms em média`);
