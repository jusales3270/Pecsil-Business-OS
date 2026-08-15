#!/usr/bin/env node
/**
 * Pecsil Business OS — rotação das chaves do Supabase self-hosted
 *
 * No Supabase auto-hospedado, ANON_KEY e SERVICE_ROLE_KEY são JWTs HS256
 * assinados com o JWT_SECRET da instalação. Rotacionar o segredo invalida
 * as duas de uma vez; este script gera o novo par.
 *
 * POR QUE ROTACIONAR: até 14/08/2026 o gateway respondia em HTTP puro na
 * internet aberta. Toda chave que trafegou nesse período deve ser considerada
 * comprometida — inclusive a service_role, que ignora todo o RLS.
 *
 * USO
 *   # gera um JWT_SECRET novo e o par de chaves
 *   node infra/rotate-jwt-keys.mjs --generate-secret
 *
 *   # usa um segredo que você já definiu
 *   node infra/rotate-jwt-keys.mjs --secret "<JWT_SECRET>"
 *
 *   # validade diferente do padrão de 5 anos
 *   node infra/rotate-jwt-keys.mjs --generate-secret --years 2
 *
 * O script NÃO escreve em nenhum arquivo e não fala com a rede. Ele imprime os
 * valores para você colar no .env do Supabase e no .env.local do projeto.
 */

import { createHmac, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? true;
};

const years = Number(flag("years") || 5);
let secret = flag("secret");

if (args.includes("--generate-secret")) {
  // 40 bytes em base64url ≈ 54 caracteres. O Supabase exige no mínimo 32.
  secret = randomBytes(40).toString("base64url");
}

if (!secret || secret === true) {
  console.error(`Informe o segredo ou peça a geração de um:

  node infra/rotate-jwt-keys.mjs --generate-secret
  node infra/rotate-jwt-keys.mjs --secret "<JWT_SECRET>"
`);
  process.exit(1);
}

if (String(secret).length < 32) {
  console.error("JWT_SECRET precisa ter ao menos 32 caracteres.");
  process.exit(1);
}

const b64url = input =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Assina um JWT HS256 no formato que o GoTrue e o PostgREST esperam. */
function sign(payload, key) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", key).update(data).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${data}.${signature}`;
}

const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + Math.round(years * 365.25 * 24 * 60 * 60);
const base = { iss: "supabase", iat: issuedAt, exp: expiresAt };

const anonKey = sign({ ...base, role: "anon" }, secret);
const serviceRoleKey = sign({ ...base, role: "service_role" }, secret);

const fmt = ts => new Date(ts * 1000).toISOString().slice(0, 10);

console.log(`
════════════════════════════════════════════════════════════════════════════
 CHAVES NOVAS — emitidas ${fmt(issuedAt)}, válidas até ${fmt(expiresAt)}
════════════════════════════════════════════════════════════════════════════

1) No .env do Supabase (servidor), substitua e reinicie os contêineres:

JWT_SECRET=${secret}
ANON_KEY=${anonKey}
SERVICE_ROLE_KEY=${serviceRoleKey}

   docker compose down && docker compose up -d

2) No .env.local do Pecsil Business OS (estação de desenvolvimento):

NEXT_PUBLIC_SUPABASE_URL=https://supabase.pecsil.com.br
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}
SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}

   Reinicie o npm run dev — as NEXT_PUBLIC_* entram no bundle na subida.

────────────────────────────────────────────────────────────────────────────
 CUIDADOS

 • Rotacionar o JWT_SECRET invalida TODAS as sessões abertas. Todos os
   usuários precisarão entrar de novo. Faça fora do horário de operação.
 • A SERVICE_ROLE_KEY ignora todo o RLS. Ela vive apenas no .env do servidor
   e no .env.local de uma estação administrativa autorizada. Nunca no
   navegador, nunca em commit, nunca em print ou mensagem.
 • Só rotacione DEPOIS que o perímetro estiver fechado: chave nova enviada por
   HTTP puro na internet nasce comprometida igual à anterior.
 • Esta saída contém segredos. Limpe o histórico do terminal em seguida.
════════════════════════════════════════════════════════════════════════════
`);
