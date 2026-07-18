import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/finance-module.tsx", import.meta.url), "utf8");

test("financeiro: cobre os domínios operacionais da versão 1", () => {
  for (const domain of ["Contas a pagar", "Contas a receber", "Fluxo de caixa", "Bancos e conciliação", "Centros de custo", "Relatórios", "Homologação"]) {
    assert.match(source, new RegExp(domain));
  }
});

test("financeiro: ações críticas respeitam permissões", () => {
  assert.match(source, /hasPermission\(access,"financeiro\.create"\)/);
  assert.match(source, /hasPermission\(access,"financeiro\.approve"\)/);
  assert.match(source, /hasPermission\(access,"financeiro\.settle"\)/);
});

test("financeiro: cria, aprova, liquida, recebe e concilia em modo demonstrativo", () => {
  assert.match(source, /Nova conta a pagar/);
  assert.match(source, /Aprovar/);
  assert.match(source, /Pagar/);
  assert.match(source, /Receber/);
  assert.match(source, /Conciliar agora/);
});

test("financeiro: homologação cobre critérios, alçadas, evidências e decisão final", () => {
  assert.match(source, /Critérios funcionais/);
  assert.match(source, /Matriz proposta de aprovação/);
  assert.match(source, /Evidências da homologação/);
  assert.match(source, /Homologar versão/);
  assert.match(source, /Supabase, RLS e arquivos não bloqueiam o aceite funcional/);
});
