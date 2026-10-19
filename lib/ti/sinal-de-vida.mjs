/**
 * Sinal de vida do servidor da fábrica para o vigia externo (T-03, docs/PLANO-TI.md §3.1).
 *
 * Roda a cada minuto como tarefa do Coolify dentro do contêiner do Business OS
 * (scripts/ti-sinal-cron.mjs). Leva junto o tempo ligado do servidor, a carga, a
 * memória e o disco livres, e se a plataforma, o banco e a Forja respondem por
 * dentro. Se o sinal parar, o vigia na nuvem abre o incidente; o tempo ligado é o
 * que mostra, na volta, se o servidor reiniciou (queda de energia) ou ficou ligado
 * (internet). Não vai nenhum dado de pessoa.
 */
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { statfsSync } from "node:fs";

const pct = (parte, todo) => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null);

/** Números do servidor. Dentro do contêiner, o tempo ligado é o da máquina (vem de /proc/uptime). */
export function infoDoHost({ sistema = os, disco = () => statfsSync("/") } = {}) {
  let discoLivre = null;
  try {
    const d = disco();
    discoLivre = pct(Number(d.bavail) * Number(d.bsize), Number(d.blocks) * Number(d.bsize));
  } catch { /* sem acesso ao disco: vai sem o número */ }
  return {
    uptime_s: Math.round(sistema.uptime()),
    carga_1m: Math.round(sistema.loadavg()[0] * 100) / 100,
    cpus: sistema.cpus().length,
    memoria_livre_pct: pct(sistema.freemem(), sistema.totalmem()),
    disco_livre_pct: discoLivre,
  };
}

/** GET com tempo-limite; `host` troca o cabeçalho Host (a Forja é roteada pelo proxy do Coolify). */
export function testar(url, { host, cabecalhos = {}, limiteMs = 3000, aceita = (s) => s >= 200 && s < 300 } = {}) {
  const inicio = Date.now();
  return new Promise((resolve) => {
    let alvo;
    try { alvo = new URL(url); } catch { return resolve({ ok: false, ms: 0, erro: "endereço inválido" }); }
    const lib = alvo.protocol === "https:" ? https : http;
    const req = lib.request(alvo, { method: "GET", headers: { ...cabecalhos, ...(host ? { host } : {}) } }, (r) => {
      r.resume();
      r.on("end", () => resolve({ ok: aceita(r.statusCode ?? 0), ms: Date.now() - inicio, status: r.statusCode ?? 0 }));
    });
    req.setTimeout(limiteMs, () => req.destroy(new Error(`sem resposta em ${limiteMs / 1000} s`)));
    req.on("error", (e) => resolve({ ok: false, ms: Date.now() - inicio, erro: e.message.slice(0, 120) }));
    req.end();
  });
}

/** Os serviços vistos por dentro do servidor. Os que não estão configurados ficam de fora. */
export async function testarServicos(env = process.env, teste = testar) {
  const porta = env.PORT || 3000;
  const supabase = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pedidos = {
    plataforma: teste(`http://127.0.0.1:${porta}/api/version`),
    ...(supabase && chave ? { banco: teste(`${supabase.replace(/\/$/, "")}/rest/v1/`, { cabecalhos: { apikey: chave }, aceita: (s) => s > 0 && s < 500 }) } : {}),
    ...(env.FORJA_API_URL ? { forja: teste(`${env.FORJA_API_URL.replace(/\/$/, "")}/health`, { host: env.FORJA_API_HOST || undefined }) } : {}),
  };
  const nomes = Object.keys(pedidos);
  const resultados = await Promise.all(Object.values(pedidos));
  return Object.fromEntries(nomes.map((n, i) => [n, resultados[i]]));
}

export function montarSinal(host, servicos) {
  return { versao: 1, host, servicos };
}

/** Envia o sinal para o vigia (RPC vigia_sinal do projeto Supabase da nuvem). */
export async function enviarSinal({ url, chave, alvo = "servidor-pecsil", token, info, buscar = fetch, limiteMs = 10_000 }) {
  if (!url || !chave || !token) throw new Error("VIGIA_URL, VIGIA_CHAVE e VIGIA_TOKEN são obrigatórios.");
  const cabecalhos = { "content-type": "application/json", apikey: chave };
  // Chave antiga (JWT) também vai no Authorization; a chave nova (sb_publishable_…) basta no apikey.
  if (chave.startsWith("eyJ")) cabecalhos.authorization = `Bearer ${chave}`;
  const r = await buscar(`${url.replace(/\/$/, "")}/rest/v1/rpc/vigia_sinal`, {
    method: "POST",
    headers: cabecalhos,
    body: JSON.stringify({ p_alvo: alvo, p_token: token, p_info: info }),
    signal: AbortSignal.timeout(limiteMs),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`vigia respondeu ${r.status}: ${texto.slice(0, 200)}`);
  return JSON.parse(texto || "{}");
}
