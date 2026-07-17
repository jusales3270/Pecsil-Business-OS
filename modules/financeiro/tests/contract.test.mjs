import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");
const registry = await readFile(new URL("../../registry.ts", import.meta.url), "utf8");

test("financeiro: nasce registrado, ativo e protegido", () => {
  assert.match(manifest, /entryPermission: FINANCE_PERMISSIONS\.view/);
  assert.match(manifest, /enabled: true/);
  assert.match(manifest, /financeiro\.payable\.approve/);
  assert.match(manifest, /financeiro\.bank\.reconcile/);
  assert.match(registry, /financeModuleManifest/);
});
