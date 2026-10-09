import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");
const migracao = await readFile(new URL("../../../supabase/migrations/202610090002_fundicao_pedidos.sql", import.meta.url), "utf8");

test("fundicao: módulo ativo, protegido e no menu logo depois do Almoxarifado", () => {
  assert.match(manifest, /id: "fundicao"/);
  assert.match(manifest, /entryPermission: FUNDICAO_PERMISSIONS\.view/);
  assert.match(manifest, /enabled: true/);
  assert.match(manifest, /menu: \{ enabled: true, order: 46 \}/);
});

test("fundicao: pedido só pela função do banco, que exige a permissão e força a origem", () => {
  assert.match(migracao, /has_feature\('fundicao\.pedidos', 'operar'\)/);
  assert.match(migracao, /origem = 'FUNDICAO'/);
  assert.match(migracao, /'FUNDICAO', 'FUNDICAO'/);
});
