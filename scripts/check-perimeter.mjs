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

import { connect as netConnect, isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { lookup } from "node:dns/promises";

const HOST = process.env.HOST || "supabase.pecsil.com.br";
const TIMEOUT = Number(process.env.TIMEOUT || 5000);
if (!Number.isFinite(TIMEOUT) || TIMEOUT < 1 || TIMEOUT > 60000) {
  throw new Error("TIMEOUT deve estar entre 1 e 60000 milissegundos.");
}

/** Portas que NUNCA podem responder da internet. */
const MUST_BE_CLOSED = [
  [5432, "PostgreSQL", "acesso direto ao banco amplia a superfície de ataque"],
  [6543, "Pooler (Supavisor)", "mesmo alcance do PostgreSQL"],
  [8000, "Kong HTTP", "API em texto claro; deve entrar só via Caddy"],
  [8001, "Console administrativo", "painel administrativo não deve estar público"],
  [8443, "Kong TLS interno", "deve entrar só via Caddy"],
  [3000, "Studio", "console com poder de service_role"],
  [3100, "Transmissor fiscal", "serviço interno; deve entrar só pela aplicação"],
  [3200, "Conector", "serviço interno; deve entrar só pela aplicação"],
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

function probe(address, port) {
  return new Promise(resolve => {
    const socket = netConnect({ host: address, port, timeout: TIMEOUT });
    const done = status => { socket.destroy(); resolve(status); };
    socket.once("connect", () => done("open"));
    socket.once("timeout", () => done("filtered"));
    socket.once("error", error => done(error.code === "ECONNREFUSED" ? "closed" : "unverified"));
  });
}

function readCertificate(address) {
  return new Promise(resolve => {
    let finished = false;
    let socket;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      socket?.destroy();
      resolve(result);
    };
    // Prazo absoluto: um peer que só envia bytes incompletos não prolonga a checagem.
    const deadline = setTimeout(() => finish(null), TIMEOUT);
    socket = tlsConnect(
      { host: address, port: 443, servername: HOST, timeout: TIMEOUT, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        finish({ cert, authorized });
      },
    );
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("close", () => finish(null));
  });
}

let failures = 0;
let warnings = 0;
let incomplete = false;

console.log(`\nPerímetro de ${c.dim(HOST)}\n${"─".repeat(64)}`);

let targets = [];
try {
  targets = (await lookup(HOST, { all: true })).map(({ address }) => address);
} catch {
  console.log(`DNS      ${c.bad("não resolve")}`);
  failures++;
}
// Inclua também IPs públicos do provedor que não estejam publicados no DNS.
const explicitTargets = (process.env.TARGET_IPS || "").split(",").map(value => value.trim()).filter(Boolean);
if (explicitTargets.some(address => !isIP(address))) throw new Error("TARGET_IPS aceita somente endereços IPv4/IPv6 separados por vírgula.");
targets = [...new Set([...targets, ...explicitTargets])];
if (!targets.length) {
  console.log(c.bad("Nenhum destino disponível para verificação."));
  failures++;
}
for (const family of [4, 6]) {
  if (targets.some(address => isIP(address) === family)) {
    if (process.env[`NO_PUBLIC_IPV${family}`] === "1") throw new Error(`IPv${family} consta nos destinos e não pode ser declarado ausente.`);
  } else if (process.env[`NO_PUBLIC_IPV${family}`] === "1") {
    console.log(c.dim(`Operador declarou ausência de IPv${family} público; conferir evidência no provedor.`));
  } else {
    console.log(c.warn(`IPv${family} não verificado: inclua o IP público em TARGET_IPS ou, após conferir no provedor, declare NO_PUBLIC_IPV${family}=1.`));
    incomplete = true;
  }
}
for (const address of targets) {
console.log(`\nDestino  ${address} (IPv${isIP(address)})`);
console.log();

console.log("Devem estar FECHADAS");
for (const [port, name, why] of MUST_BE_CLOSED) {
  const status = await probe(address, port);
  if (status === "open") {
    console.log(`  ${c.bad("✗")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.bad("ACESSÍVEL")}`);
    console.log(`    ${c.dim(why)}`);
    failures++;
  } else if (status === "unverified") {
    console.log(`  ${c.bad("?")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.bad("não verificada: falha de rede local")}`);
    failures++;
  } else {
    console.log(`  ${c.ok("✓")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.dim(status === "closed" ? "conexão recusada" : "sem resposta (filtrada)")}`);
  }
}
console.log();

console.log("Devem estar ABERTAS");
for (const [port, name, why] of MUST_BE_OPEN) {
  const status = await probe(address, port);
  if (status === "open") {
    console.log(`  ${c.ok("✓")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.dim("respondendo")}`);
  } else {
    console.log(`  ${c.warn("!")} ${String(port).padEnd(5)} ${name.padEnd(22)} ${c.warn("sem resposta")}`);
    console.log(`    ${c.dim(why)}`);
    failures++;
  }
}
console.log();

console.log("Certificado em 443");
const tls = await readCertificate(address);
if (!tls?.cert?.subject) {
  console.log(`  ${c.warn("!")} nenhum certificado — Caddy ainda não está publicando`);
  failures++;
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
    console.log(`  ${c.bad("✗")} validação TLS falhou nesta estação; confira cadeia, domínio e certificados locais`);
    failures++;
  }
  if (dias < 15) {
    console.log(`  ${c.warn("!")} renovação próxima`);
    warnings++;
  }
}
}

console.log(`${"─".repeat(64)}`);
if (failures) {
  console.log(c.bad(`${failures} problema(s) de perímetro. Não aplique dados reais assim.`));
  console.log(c.dim("Procedimento de correção e validação: docs/SECURITY-ROLLOUT.md"));
} else if (incomplete) {
  console.log(c.warn("Cobertura incompleta: uma família de endereços ainda precisa ser conferida. Saída 2."));
} else if (warnings) {
  console.log(c.warn(`Sem acesso TCP sensível observado nos destinos testados; ${warnings} aviso(s) pendente(s).`));
} else {
  console.log(c.ok("Destinos informados testados sem acesso TCP sensível e com HTTPS válido; famílias ausentes conforme declaração do operador."));
}
console.log();

process.exit(failures ? 1 : incomplete ? 2 : 0);
