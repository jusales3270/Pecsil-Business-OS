import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// O módulo e as telas que ele monta (títulos a pagar/receber, fluxo, relatórios e bancos).
const source = (await Promise.all(["finance-module.tsx", "finance-titles.tsx", "finance-reports.tsx", "finance-bancos.tsx"].map((file) =>
  readFile(new URL(`../../../app/components/${file}`, import.meta.url), "utf8")))).join("\n");

test("financeiro: cobre os domínios operacionais da versão 1", () => {
  for (const domain of ["Contas a pagar", "Contas a receber", "Fluxo de caixa", "Bancos e conciliação", "Centros de custo", "Relatórios", "Homologação"]) {
    assert.match(source, new RegExp(domain));
  }
});

test("financeiro: ações críticas respeitam permissões", () => {
  assert.match(source, /canUseFeature\(access,"financeiro\.pagar","operar"\)/);
  assert.match(source, /canUseFeature\(access,"financeiro\.pagar","aprovar"\)/);
  assert.match(source, /canUseFeature\(access,"financeiro\.receber","aprovar"\)/);
});

test("financeiro: cria, aprova, liquida, recebe e avisa conciliação pendente", () => {
  assert.match(source, /Nova conta a pagar/);
  assert.match(source, /Aprovar/);
  assert.match(source, /Registrar pagamento/);
  assert.match(source, /Confirmar recebimento/);
  assert.match(source, /Conciliação pendente/);
});

test("financeiro: nenhum dado inventado no módulo (só o que está no banco)", () => {
  // Títulos, contas bancárias, centros e saldos fictícios que existiam na
  // versão demonstrativa não podem voltar para a tela.
  for (const falso of [/Aços Boituva/, /TechMold/, /Cristal Forte/, /Vidros Nacional/, /Banco do Brasil · 4521/, /842350/, /126840/, /R\$ 382\.400/, /initialPayables/, /initialReceivables/]) {
    assert.doesNotMatch(source, falso);
  }
  assert.match(source, /Nenhuma conta bancária cadastrada/);
  assert.match(source, /Nenhum centro de custo cadastrado/);
});

test("financeiro: homologação cobre critérios, alçadas, evidências e decisão final", () => {
  assert.match(source, /Critérios funcionais/);
  assert.match(source, /Matriz proposta de aprovação/);
  assert.match(source, /Evidências da homologação/);
  assert.match(source, /Homologar versão/);
  assert.match(source, /Supabase, RLS e arquivos não bloqueiam o aceite funcional/);
});
