import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile("supabase/migrations/202608040002_finance_v1.sql", "utf8");
const permissions = await readFile("supabase/migrations/202608040001_finance_permissions.sql", "utf8");
const repository = await readFile("lib/data/finance-repository.ts", "utf8");
const api = await readFile("app/api/finance/route.ts", "utf8");

test("schema cobre os dez agregados financeiros protegidos por RLS", () => {
  const tables = [
    "finance_chart_accounts", "finance_cost_centers", "finance_bank_accounts",
    "finance_titles", "finance_installments", "finance_approval_rules",
    "finance_approval_requests", "finance_settlements", "finance_bank_entries",
    "finance_reconciliations",
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("baixa e conciliação possuem permissões próprias e trilha auditável", () => {
  assert.match(permissions, /add value if not exists 'settle'/);
  assert.match(permissions, /add value if not exists 'reconcile'/);
  assert.match(migration, /finance_validate_settlement/);
  assert.match(migration, /finance_refresh_installment/);
  assert.match(migration, /audit_finance_mutation/);
  assert.match(migration, /has_permission\('financeiro', 'settle'\)/);
  assert.match(migration, /has_permission\('financeiro', 'reconcile'\)/);
});

test("adaptador mantém mocks até a conexão Supabase estar disponível", () => {
  assert.match(repository, /getSupabaseFinanceSnapshot/);
  assert.match(api, /publicConnectionReady/);
  assert.match(api, /demoFinanceSnapshot/);
  assert.match(api, /UNAUTHENTICATED/);
});

