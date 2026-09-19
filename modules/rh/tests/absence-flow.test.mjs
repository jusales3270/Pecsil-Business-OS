import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../app/components/hr-module.tsx", import.meta.url), "utf8");

test("rh: férias e ausências cobre solicitação, calendário e políticas", () => {
  assert.match(source, /Nova solicitação/);
  assert.match(source, /AbsenceCalendar/);
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
