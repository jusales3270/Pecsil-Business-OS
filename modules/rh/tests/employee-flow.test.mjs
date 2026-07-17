import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh: cadastro de colaborador possui etapas e ficha individual", () => {
  assert.match(source, /Dados pessoais/);
  assert.match(source, /Vínculo/);
  assert.match(source, /Contato e acesso/);
  assert.match(source, /EmployeeDrawer/);
  assert.match(source, /Documentos/);
  assert.match(source, /Histórico/);
});

test("rh: criação e edição respeitam a permissão do módulo", () => {
  assert.match(source, /hasPermission\(access, "rh\.create"\)/);
  assert.match(source, /canCreate && <Button/);
  assert.match(source, /canEdit=\{canCreate\}/);
});
