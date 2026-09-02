import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local if present
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("==================================================");
console.log("🏥 PECSIL BUSINESS OS - SUPABASE DATABASE CHECKUP");
console.log("==================================================");
console.log(`URL: ${url}`);
console.log(`Anon/Publishable Key: ${anonKey ? "Configurada (presente)" : "❌ AUSENTE"}`);
console.log(`Service Role Key: ${serviceKey ? "Configurada (presente)" : "❌ AUSENTE"}`);
console.log("--------------------------------------------------");

if (!url) {
  console.error("❌ Erro fatal: NEXT_PUBLIC_SUPABASE_URL não configurada.");
  process.exit(1);
}

const requiredTables = [
  "organizations",
  "units",
  "departments",
  "teams",
  "positions",
  "profiles",
  "employees",
  "roles",
  "role_permissions",
  "access_scopes",
  "user_roles",
  "documents",
  "notifications",
  "audit_logs",
  "modules",
  "organization_modules",
  "finance_chart_accounts",
  "finance_cost_centers",
  "finance_bank_accounts",
  "finance_titles",
  "finance_installments",
  "finance_approval_rules",
  "finance_approval_requests",
  "finance_settlements",
  "finance_bank_entries",
  "finance_reconciliations",
];

async function runCheckup() {
  const results = {
    authAdmin: false,
    usersCount: 0,
    tables: {},
    summary: { total: requiredTables.length, ok: 0, missingOrError: 0 },
  };

  // 1. Service Role Client Test
  if (serviceKey) {
    console.log("\n🔑 1. TESTE VIA SERVICE_ROLE (Acesso Administrativo)");
    const adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      const { data: users, error: usersErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 100 });
      if (usersErr) {
        console.log(`   ❌ Supabase Auth Admin: Falha (${usersErr.message})`);
      } else {
        results.authAdmin = true;
        results.usersCount = users.users.length;
        console.log(`   ✅ Supabase Auth: OK (${users.users.length} usuários cadastrados)`);
        for (const u of users.users.slice(0, 5)) {
          console.log(`      - Usuário: ${u.email} (ID: ${u.id.slice(0, 8)}...)`);
        }
      }
    } catch (e) {
      console.log(`   ❌ Supabase Auth Erro: ${e.message}`);
    }

    console.log("\n📊 2. VERIFICAÇÃO DE TABELAS DO BANCO DE DADOS (PostgREST / Schema public)");
    console.log("----------------------------------------------------------------------");
    console.log(
      `${"Tabela".padEnd(30)} | ${"Status".padEnd(10)} | ${"Registros".padEnd(12)} | Detalhes`
    );
    console.log("----------------------------------------------------------------------");

    for (const table of requiredTables) {
      try {
        const start = performance.now();
        const { count, error, data } = await adminClient
          .from(table)
          .select("*", { count: "exact", head: true });
        const latency = Math.round(performance.now() - start);

        if (error) {
          results.tables[table] = { ok: false, error: error.message };
          results.summary.missingOrError++;
          console.log(
            `${table.padEnd(30)} | ❌ ERRO    | ${"-".padEnd(12)} | ${error.message} (${error.code || "unknown"})`
          );
        } else {
          results.tables[table] = { ok: true, count: count ?? 0, latency };
          results.summary.ok++;
          console.log(
            `${table.padEnd(30)} | ✅ OK      | ${(count ?? 0).toString().padEnd(12)} | Latência: ${latency}ms`
          );
        }
      } catch (err) {
        results.tables[table] = { ok: false, error: err.message };
        results.summary.missingOrError++;
        console.log(`${table.padEnd(30)} | ❌ EXCEÇÃO | ${"-".padEnd(12)} | ${err.message}`);
      }
    }
  }

  // 2. Anon Client Test
  if (anonKey) {
    console.log("\n🌐 3. TESTE VIA ANON_KEY (Acesso Público com RLS)");
    const anonClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      const { data, error } = await anonClient.from("modules").select("code, name, status").limit(5);
      if (error) {
        console.log(`   ⚠️ Consulta pública a 'modules': Restrita ou erro (${error.message})`);
      } else {
        console.log(`   ✅ Leitura com Anon Key em 'modules': OK (${data.length} módulos retornados)`);
      }
    } catch (e) {
      console.log(`   ⚠️ Erro anon key: ${e.message}`);
    }
  }

  console.log("\n==================================================");
  console.log("📋 RESUMO DO CHECKUP");
  console.log("==================================================");
  console.log(`Tabelas Verificadas: ${results.summary.total}`);
  console.log(`Tabelas OK:          ${results.summary.ok}`);
  console.log(`Tabelas com Erro:    ${results.summary.missingOrError}`);
  console.log("==================================================");

  if (results.summary.missingOrError === 0) {
    console.log("🎉 BANCO DE DADOS 100% OPERACIONAL E COMUNICANDO PERFEITAMENTE!");
  } else {
    console.log("⚠️ Algumas tabelas precisam de atenção ou aplicação de migrations.");
  }
}

runCheckup().catch(console.error);
