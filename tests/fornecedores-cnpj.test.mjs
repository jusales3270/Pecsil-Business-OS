import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const sql = readFileSync(new URL("../supabase/migrations/202610120001_fornecedores_cnpj.sql", import.meta.url), "utf8");

test("CNPJ a conferir: CNPJ formatado para a tela", async () => {
  const { cnpjFormatado } = await import("../lib/cadastros/cnpj.ts");
  assert.equal(cnpjFormatado("11222333000181"), "11.222.333/0001-81");
  assert.equal(cnpjFormatado("11.222.333/0001-81"), "11.222.333/0001-81");
  assert.equal(cnpjFormatado(null), "");
});

test("CNPJ a conferir: regras de segurança da migração", () => {
  // O CNPJ da própria empresa vem do cadastro da organização (multiempresa), nunca fixo.
  assert.match(sql, /c = public\.cnpj_da_empresa\(p_org\)/);
  assert.doesNotMatch(sql, /46\.?839\.?106/);
  // Decidir exige editar fornecedores; registrar vindo de documento é só do servidor.
  assert.match(sql, /public\.is_owner\(\) or public\.can_manage_suppliers\(\)/);
  assert.match(sql, /grant execute on function public\.supplier_cnpj_registrar\(uuid, text, text, uuid\) to service_role;/);
  assert.doesNotMatch(sql, /grant execute on function public\.supplier_cnpj_registrar[^;]*authenticated/);
  // Fila só lida por quem vê Fornecedores ou Cadastros; escrita só por função.
  assert.match(sql, /revoke all on public\.supplier_cnpj_suggestions from anon, authenticated;\ngrant select/);
});
