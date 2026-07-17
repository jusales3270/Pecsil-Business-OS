import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const migrationDir = resolve(root, "supabase/migrations");
const migrationFiles = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
const errors = [];

if (migrationFiles.length < 2) errors.push("São esperadas ao menos duas migrations versionadas.");
if (new Set(migrationFiles.map((file) => file.split("_")[0])).size !== migrationFiles.length) {
  errors.push("Há timestamps de migration duplicados.");
}

const sql = (await Promise.all(migrationFiles.map((file) => readFile(resolve(migrationDir, file), "utf8")))).join("\n");
const requiredTables = [
  "organizations", "units", "departments", "teams", "positions", "profiles", "employees",
  "roles", "role_permissions", "access_scopes", "user_roles", "documents", "notifications",
  "audit_logs", "modules", "organization_modules",
];

for (const table of requiredTables) {
  if (!sql.includes(`create table public.${table}`)) errors.push(`Tabela não declarada: public.${table}`);
  if (!sql.includes(`alter table public.${table} enable row level security`)) errors.push(`RLS não declarado: public.${table}`);
}

for (const requiredFunction of ["current_profile_id", "current_organization_id", "has_permission", "can_access_entity", "can_access_module"]) {
  if (!sql.includes(`function public.${requiredFunction}`)) errors.push(`Função de segurança ausente: ${requiredFunction}`);
}

for (const unsafePattern of [/drop\s+schema\s+public/i, /truncate\s+table/i, /delete\s+from\s+auth\.users/i]) {
  if (unsafePattern.test(sql)) errors.push(`Operação destrutiva detectada: ${unsafePattern}`);
}

const bootstrap = await readFile(resolve(root, "scripts/bootstrap-supabase.mjs"), "utf8");
for (const variable of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "INITIAL_OWNER_EMAIL"]) {
  if (!bootstrap.includes(variable)) errors.push(`Bootstrap não exige ${variable}.`);
}

if (errors.length) {
  console.error("Pacote Supabase inválido:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`Pacote Supabase válido: ${migrationFiles.length} migrations, ${requiredTables.length} tabelas protegidas e bootstrap administrativo.`);
