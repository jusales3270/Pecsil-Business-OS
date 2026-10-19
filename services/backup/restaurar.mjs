#!/usr/bin/env node
/**
 * Restauração do backup externo (T-02, docs/BACKUP-EXTERNO.md).
 *
 *   node restaurar.mjs --chave <arquivo da chave privada age> --destino <postgres://…> <arquivo.dump.age> [parte-02 …] [-- <opções do pg_restore>]
 *   node restaurar.mjs --chave <chave> --pasta <pasta> <arquivo.tar.gz.age> [partes…]
 *
 * As partes são juntadas na ordem dada, descriptografadas com a chave privada (que
 * fica só com o proprietário) e, para banco, entregues ao pg_restore; para arquivos,
 * extraídas na pasta. O conteúdo em claro não é gravado em disco no caso do banco.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { PassThrough } from "node:stream";

const args = process.argv.slice(2);
const corte = args.indexOf("--");
const extras = corte >= 0 ? args.slice(corte + 1) : [];
const principais = corte >= 0 ? args.slice(0, corte) : args;
const valor = (nome) => { const i = principais.indexOf(nome); return i >= 0 ? principais[i + 1] : undefined; };
const chave = valor("--chave");
const destino = valor("--destino");
const pasta = valor("--pasta");
const arquivos = principais.filter((a, i) => !a.startsWith("--") && !["--chave", "--destino", "--pasta"].includes(principais[i - 1]));
if (!chave || (!destino && !pasta) || !arquivos.length) {
  console.error("uso: node restaurar.mjs --chave <chave age> (--destino <postgres://…> | --pasta <pasta>) <arquivo.age> [partes…] [-- opções do pg_restore]");
  process.exit(2);
}

function juntar(lista) {
  const saida = new PassThrough();
  (async () => {
    for (const a of lista) await new Promise((ok, falha) => { const r = createReadStream(a); r.on("end", ok); r.on("error", falha); r.pipe(saida, { end: false }); });
    saida.end();
  })().catch((e) => saida.destroy(e));
  return saida;
}

function processo(cmd, argumentos, entrada) {
  const p = spawn(cmd, argumentos, { stdio: ["pipe", "pipe", "pipe"] });
  let erro = "";
  p.stderr.on("data", (d) => { erro += d; process.stderr.write(d); });
  // Quem lê pode fechar a entrada antes do fim (pg_restore com --schema): não é erro.
  p.stdin.on("error", (e) => { if (e.code !== "EPIPE") erro += e.message; });
  entrada.on("error", () => {});
  entrada.pipe(p.stdin);
  const fim = new Promise((ok, falha) => p.on("close", (c) => (c === 0 ? ok() : falha(new Error(`${cmd} saiu com ${c}: ${erro.trim().slice(-300)}`)))));
  return { p, fim };
}

const age = processo("age", ["-d", "-i", chave], juntar(arquivos));
const final = destino
  ? processo("pg_restore", ["--no-password", `--dbname=${destino}`, ...extras], age.p.stdout)
  : processo("tar", ["-xzf", "-", "-C", pasta], age.p.stdout);
// Quem recebe terminou (pg_restore com --schema não lê o resto): encerra o age, que
// ficaria parado esperando para escrever.
final.p.on("close", () => { age.p.stdout.destroy(); if (age.p.exitCode === null) age.p.kill("SIGTERM"); });
// Vale o resultado de quem recebe: com a chave errada o age falha e o pg_restore/tar
// recebe a entrada vazia e falha também; se o pg_restore terminar antes de ler tudo,
// o age sai por "pipe fechado" e isso não é erro.
const [rAge, rFinal] = await Promise.allSettled([age.fim, final.fim]);
if (rFinal.status === "fulfilled") {
  console.log(destino ? "restauração do banco concluída" : `arquivos extraídos em ${pasta}`);
} else {
  console.error("FALHA:", rFinal.reason.message, rAge.status === "rejected" ? `| age: ${rAge.reason.message}` : "");
  process.exit(1);
}
