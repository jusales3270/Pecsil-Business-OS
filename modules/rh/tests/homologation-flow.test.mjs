import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hr = readFileSync(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../../app/page.tsx", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../manifest.ts", import.meta.url), "utf8");

test("homologação é exclusiva para administração do RH", () => {
  assert.match(hr, /"Homologação": "rh\.homologacao"/);
  assert.match(hr, /section === "Homologação" && <HomologationSection/);
});

test("homologação real: critérios da Fase 2, conferência do banco e registro por perfil (R-01)", () => {
  assert.match(hr, /CRITÉRIOS DE SAÍDA/);
  assert.match(hr, /Homologado por dois perfis reais/);
  assert.match(hr, /CONFERÊNCIA DOS DADOS/);
  assert.match(hr, /fetch\("\/api\/rh\/homologacao"/);
  // Nada de aceite cenográfico: nem placar fixo nem "100%" escrito à mão.
  assert.doesNotMatch(hr, /8\/8|30 verificações aprovadas|ambiente demonstrativo|236 de 246/);
});

test("RH sem caminho de demonstração: ação sem banco vira erro e nada fica só na tela", () => {
  assert.match(hr, /if \(code === "DEMO_MODE"\) throw new Error\("RH_SEM_BANCO"\)/);
  assert.doesNotMatch(hr, /dados demonstrativos|demonstração local|Estimativa demonstrativa|Janeiro de 2027/);
  assert.match(hr, /\/api\/rh\/documentos\/\$\{record\.sourceId\}\/conferir/);
});

test("ações do RH alimentam notificações e auditoria centrais", () => {
  assert.match(shell, /recordOperationalEvent/);
  assert.match(shell, /NotificationsView notify=\{notify\} events=\{operationalEvents\}/);
  // A auditoria lê a trilha do banco (as ações do RH são gravadas pelos gatilhos de auditoria).
  assert.match(shell, /view==="Auditoria"\?<AuditoriaCentral\/>/);
  assert.match(hr, /notify\(message\);onEvent\(message\)/);
});

test("manifesto homologado declara serviços e eventos críticos", () => {
  assert.match(manifest, /version: "1\.1\.0"/);
  assert.match(manifest, /"notifications", "audit"/);
  assert.match(manifest, /rh\.module\.homologate/);
  assert.match(manifest, /rh\.document\.approve/);
});
