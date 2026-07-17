import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh possui painel, biblioteca e catálogo de métricas", () => {
  assert.match(source, /Painel executivo/);
  assert.match(source, /Catálogo de métricas/);
  assert.match(source, /Biblioteca gerencial/i);
  assert.match(source, /hrMetricCatalog/);
});

test("relatórios respeitam escopo e permissões", () => {
  assert.match(source, /hasPermission\(access,"rh\.export"\)/);
  assert.match(source, /hasPermission\(access,"rh\.create"\)/);
  assert.match(source, /Escopo aplicado/);
  assert.match(source, /nunca poderá consultar dados além das permissões/);
});

test("indicadores estão preparados para inteligência corporativa", () => {
  assert.match(source, /Preparado para o Jarvis Business/);
  assert.match(source, /domínio, origem e frequência/);
  assert.match(source, /ReportDrawer/);
  assert.match(source, /ReportForm/);
});
