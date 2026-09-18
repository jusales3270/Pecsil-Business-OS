import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

// Os indicadores dependem de ponto, benefícios e SST com registros reais. Até
// lá a seção declara isso; antes exibia gráficos e métricas inventados.
test("rh: relatórios declaram a origem pendente em vez de indicadores fictícios", () => {
  assert.match(source, /Nenhum indicador disponível/);
  assert.match(source, /a partir do ponto, dos benefícios e da SST/);
  assert.doesNotMatch(source, /hrMetricCatalog|Catálogo de métricas|Painel executivo/);
});

test("rh: nenhuma tela do módulo mostra colaborador fictício", () => {
  for (const nome of ["Mariana Costa", "Lucas Martins", "Camila Ferreira", "Ricardo Alves", "Ana Souza"]) {
    assert.doesNotMatch(source, new RegExp(nome));
  }
  assert.doesNotMatch(source, /Matriz Boituva|Unidade Industrial/);
});
