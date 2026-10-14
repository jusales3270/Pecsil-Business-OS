import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { rotuloAcao, oQueMudou } = await import("../lib/auditoria/rotulos.ts");
const sql = readFileSync(new URL("../supabase/migrations/202610130007_auditoria_central.sql", import.meta.url), "utf8");

test("rótulos: código técnico vira frase; o desconhecido aparece como veio", () => {
  assert.equal(rotuloAcao("finance_titles.update"), "Alterou título");
  assert.equal(rotuloAcao("rh_absences.insert"), "Criou afastamento");
  assert.equal(rotuloAcao("sales_quotes.delete"), "Excluiu orçamento");
  assert.equal(rotuloAcao("login.login"), "Entrou no sistema");
  assert.equal(rotuloAcao("fiscal_nfe.autorizada_treino"), "Aprovou e transmitiu nota fiscal (treino)");
  assert.equal(rotuloAcao("algo.novo"), "algo.novo");
});

test("o que mudou: campo, antes e depois; vazio aparece como (vazio)", () => {
  assert.deepEqual(oQueMudou({ mudou: { pedido_cliente: [null, "4502385803"], validade: ["2026-10-01", ""] } }), [
    "pedido cliente: (vazio) → 4502385803", "validade: 2026-10-01 → (vazio)",
  ]);
  assert.deepEqual(oQueMudou({ operation: "INSERT" }), []);
});

test("migração: só o proprietário ou Fundação › Auditoria leem; o autor da tela é a sessão; testes escondidos", () => {
  assert.match(sql, /select public\.is_owner\(\) or public\.has_feature\('fundacao\.auditoria'\)/);
  assert.match(sql, /if not public\.auditoria_pode_ver\(\) then raise exception 'Sem permissão para a auditoria\.'/);
  assert.match(sql, /perfil uuid := public\.current_profile_id\(\)/, "a tela é registrada em nome da sessão, nunca do parâmetro");
  assert.match(sql, /occurred_at > now\(\) - interval '15 minutes'/);
  assert.match(sql, /not like '%@pecsil-teste\.local'/);
  assert.match(sql, /revoke all on function public\.auditoria_ultimos_acessos_org\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.auditoria_ultimos_acessos_org\(uuid\) to service_role/);
  for (const t of ["products", "product_groups", "sales_quotes", "production_entries", "customers"]) {
    assert.match(sql, new RegExp(`create trigger ${t}_auditoria after insert or update or delete on public\\.${t}`));
  }
  assert.match(sql, /continue when k in \('updated_at', 'created_at', 'synced_at', 'normalized_name'\)/);
});

test("migração 0008: a trilha esconde o rastro dos usuários de teste (sem apagar nada)", () => {
  const sql8 = readFileSync(new URL("../supabase/migrations/202610130008_auditoria_sem_testes.sql", import.meta.url), "utf8");
  assert.match(sql8, /not \(e\.module_code = 'acesso' and e\.summary ~ '· QA '\)/);
  assert.match(sql8, /a\.event_type like 'core\.access%' and not exists/);
  assert.doesNotMatch(sql8, /\bdelete\b/i, "nada é apagado");
  assert.match(sql8, /if not public\.auditoria_pode_ver\(\)/);
});
