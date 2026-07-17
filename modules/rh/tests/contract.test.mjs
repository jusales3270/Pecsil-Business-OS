import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");

test("rh: possui permissão de entrada e serviços centrais", () => {
  assert.match(manifest, /entryPermission: RH_PERMISSIONS\.view/);
  assert.match(manifest, /sharedServices:/);
  assert.match(manifest, /auditEvents:/);
});
