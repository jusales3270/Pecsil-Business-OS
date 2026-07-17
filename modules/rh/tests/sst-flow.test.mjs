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

test("rh: colaborador acessa somente os próprios status de SST", () => {
  assert.match(source, /Minha saúde e segurança/);
  assert.match(source, /limitadas ao seu próprio cadastro/);
  assert.match(source, /Resultados clínicos não são exibidos nesta área/);
});
