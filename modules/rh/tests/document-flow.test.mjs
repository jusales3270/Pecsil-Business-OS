import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("central de documentos possui fluxos operacionais", () => {
  assert.match(source, /Central de documentos/);
  assert.match(source, /Assinaturas/);
  assert.match(source, /Categorias/);
  assert.match(source, /DocumentDrawer/);
  assert.match(source, /DocumentForm/);
});

test("ações documentais respeitam permissões e privacidade", () => {
  assert.match(source, /canUseFeature\(access,"rh\.documentos","operar"\)/);
  assert.match(source, /canUseFeature\(access,"rh\.documentos","aprovar"\)/);
  assert.match(source, /record\.sensitive/);
  assert.match(source, /Privacidade aplicada por escopo/);
});
