import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lerValorEmReais, mediaPorParticipante, valorParaDigitar, vigenciaSugerida } from "../lib/rh/beneficio.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("benefício: valor digitado em reais, do jeito que se escreve no Brasil", () => {
  assert.equal(lerValorEmReais("1.234,56"), 1234.56);
  assert.equal(lerValorEmReais("R$ 85,90"), 85.9);
  assert.equal(lerValorEmReais("120"), 120);
  assert.equal(lerValorEmReais("120.5"), 120.5, "ponto com 1 ou 2 casas é decimal");
  assert.equal(lerValorEmReais("12.500"), 12500, "ponto com 3 dígitos é milhar");
  assert.equal(lerValorEmReais("0"), 0);
  assert.equal(lerValorEmReais("0,00"), 0);
  for (const ruim of ["", "  ", "-10", "abc", "1,234,5", "10,999", "1e5"]) assert.equal(lerValorEmReais(ruim), null, ruim);
});

test("benefício: o valor gravado volta para o campo no formato digitável", () => {
  assert.equal(valorParaDigitar(1234.5), "1.234,50");
  assert.equal(valorParaDigitar(0), "0,00");
  assert.equal(lerValorEmReais(valorParaDigitar(98765.43)), 98765.43);
});

test("benefício: média por participante não divide por zero", () => {
  assert.equal(mediaPorParticipante(1000, 0), null);
  assert.equal(mediaPorParticipante(1000, 4), 250);
});

test("benefício: vigência sugerida é o dia 1º do mês seguinte", () => {
  assert.equal(vigenciaSugerida("2026-10-29"), "2026-11-01");
  assert.equal(vigenciaSugerida("2026-12-05"), "2027-01-01");
  assert.equal(vigenciaSugerida("2027-01-31"), "2027-02-01");
});

test("benefício: tela e servidor ligados (edição dos valores, sem data fixa, sem divisão por zero)", () => {
  const tela = ler("app/components/hr-module.tsx");
  assert.ok(!tela.includes('useState("2026-08-01")'), "vigência não é mais data fixa");
  assert.ok(tela.includes("vigenciaSugerida(hojeBrasilia())"));
  assert.ok(tela.includes('entity:"benefit_plan"') && tela.includes("Editar valores"));
  assert.ok(tela.includes('className="benefit-adhesion"'), "texto da adesão fora da barra");
  const servidor = ler("lib/data/rh-mutations.ts");
  assert.ok(servidor.includes('mutation.entity === "benefit_plan"') && servidor.includes("monthly_cost:"));
});

test("benefício: a movimentação leva vários benefícios, cada um com o valor mensal", () => {
  const tela = ler("app/components/hr-module.tsx");
  assert.ok(tela.includes("Incluir outro benefício") && tela.includes("Valor mensal (R$) *"));
  assert.ok(tela.includes('entity:"benefit_requests"') && tela.includes("monthlyValue:request.value"));
  const servidor = ler("lib/data/rh-mutations.ts");
  assert.ok(servidor.includes("export async function createRhBenefitRequests") && servidor.includes("monthly_value: valorMensal(draft.monthlyValue)"));
  assert.ok(servidor.includes("new Set(drafts.map(d => d.planId)).size !== drafts.length"), "benefício repetido é recusado");
  assert.ok(ler("lib/data/rh-repository.ts").includes("monthly_value,requested_at"));
  assert.ok(ler("supabase/migrations/202610290004_rh_beneficio_valor_solicitacao.sql").includes("add column if not exists monthly_value numeric(18,2)"));
});
