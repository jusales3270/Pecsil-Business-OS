import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

// Ponto e jornada não tem fonte de dados: a integração com o relógio de ponto
// ainda não existe. A tela declara isso em vez de exibir presença, banco de
// horas e escalas fictícios (o que havia antes).
test("rh: ponto e jornada declara a ausência de integração em vez de dados fictícios", () => {
  assert.match(source, /Nenhuma marcação registrada/);
  assert.match(source, /relógio de ponto \(Secullum\)/);
  assert.doesNotMatch(source, /JourneyBank|JourneySchedules|JourneyRules/);
});

test("rh: autosserviço do colaborador não inventa saldos nem marcações", () => {
  assert.match(source, /function EmployeeSelfService/);
  assert.match(source, /Sem registros em \$\{section\.toLowerCase\(\)\}/);
  assert.doesNotMatch(source, /Espelho mensal pessoal aberto/);
});
