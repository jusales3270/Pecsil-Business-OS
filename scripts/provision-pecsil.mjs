#!/usr/bin/env node
/**
 * Provisiona o proprietário e a organização no Supabase da PecSil.
 *
 *   1. cria o usuário proprietário no Supabase Auth (idempotente)
 *   2. roda o bootstrap: organização, papéis, catálogo de módulos, vínculo
 *
 * Lê tudo do .env.local. A senha do proprietário nunca é passada por
 * argumento — fica só no arquivo. Depois de rodar, apague a linha
 * INITIAL_OWNER_PASSWORD do .env.local.
 *
 *   node scripts/provision-pecsil.mjs
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// --- Lê o .env.local sem depender de dependência externa --------------------
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let [, key, value] = m;
  value = value.trim().replace(/^"(.*)"$/, "$1");
  if (value) env[key] = value;
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const email = env.INITIAL_OWNER_EMAIL;
const name = env.INITIAL_OWNER_NAME || email;
const password = env.INITIAL_OWNER_PASSWORD;

const missing = [];
if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!email) missing.push("INITIAL_OWNER_EMAIL");
if (!password) missing.push("INITIAL_OWNER_PASSWORD");
if (missing.length) {
  console.error(`Faltam variáveis no .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("INITIAL_OWNER_PASSWORD precisa de ao menos 8 caracteres.");
  process.exit(1);
}

const authHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function findUser() {
  const res = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: authHeaders,
  });
  if (!res.ok) return null;
  const body = await res.json();
  const list = Array.isArray(body.users) ? body.users : [];
  return list.find(u => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function main() {
  console.log(`Servidor: ${url}`);

  // 1. Usuário no Auth ------------------------------------------------------
  let user = await findUser();
  if (user) {
    console.log(`✓ Proprietário já existe no Auth (${user.id}). Senha não alterada.`);
  } else {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.id) {
      console.error("Falha ao criar o usuário:", JSON.stringify(body).slice(0, 300));
      process.exit(1);
    }
    console.log(`✓ Proprietário criado no Auth (${body.id}).`);
  }

  // 2. Bootstrap ------------------------------------------------------------
  console.log("\nRodando o provisionamento (organização, papéis, catálogo)...\n");
  const result = spawnSync("node", ["scripts/bootstrap-supabase.mjs"], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  process.exit(result.status ?? 1);
}

main().catch(err => {
  console.error("Erro:", err.message);
  process.exit(1);
});
