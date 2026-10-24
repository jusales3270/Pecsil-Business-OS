#!/usr/bin/env node
/**
 * Backup externo da Pecsil (T-02 = B-02, docs/BACKUP-EXTERNO.md).
 *
 * Todo dia, no horário BACKUP_HORA (Brasília):
 *   1. pg_dump do banco da plataforma (papel backup_leitura, só leitura) e, se
 *      configurado, do banco da Forja;
 *   2. se configurado, os arquivos do Storage da plataforma (menos os buckets
 *      excluídos — os desenhos da Forja ficam fora, decisão de 18/10);
 *   3. cada um CRIPTOGRAFADO com age (chave pública da Pecsil) antes de sair;
 *   4. envio ao bucket "backups" do projeto do vigia (o usuário do backup só grava);
 *   5. aviso ao vigia (sem aviso por 26 h = incidente e alerta).
 *
 * `node backup.mjs --agora` roda uma vez e sai (código 1 se falhar).
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { lerConfig, nomeDaParte, nomeDoArquivo, partes, proximaExecucao } from "./nucleo.mjs";

const log = (...a) => console.log(new Date().toISOString(), ...a);

function rodar(cmd, args, { entrada, saida, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [entrada ? "pipe" : "ignore", saida ? "pipe" : "ignore", "pipe"], env: { ...process.env, ...env } });
    let erro = "";
    p.stderr.on("data", (d) => { erro += d; });
    p.on("error", reject);
    p.on("close", (codigo) => (codigo === 0 ? resolve(p) : reject(new Error(`${cmd} saiu com ${codigo}: ${erro.trim().slice(-400)}`))));
    if (entrada) entrada.pipe(p.stdin);
    if (saida) p.stdout.pipe(saida);
  });
}

/** pg_dump | age -r <chave pública> > arquivo. O dump nunca toca o disco sem criptografia. */
async function dumpCriptografado(url, destinatario, arquivo) {
  const dump = spawn("pg_dump", ["--format=custom", "--compress=6", "--no-password", `--dbname=${url}`], { stdio: ["ignore", "pipe", "pipe"] });
  let erroDump = "";
  dump.stderr.on("data", (d) => { erroDump += d; });
  const fimDump = new Promise((ok, falha) => dump.on("close", (c) => (c === 0 ? ok() : falha(new Error(`pg_dump saiu com ${c}: ${erroDump.trim().slice(-400)}`)))));
  await Promise.all([rodar("age", ["-r", destinatario], { entrada: dump.stdout, saida: createWriteStream(arquivo) }), fimDump]);
}

async function json(r) {
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

/** Baixa os arquivos do Storage da plataforma (menos os excluídos) para uma pasta. */
async function baixarArquivos({ url, chave, excluir }, pasta) {
  const h = { apikey: chave, authorization: `Bearer ${chave}` };
  const buckets = (await json(await fetch(`${url}/storage/v1/bucket`, { headers: h }))).map((b) => b.id).filter((b) => !excluir.includes(b));
  let n = 0;
  const listar = async (bucket, prefixo) => {
    for (let offset = 0; ; offset += 1000) {
      const itens = await json(await fetch(`${url}/storage/v1/object/list/${bucket}`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ prefix: prefixo, limit: 1000, offset }) }));
      for (const it of itens) {
        const caminho = prefixo ? `${prefixo}/${it.name}` : it.name;
        if (!it.id) { await listar(bucket, caminho); continue; } // pasta
        const r = await fetch(`${url}/storage/v1/object/${bucket}/${caminho.split("/").map(encodeURIComponent).join("/")}`, { headers: h });
        if (!r.ok) throw new Error(`arquivo ${bucket}/${caminho}: ${r.status}`);
        const destino = join(pasta, bucket, caminho);
        await mkdir(dirname(destino), { recursive: true });
        await writeFile(destino, Buffer.from(await r.arrayBuffer()));
        n += 1;
      }
      if (itens.length < 1000) break;
    }
  };
  for (const b of buckets) await listar(b, "");
  return { buckets, arquivos: n };
}

async function entrar({ url, chave }, { email, senha }) {
  const r = await json(await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: chave, "content-type": "application/json" }, body: JSON.stringify({ email, password: senha }) }));
  return r.access_token;
}

/** Envia o arquivo ao bucket (em partes de até 45 MB). Sem sobrescrever. */
async function enviar(vigia, token, nome, arquivo) {
  const { size } = await stat(arquivo);
  const faixas = partes(size);
  const enviados = [];
  for (const [i, [ini, fim]] of faixas.entries()) {
    const destino = nomeDaParte(nome, i, faixas.length);
    const r = await fetch(`${vigia.url}/storage/v1/object/backups/${destino}`, {
      method: "POST",
      headers: { apikey: vigia.chave, authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "x-upsert": "false", "content-length": String(fim - ini) },
      body: createReadStream(arquivo, { start: ini, end: fim - 1 }),
      duplex: "half",
    });
    await json(r);
    enviados.push({ nome: destino, bytes: fim - ini });
  }
  return enviados;
}

async function avisarVigia(vigia, info) {
  const cab = { apikey: vigia.chave, "content-type": "application/json", ...(vigia.chave.startsWith("eyJ") ? { authorization: `Bearer ${vigia.chave}` } : {}) };
  await json(await fetch(`${vigia.url}/rest/v1/rpc/vigia_sinal`, { method: "POST", headers: cab, body: JSON.stringify({ p_alvo: vigia.alvo, p_token: vigia.token, p_info: info }) }));
}

export async function fazerBackup(cfg, agora = new Date()) {
  const inicio = Date.now();
  const pasta = await mkdtemp(join(tmpdir(), "backup-"));
  try {
    const gerados = [];
    for (const b of cfg.bancos) {
      const arq = join(pasta, `${b.nome}.dump.age`);
      await dumpCriptografado(b.url, cfg.destinatario, arq);
      gerados.push({ tipo: b.nome, arq });
      log(`banco ${b.nome}: ${(await stat(arq)).size} bytes (criptografado)`);
    }
    let resumoArquivos = null;
    if (cfg.arquivos) {
      const dir = join(pasta, "arquivos");
      await mkdir(dir);
      resumoArquivos = await baixarArquivos(cfg.arquivos, dir);
      const arq = join(pasta, "arquivos.tar.gz.age");
      const tar = spawn("tar", ["-czf", "-", "-C", dir, "."], { stdio: ["ignore", "pipe", "pipe"] });
      const fimTar = new Promise((ok, falha) => tar.on("close", (c) => (c === 0 ? ok() : falha(new Error(`tar saiu com ${c}`)))));
      await Promise.all([rodar("age", ["-r", cfg.destinatario], { entrada: tar.stdout, saida: createWriteStream(arq) }), fimTar]);
      await rm(dir, { recursive: true, force: true }); // os arquivos em claro saem do disco antes do envio
      gerados.push({ tipo: "arquivos", arq });
      log(`arquivos: ${resumoArquivos.arquivos} de ${resumoArquivos.buckets.length} buckets, ${(await stat(arq)).size} bytes (criptografado)`);
    }
    const token = await entrar(cfg.vigia, cfg.acesso);
    const enviados = [];
    for (const g of gerados) enviados.push(...(await enviar(cfg.vigia, token, nomeDoArquivo(agora, g.tipo), g.arq)));
    const info = { arquivos: enviados, duracao_s: Math.round((Date.now() - inicio) / 1000), ...(resumoArquivos ? { storage: resumoArquivos } : {}) };
    await avisarVigia(cfg.vigia, info);
    log(`backup completo: ${enviados.length} arquivo(s), ${info.duracao_s} s`);
    return info;
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

async function principal() {
  const cfg = lerConfig(process.env);
  if (process.argv.includes("--agora")) {
    await fazerBackup(cfg);
    return;
  }
  log(`serviço de backup no ar; todo dia às ${cfg.hora} (Brasília)`);
  for (;;) {
    const quando = proximaExecucao(new Date(), cfg.hora);
    log(`próximo backup: ${quando.toISOString()}`);
    await new Promise((r) => setTimeout(r, quando.getTime() - Date.now()));
    try { await fazerBackup(cfg); } catch (e) { log("FALHA no backup:", e instanceof Error ? e.message : e); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch((e) => { log("FALHA:", e instanceof Error ? e.message : e); process.exit(1); });
}
