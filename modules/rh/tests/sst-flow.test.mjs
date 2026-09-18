import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh: SST cobre exames, treinamentos, EPIs e ocorrências", () => {
  assert.match(source, /"Exames"/);
  assert.match(source, /"Treinamentos"/);
  assert.match(source, /"EPIs"/);
  assert.match(source, /"Ocorrências"/);
  assert.match(source, /SstRecordTable/);
});

test("rh: conteúdo clínico permanece protegido", () => {
  assert.match(source, /Conteúdo sensível protegido/);
  assert.match(source, /Resultados clínicos, diagnósticos e anexos médicos não são exibidos/);
  assert.match(source, /Não inclua diagnóstico ou resultado clínico/);
});

test("rh: tratamento de SST exige permissão de aprovação", () => {
  assert.match(source, /hasPermission\(access,"rh\.approve"\)/);
  assert.match(source, /canApprove&&actionable/);
  assert.match(source, /Marcar como conforme/);
});

// O autosserviço mostrava ASO, treinamentos e EPIs fictícios. Agora declara a
// ausência de registros; o escopo próprio continua garantido pelo RLS.
test("rh: autosserviço de SST não exibe registro fictício", () => {
  assert.match(source, /limitadas ao seu próprio cadastro/);
  assert.match(source, /Sem registros em \$\{section\.toLowerCase\(\)\}/);
  assert.doesNotMatch(source, /ASO periódico próximo do vencimento|Válido até 14\/09\/2026/);
});
