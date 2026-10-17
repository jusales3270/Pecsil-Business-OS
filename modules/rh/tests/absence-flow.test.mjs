import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh: férias e ausências cobre solicitação, mapa por setor e políticas", () => {
  assert.match(source, /Nova solicitação/);
  // O calendário com período fixo (julho a setembro de 2026) deu lugar ao mapa por setor (R-03).
  assert.match(source, /<FeriasPorSetor\/>/);
  assert.doesNotMatch(source, /Julho a setembro de 2026/);
  assert.match(source, /AbsencePolicies/);
  assert.match(source, /Saldo projetado após aprovação/);
  assert.match(source, /Conflito de planejamento/);
});

test("rh: decisão de ausência exige permissão explícita", () => {
  assert.match(source, /canUseFeature\(access, "rh\.ferias", "aprovar"\)/);
  assert.match(source, /canApprove && actionable/);
  assert.match(source, /Aprovar solicitação/);
  assert.match(source, /Reprovar/);
});
