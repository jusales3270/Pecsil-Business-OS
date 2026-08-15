#!/usr/bin/env node
/**
 * Pecsil Business OS — verificação do perímetro do Supabase
 *
 * Roda da ESTAÇÃO DE DESENVOLVIMENTO, de fora da rede da empresa, e confirma
 * o que deve estar fechado e o que deve estar aberto. Foi assim que a
 * exposição de 14/08/2026 apareceu — o PostgreSQL respondia pela internet.
 *
 * Sem dependências e sem autenticar em nada: apenas abre socket e lê o
 * certificado. Não tenta explorar nem enviar credencial.
 *
 *   node scripts/check-perimeter.mjs
 *   HOST=supabase.pecsil.com.br node scripts/check-perimeter.mjs
 *
 * Sai com código 1 se qualquer porta sensível estiver acessível.
 */

import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { lookup } from "node:dns/promises";

const HOST = process.env.HOST || "supabase.pecsil.com.br";
const TIMEOUT = Number(process.env.TIMEOUT || 5000);

/** Portas que NUNCA podem responder da internet. */
const MUST_BE_CLOSED = [
  [5432, "PostgreSQL", "conexão direta ao banco ignora todo o RLS"],
  [6543, "Pooler (Supavisor)", "mesmo alcance do PostgreSQL"],
  [8000, "Kong HTTP", "API em texto claro; deve entrar só via Caddy"],
  [8443, "Kong TLS interno", "deve entrar só via Caddy"],
  [3000, "Studio", "console com poder de service_role"],
];

/** Portas que precisam responder para a plataforma funcionar. */
const MUST_BE_OPEN = [
  [443, "HTTPS (Caddy)", "por onde a aplicação fala com o Supabase"],
];

const c = {
  ok: s => `\x1b[32m${s}\x1b[0m`,
  bad: s => `\x1b[31m${s}\x1b[0m`,
  warn: s => `\x1b[33m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

function probe(port) {
  return new Promise(resolve => {
    const socket = netConnect({ host: HOST, port, timeout: TIMEOUT });
    const done = open => { socket.destroy(); resolve(open); };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function readCertificate() {
  return new Promise(resolve => {
    const socket = tlsConnect(
      { host: HOST, port: 443, servername: HOST, timeout: TIMEOUT, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.destroy();
        resolve({ cert, authorized });
      },
    );
    socket.once("timeout", () => { socket.destroy(); resolve(null); });
    socket.once("error", () => { socket.destroy(); resolve(null); });
  });
}

let failures = 0;
let warnings = 0;

console.log(`\nPerímetro de ${c.dim(HOST)}\n${"─".repeat(64)}`);

try {
  const { address } = await lookup(HOST);
  console.log(`DNS      ${address}`);
} catch {
  console.log(`DNS      ${c.bad("não resolve")}`);
  failures++;
}
console.log();

console.log("Devem estar FECHADAS");
for (const [port, name, why] of MUST_BE_CLOSED) {
  const open = await probe(port);
  if (open) {
    console.log(`  ${c.bad("✗")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.bad("ACESSÍVEL")}`);
    console.log(`    ${c.dim(why)}`);
    failures++;
  } else {
    console.log(`  ${c.ok("✓")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.dim("fechada")}`);
  }
}
console.log();

console.log("Devem estar ABERTAS");
for (const [port, name, why] of MUST_BE_OPEN) {
  const open = await probe(port);
  if (open) {
    console.log(`  ${c.ok("✓")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.dim("respondendo")}`);
  } else {
    console.log(`  ${c.warn("!")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.warn("sem resposta")}`);
    console.log(`    ${c.dim(why)}`);
    warnings++;
  }
}
console.log();

console.log("Certificado em 443");
const tls = await readCertificate();
if (!tls?.cert?.subject) {
  console.log(`  ${c.warn("!")} nenhum certificado — Caddy ainda não está publicando`);
  warnings++;
} else {
  const { cert, authorized } = tls;
  const validoAte = new Date(cert.valid_to);
  const dias = Math.round((validoAte - Date.now()) / 86400000);
  console.log(`  emissor   ${cert.issuer?.O || cert.issuer?.CN || "desconhecido"}`);
  console.log(`  domínio   ${cert.subject?.CN || "—"}`);
  console.log(`  expira    ${validoAte.toISOString().slice(0, 10)} ${c.dim(`(${dias} dias)`)}`);
  if (authorized) {
    console.log(`  ${c.ok("✓")} cadeia confiável`);
  } else {
    console.log(`  ${c.bad("✗")} certificado não confiável (autoassinado ou cadeia incompleta)`);
    failures++;
  }
  if (dias < 15) {
    console.log(`  ${c.warn("!")} renovação próxima`);
    warnings++;
  }
}

console.log(`${"─".repeat(64)}`);
if (failures) {
  console.log(c.bad(`${failures} problema(s) de perímetro. Não aplique dados reais assim.`));
  console.log(c.dim("Correção: infra/harden-supabase.sh e infra/Caddyfile"));
} else if (warnings) {
  console.log(c.warn(`Perímetro fechado, ${warnings} aviso(s) pendente(s).`));
} else {
  console.log(c.ok("Perímetro correto: banco inacessível, API só por HTTPS confiável."));
}
console.log();

process.exit(failures ? 1 : 0);
