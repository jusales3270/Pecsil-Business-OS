#!/usr/bin/env node
/**
 * Confere, no banco real, se algum gatilho lê coluna que não existe.
 *
 * O PL/pgSQL só valida `new.coluna` / `old.coluna` na execução: a migração
 * passa, e a falha aparece quando alguém usa a tela (foi assim que aprovar
 * férias ficou quebrado de 21 a 25/09/2026, com a tela dizendo "sem
 * permissão"). Rode depois de aplicar migrações.
 *
 *   SUPABASE_URL=http://host:8000 node scripts/check-trigger-columns.mjs
 *
 * Usa o endpoint /pg/query com SUPABASE_SERVICE_ROLE_KEY (.env.local).
 */
import { existsSync, readFileSync } from "node:fs";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const t = line.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i < 0) continue;
    env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const base = env.SUPABASE_URL || env.SUPABASE_INTERNAL_URL;
if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

async function query(sql) {
  const response = await fetch(`${base.replace(/\/$/, "")}/pg/query`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

const triggers = await query(`
  select c.relname as tabela, p.proname as funcao, pg_get_functiondef(p.oid) as fonte
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public' and not t.tgisinternal`);
const columns = await query(`
  select table_name as tabela, array_agg(column_name::text) as colunas
  from information_schema.columns where table_schema = 'public' group by 1`);
const byTable = new Map(columns.map((row) => [row.tabela, new Set(row.colunas)]));

const problems = [];
for (const { tabela, funcao, fonte } of triggers) {
  const body = fonte.split("$function$")[1] ?? fonte;
  const refs = new Set([...body.matchAll(/\b(?:new|old)\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()));
  const known = byTable.get(tabela) ?? new Set();
  const missing = [...refs].filter((ref) => !known.has(ref));
  if (missing.length) problems.push(`${tabela} · ${funcao}(): ${missing.join(", ")}`);
}

console.log(`Gatilhos verificados: ${triggers.length}`);
if (problems.length) {
  console.error(`✖ Gatilhos lendo coluna inexistente:\n  ${[...new Set(problems)].join("\n  ")}`);
  process.exit(1);
}
console.log("✔ Nenhum gatilho lê coluna inexistente.");
