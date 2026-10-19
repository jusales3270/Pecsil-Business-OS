#!/usr/bin/env node
/**
 * Define a senha do papel backup_leitura no banco da plataforma (T-02).
 *
 * Gera uma senha forte (ou usa BACKUP_DB_PASSWORD do .env.local, se já existir),
 * guarda no .env.local e manda ao banco SÓ o verificador SCRAM, por /pg/query.
 * O texto da senha não trafega — a porta 8000 do Supabase ainda é HTTP (B-01).
 * A senha nunca é impressa: o proprietário copia do .env.local para o Coolify.
 *
 * Uso: node scripts/ti-backup-senha.mjs [--aplicar]   (sem --aplicar: só confere)
 */
import { appendFileSync, readFileSync } from "node:fs";
import { senhaAleatoria, verificadorScram } from "../lib/ti/scram.mjs";

const arquivo = new URL("../.env.local", import.meta.url);
const texto = readFileSync(arquivo, "utf8");
const env = {};
for (const l of texto.split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); }
const url = (env.SUPABASE_INTERNAL_URL && !env.SUPABASE_INTERNAL_URL.includes("localhost") ? env.SUPABASE_INTERNAL_URL : "http://181.224.8.145:8000").replace(/\/$/, "");
const chave = env.SUPABASE_SERVICE_ROLE_KEY;
if (!chave) { console.error("SUPABASE_SERVICE_ROLE_KEY ausente no .env.local."); process.exit(1); }
const sql = async (query) => {
  const r = await fetch(`${url}/pg/query`, { method: "POST", headers: { apikey: chave, authorization: `Bearer ${chave}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const corpo = await r.json();
  if (!r.ok || corpo?.error) throw new Error(String(corpo?.error ?? corpo?.message ?? r.status).slice(0, 200));
  return corpo;
};

const [papel] = await sql("select rolname, rolbypassrls, rolcanlogin, pg_has_role(rolname, 'pg_read_all_data', 'member') le from pg_roles where rolname = 'backup_leitura'");
if (!papel) { console.error("O papel backup_leitura não existe: aplique antes a migração 202610180007_backup_leitura.sql."); process.exit(1); }
console.log(`papel backup_leitura: login=${papel.rolcanlogin} bypassrls=${papel.rolbypassrls} lê tudo=${papel.le}`);
if (!process.argv.includes("--aplicar")) { console.log("(só conferência; use --aplicar para definir a senha)"); process.exit(0); }

let senha = env.BACKUP_DB_PASSWORD;
if (!senha) {
  senha = senhaAleatoria();
  appendFileSync(arquivo, `${texto.endsWith("\n") ? "" : "\n"}# Senha do papel backup_leitura (T-02): copiar para BACKUP_PG_URL_PECSIL no Coolify\nBACKUP_DB_PASSWORD=${senha}\n`);
  console.log("senha nova gerada e guardada no .env.local (BACKUP_DB_PASSWORD)");
}
await sql(`alter role backup_leitura password '${verificadorScram(senha)}'`);
console.log("senha do backup_leitura definida no banco (só o verificador SCRAM foi enviado)");
