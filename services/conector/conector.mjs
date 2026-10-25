#!/usr/bin/env node
/**
 * Serviço conector do Pecsil Business OS (docs/PLANO-CONECTOR.md). Roda perto da fonte (na Pecsil, no servidor da
 * plataforma, na rede do GRV), lê só com usuário de leitura e manda para a área de chegada.
 *
 *   node conector.mjs              laço: pergunta a tarefa, descobre o esquema (se pedido), extrai os objetos, espera
 *   node conector.mjs uma-vez      uma rodada e sai
 *   node conector.mjs sondar HOST  quais portas de banco respondem no servidor HOST (não precisa da plataforma)
 *
 * Variáveis: PLATAFORMA_URL, CONECTOR_FONTE, CONECTOR_SEGREDO; ORIGEM_TIPO (firebird|sqlserver|postgres|mysql),
 * ORIGEM_HOST, ORIGEM_PORTA, ORIGEM_BANCO (no Firebird, o caminho do .FDB), ORIGEM_USUARIO, ORIGEM_SENHA,
 * ORIGEM_CHARSET (Firebird, padrão WIN1252); PORTA_SAUDE (padrão 3200), TAMANHO_LOTE (padrão 500).
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { criarDriver } from "./drivers/index.mjs";
import { consultaSoLeitura } from "./leitura.mjs";
import { plataforma, VERSAO } from "./plataforma.mjs";
import { sondar } from "./sondar.mjs";
import { registro } from "./valores.mjs";

export function lerConfig(env) {
  const faltam = ["PLATAFORMA_URL", "CONECTOR_FONTE", "CONECTOR_SEGREDO", "ORIGEM_TIPO", "ORIGEM_HOST", "ORIGEM_BANCO", "ORIGEM_USUARIO", "ORIGEM_SENHA"].filter((k) => !env[k]?.trim());
  if (faltam.length) throw new Error(`Faltam as variáveis: ${faltam.join(", ")}.`);
  return {
    plataforma: { url: env.PLATAFORMA_URL.trim(), fonte: env.CONECTOR_FONTE.trim(), segredo: env.CONECTOR_SEGREDO.trim() },
    origem: { tipo: env.ORIGEM_TIPO.trim().toLowerCase(), host: env.ORIGEM_HOST.trim(), porta: env.ORIGEM_PORTA ? Number(env.ORIGEM_PORTA) : undefined, banco: env.ORIGEM_BANCO.trim(),
      usuario: env.ORIGEM_USUARIO.trim(), senha: env.ORIGEM_SENHA, charset: env.ORIGEM_CHARSET?.trim() || undefined },
    tamanho: Math.min(1000, Math.max(50, Number(env.TAMANHO_LOTE) || 500)),
    portaSaude: Number(env.PORTA_SAUDE) || 3200,
  };
}

/** Mensagem de erro sem a senha do banco nem o segredo (para log e para a plataforma). */
export function semSegredos(msg, cfg) {
  let m = String(msg ?? "");
  for (const s of [cfg?.origem?.senha, cfg?.plataforma?.segredo]) if (s && s.length >= 4) m = m.split(s).join("***");
  return m.slice(0, 500);
}

/** Uma rodada: a tarefa, a descoberta (se pedida) e cada objeto em lotes. Devolve o intervalo até a próxima. */
export async function rodada(cfg, { plat = plataforma(cfg.plataforma), driver: fabrica = criarDriver, log = console.log } = {}) {
  const t = await plat.tarefa();
  if (!t?.ativo) { log("Fonte desativada na plataforma: nada a fazer."); return { intervalo: t?.intervalo_min ?? 60, enviados: 0 }; }
  const driver = await fabrica(cfg.origem);
  let enviados = 0;
  try {
    if (t.descobrir) {
      const d = await driver.descobrir();
      await plat.descoberta(d);
      log(`Descoberta enviada: ${d.tabelas.length} tabelas.`);
    }
    for (const o of t.objetos ?? []) {
      const c = consultaSoLeitura(o.consulta);
      if (!c.ok) { await plat.erro(`${o.nome}: ${c.erro}`); log(`${o.nome}: recusado (${c.erro}).`); continue; }
      let deslocamento = 0;
      for (;;) {
        const linhas = await driver.ler(c.consulta, cfg.tamanho, deslocamento);
        if (!linhas.length) break;
        const r = await plat.lote(o.nome, linhas.map(registro));
        enviados += linhas.length;
        log(`${o.nome}: ${linhas.length} enviados (${r?.novos ?? 0} novos, ${r?.alterados ?? 0} alterados, ${r?.iguais ?? 0} iguais).`);
        deslocamento += linhas.length;
        if (linhas.length < cfg.tamanho) break;
      }
    }
  } finally { await driver.fechar(); }
  return { intervalo: t.intervalo_min ?? 60, enviados };
}

async function laco(cfg) {
  const plat = plataforma(cfg.plataforma);
  const estado = { versao: VERSAO, inicio: new Date().toISOString(), ultima_rodada: null, erro: null };
  // Saúde para o Coolify (sem segredo nenhum na resposta).
  http.createServer((req, res) => {
    res.writeHead(req.url === "/saude" ? 200 : 404, { "content-type": "application/json" });
    res.end(req.url === "/saude" ? JSON.stringify(estado) : "{}");
  }).listen(cfg.portaSaude);
  for (;;) {
    let espera = 60;
    try {
      const r = await rodada(cfg, { plat });
      estado.ultima_rodada = new Date().toISOString(); estado.erro = null; espera = r.intervalo;
    } catch (e) {
      const msg = semSegredos(e instanceof Error ? e.message : e, cfg);
      estado.erro = msg;
      console.error(`Rodada falhou: ${msg}`);
      if (!e?.definitivo) await plat.erro(msg);
      espera = 5;
    }
    await new Promise((r) => setTimeout(r, espera * 60_000));
  }
}

const [, , modo, alvo] = process.argv;
// Rodando direto (node conector.mjs …), não importado pelos testes. O caminho pode vir relativo ou com espaços.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (modo === "sondar") {
    if (!alvo) { console.error("Uso: node conector.mjs sondar HOST"); process.exit(2); }
    for (const p of await sondar(alvo)) console.log(`${p.aberta ? "ABERTA " : "fechada"}  ${String(p.porta).padEnd(5)} ${p.banco}`);
  } else {
    let cfg;
    try { cfg = lerConfig(process.env); } catch (e) { console.error(e.message); process.exit(2); }
    if (modo === "uma-vez") {
      try { const r = await rodada(cfg); console.log(`Rodada feita: ${r.enviados} registros enviados.`); }
      catch (e) { console.error(`Rodada falhou: ${semSegredos(e.message, cfg)}`); process.exit(1); }
    } else await laco(cfg);
  }
}
