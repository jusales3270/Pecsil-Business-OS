#!/usr/bin/env node
/**
 * Consulta o Clef (Cloudflare Workers AI) e imprime a resposta DELE em AZUL.
 *
 * Regra da casa (CLAUDE.md, "Modelo de decisão fala em azul"): tudo que sai do modelo
 * aparece em azul; o que é do Claude segue na cor normal. Erro de rede ou de chave sai
 * sem azul, porque é falha do serviço, não julgamento do modelo. O texto passa antes pelo
 * mesmo filtro de dado pessoal da plataforma (CPF, PIS, CID, e-mail, telefone).
 *
 *   node scripts/clef.mjs [--modelo clef] "<estado/texto>" <pergunta...>
 *
 * Perguntas (mesmo formato do scripts/jev.mjs):
 *   noul:<nome>=<pergunta>[|<quando é verdade>;<quando é falso>]
 *   choice:<nome>=<pergunta>|<opção[:descrição]>,<opção[:descrição]>,...
 *   score:<nome>=<pergunta>|<nível menor>,<nível médio>,<nível maior>
 *
 * Exemplo:
 *   node scripts/clef.mjs "MIRAI METALS & MINERALS LTDA | MIRAI METAIS" \
 *     "noul:mesma_empresa=Os dois nomes se referem à mesma empresa?"
 */
import { existsSync, readFileSync } from "node:fs";
import { filtrarEstado } from "../lib/decisao/guard.ts";
import { consultar, lerResposta, montarPedido, urlClef } from "../lib/decisao/core.ts";

const AZUL = "\x1b[38;5;39m", AZUL_FORTE = "\x1b[1;38;5;33m", CINZA = "\x1b[2m", FIM = "\x1b[0m";
const azul = (t) => `${AZUL}${t}${FIM}`;
const cinza = (t) => `${CINZA}${t}${FIM}`;
const pct = (v) => `${Math.round(v * 100)}%`;

function lerEnv() {
  const env = { ...process.env };
  if (existsSync(".env.local")) {
    for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
      const i = linha.indexOf("=");
      if (i > 0 && !linha.trim().startsWith("#")) env[linha.slice(0, i).trim()] ??= linha.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return env;
}

function opcao(item) {
  const sep = item.indexOf(":");
  const rotulo = (sep < 0 ? item : item.slice(0, sep)).trim();
  const descricao = sep < 0 ? rotulo : item.slice(sep + 1).trim();
  return [rotulo, descricao || rotulo];
}

export function interpretar(argumento) {
  const igual = argumento.indexOf("=");
  if (igual < 0) throw new Error(`Pergunta sem "=": ${argumento}`);
  const [tipo, nome] = argumento.slice(0, igual).split(":");
  const corpo = argumento.slice(igual + 1);
  const barra = corpo.indexOf("|");
  const instructions = (barra < 0 ? corpo : corpo.slice(0, barra)).trim();
  const extras = barra < 0 ? "" : corpo.slice(barra + 1).trim();
  if (tipo === "noul") {
    const [verdadeiro, falso] = extras ? extras.split(";").map((s) => s.trim()) : ["sim", "não"];
    return [nome, { type: "noul", instructions, criteria: { true: verdadeiro || "sim", false: falso || "não" } }];
  }
  if (tipo === "choice") {
    if (!extras) throw new Error(`"choice" precisa das opções depois de "|": ${argumento}`);
    return [nome, { type: "choice", instructions, criteria: Object.fromEntries(extras.split(",").map(opcao)) }];
  }
  if (tipo === "score") {
    const niveis = extras.split(",").map((n) => n.trim()).filter(Boolean);
    if (niveis.length < 2) throw new Error(`"score" precisa de 2 a 10 níveis em ordem: ${argumento}`);
    return [nome, { type: "score", instructions, criteria: niveis }];
  }
  throw new Error(`Tipo desconhecido "${tipo}" (use noul, choice ou score).`);
}

function mostrar(nome, r) {
  const titulo = `${AZUL_FORTE}  ${nome}:${FIM}`;
  const conf = cinza(` (confiança ${pct(r.confianca)})`);
  if (r.type === "noul") return [`${titulo} ${azul(`${r.valor >= 0.8 ? "sim" : r.valor <= 0.2 ? "não" : "incerto"} · ${pct(r.valor)}`)}${conf}`];
  if (r.type === "choice") {
    const dist = Object.entries(r.probabilidades).filter(([, v]) => v > 0.005).sort(([, a], [, b]) => b - a).map(([k, v]) => `${k} ${pct(v)}`).join(" · ");
    return [`${titulo} ${azul(r.escolha)}${conf}`, dist ? cinza(`    ${dist}`) : ""];
  }
  return [`${titulo} ${azul(`${r.nota.toFixed(2)}${r.nivel ? ` · ${r.nivel}` : ""}`)}${conf}`];
}

const args = process.argv.slice(2);
let modelo = "clef-flash";
if (args[0] === "--modelo") { modelo = args[1] === "clef" ? "clef" : "clef-flash"; args.splice(0, 2); }
const [estado, ...perguntas] = args;
if (!estado || perguntas.length === 0) {
  console.error('Uso: node scripts/clef.mjs [--modelo clef] "<texto>" "noul:nome=pergunta" ["choice:nome=pergunta|a,b"] ["score:nome=pergunta|baixo,alto"]');
  process.exit(2);
}
const env = lerEnv();
if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_TOKEN) {
  console.error("CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN não encontrados (.env.local ou ambiente).");
  process.exit(2);
}
const filtro = filtrarEstado(estado);
if (!filtro.ok) {
  console.error(`Não enviado: o texto tem ${filtro.motivos.join(", ")}. Tire o dado pessoal e tente de novo.`);
  process.exit(3);
}

let questions;
try { questions = Object.fromEntries(perguntas.map(interpretar)); } catch (e) { console.error(e.message); process.exit(2); }

try {
  const { json, ms } = await consultar({ fetch, url: urlClef(env.CLOUDFLARE_ACCOUNT_ID, modelo), token: env.CLOUDFLARE_AI_TOKEN, corpo: montarPedido(estado, questions) });
  const { respostas, tokens } = lerResposta(json);
  console.log(`${AZUL_FORTE}▌ Clef${FIM} ${cinza(`(${modelo} · resposta em azul)`)}`);
  for (const [nome, r] of Object.entries(respostas)) for (const linha of mostrar(nome, r)) if (linha) console.log(linha);
  console.log(cinza(`  ${ms} ms${tokens ? ` · ${tokens} tokens` : ""}`));
} catch (e) {
  console.error(`Clef: ${e.message}`);
  process.exit(1);
}
