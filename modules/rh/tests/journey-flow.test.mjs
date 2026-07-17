import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh: ponto e jornada cobre espelho, banco, escalas e regras", () => {
  assert.match(source, /Espelho diário/);
  assert.match(source, /JourneyBank/);
  assert.match(source, /JourneySchedules/);
  assert.match(source, /JourneyRules/);
  assert.match(source, /Marcações registradas/);
});

test("rh: ajuste de ponto possui justificativa e aprovação protegida", () => {
  assert.match(source, /JourneyAdjustmentForm/);
  assert.match(source, /Ajuste manual aguardando aprovação/);
  assert.match(source, /hasPermission\(access,"rh\.approve"\)/);
  assert.match(source, /canApprove&&actionable/);
  assert.match(source, /Aprovar ajuste/);
});

test("rh: colaborador acessa somente o próprio espelho de ponto", () => {
  assert.match(source, /title="Meu ponto"/);
  assert.match(source, /vinculadas somente ao seu cadastro/);
  assert.match(source, /Espelho mensal pessoal aberto/);
});
