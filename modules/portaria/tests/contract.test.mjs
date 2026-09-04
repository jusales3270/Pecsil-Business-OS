import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");
const permissions = await readFile(new URL("../permissions.ts", import.meta.url), "utf8");
const registry = await readFile(new URL("../../registry.ts", import.meta.url), "utf8");

test("portaria: nasce registrado, ativo e protegido", () => {
  assert.match(manifest, /entryPermission: PORTARIA_PERMISSIONS\.view/);
  assert.match(manifest, /enabled: true/);
  assert.match(permissions, /portaria\.visitas/);
  assert.match(permissions, /portaria\.frota/);
  assert.match(permissions, /portaria\.encomendas/);
  assert.match(registry, /portariaModuleManifest/);
});
