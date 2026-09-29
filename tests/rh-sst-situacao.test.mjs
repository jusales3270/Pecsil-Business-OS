import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { situacaoSst, diasAte, hojeBrasilia, JANELA_ALERTA_DIAS } = await import("../lib/rh/sst-situacao.ts");

const HOJE = "2026-09-29";
const r = (dueDate, extra = {}) => ({ category: "exam", dueDate, status: "scheduled", risk: "attention", ...extra });
const ate = (dias) => new Date(Date.UTC(2026, 8, 29 + dias)).toISOString().slice(0, 10);

test("exame: vencido, janela de 60 dias e regular", () => {
  assert.deepEqual(situacaoSst(r(ate(-1)), HOJE), { status: "overdue", risk: "critical" });
  assert.deepEqual(situacaoSst(r(ate(0)), HOJE), { status: "due_soon", risk: "attention" }, "vence hoje");
  assert.deepEqual(situacaoSst(r(ate(1)), HOJE), { status: "due_soon", risk: "attention" });
  assert.deepEqual(situacaoSst(r(ate(JANELA_ALERTA_DIAS)), HOJE), { status: "due_soon", risk: "attention" });
  assert.deepEqual(situacaoSst(r(ate(61)), HOJE), { status: "compliant", risk: "regular" });
  assert.deepEqual(situacaoSst(r("2027-08-13"), HOJE), { status: "compliant", risk: "regular" }, "caso do print da Rosana");
});

test("treinamento segue a mesma regra", () => {
  assert.deepEqual(situacaoSst(r(ate(10), { category: "training" }), HOJE), { status: "due_soon", risk: "attention" });
});

test("fica como gravado: em análise, EPI, ocorrência e sem data", () => {
  assert.deepEqual(situacaoSst(r(ate(-5), { status: "under_review", risk: "attention" }), HOJE), { status: "under_review", risk: "attention" });
  assert.deepEqual(situacaoSst(r(ate(-5), { category: "ppe" }), HOJE), { status: "scheduled", risk: "attention" });
  assert.deepEqual(situacaoSst(r(ate(-5), { category: "incident", status: "compliant", risk: "regular" }), HOJE), { status: "compliant", risk: "regular" });
  assert.deepEqual(situacaoSst(r(null), HOJE), { status: "scheduled", risk: "attention" });
});

test("dias corridos e 'hoje' no fuso de Brasília", () => {
  assert.equal(diasAte("2026-11-28", HOJE), 60);
  assert.equal(diasAte("2026-09-28", HOJE), -1);
  // 01:30 UTC de 30/09 ainda é 29/09 em Brasília (22:30).
  assert.equal(hojeBrasilia(new Date("2026-09-30T01:30:00Z")), "2026-09-29");
  assert.equal(hojeBrasilia(new Date("2026-09-30T03:30:00Z")), "2026-09-30");
});
