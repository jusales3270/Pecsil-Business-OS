import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh: benefícios cobre catálogo, participantes, solicitações e políticas", () => {
  assert.match(source, /BenefitParticipants/);
  assert.match(source, /BenefitPolicies/);
  assert.match(source, /Solicitações de benefícios/);
  assert.match(source, /Custo mensal estimado/);
  assert.match(source, /Elegibilidade/);
});

test("rh: movimentação de benefício possui fluxo protegido", () => {
  assert.match(source, /BenefitRequestForm/);
  assert.match(source, /Sem alteração automática/);
  assert.match(source, /canUseFeature\(access,"rh\.beneficios","aprovar"\)/);
  assert.match(source, /canApprove&&actionable/);
  assert.match(source, /Aprovar solicitação/);
});

test("rh: gestão de benefícios não inclui folha de pagamento", () => {
  assert.match(source, /sem integração com folha de pagamento/i);
  assert.match(source, /Dados protegidos por escopo/);
});
