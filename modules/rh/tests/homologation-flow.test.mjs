import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hr = readFileSync(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../../app/page.tsx", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.ts", import.meta.url), "utf8");

test("homologação é exclusiva para administração do RH", () => {
  assert.match(hr, /label!=="Homologação"\|\|hasPermission\(access,"rh\.admin"\)/);
  assert.match(hr, /section === "Homologação" && <HomologationSection/);
});

test("aceite cobre áreas, perfis e dependência conhecida", () => {
  assert.match(hr, /8\/8/);
  assert.match(hr, /Comportamento por perfil/);
  assert.match(hr, /Dependência conhecida: persistência/);
  assert.match(hr, /funcionalmente fechado no ambiente demonstrativo/);
});

test("ações do RH alimentam notificações e auditoria centrais", () => {
  assert.match(shell, /recordOperationalEvent/);
  assert.match(shell, /NotificationsView notify=\{notify\} events=\{operationalEvents\}/);
  assert.match(shell, /AuditView notify=\{notify\} events=\{operationalEvents\}/);
  assert.match(hr, /notify\(message\);onEvent\(message\)/);
});

test("manifesto homologado declara serviços e eventos críticos", () => {
  assert.match(manifest, /version: "1\.1\.0"/);
  assert.match(manifest, /"notifications", "audit"/);
  assert.match(manifest, /rh\.module\.homologate/);
  assert.match(manifest, /rh\.document\.approve/);
});
