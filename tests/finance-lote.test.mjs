import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { motivoFora, separar, resumoFora, executarLote, ORDEM_LOTE, PERMISSAO_LOTE } = await import("../lib/finance/lote-core.ts");

const HOJE = "2026-11-18";
const titulo = (id, { status = "open", venc = "2026-12-15", valor = 100, pago = 0, parcelas, revisar = null } = {}) => ({
  id, status, issueDate: "2026-11-01", originalAmount: valor, paidAmount: pago, reviewReason: revisar,
  installments: parcelas ?? [{ dueDate: venc, amount: valor, settledAmount: pago }],
});

test("baixa em lote: só título em aberto, fora da aprovação e com saldo", () => {
  assert.equal(motivoFora("baixar", titulo("a"), HOJE), null);
  assert.equal(motivoFora("baixar", titulo("b", { venc: "2026-10-01" }), HOJE), null, "vencido também paga");
  assert.equal(motivoFora("baixar", titulo("c", { pago: 40 }), HOJE), null, "parcial paga o saldo");
  assert.equal(motivoFora("baixar", titulo("d", { status: "pending_approval" }), HOJE), "ainda em aprovação");
  assert.equal(motivoFora("baixar", titulo("e", { status: "cancelled" }), HOJE), "não está em aberto");
  assert.equal(motivoFora("baixar", titulo("f", { status: "settled", pago: 100 }), HOJE), "não está em aberto");
});

test("aprovar só o que está em aprovação; cancelar só o que está em aberto", () => {
  assert.equal(motivoFora("aprovar", titulo("a", { status: "pending_approval" }), HOJE), null);
  assert.equal(motivoFora("aprovar", titulo("b"), HOJE), "não está em aprovação");
  assert.equal(motivoFora("cancelar", titulo("c", { status: "pending_approval" }), HOJE), null);
  assert.equal(motivoFora("cancelar", titulo("d", { status: "cancelled" }), HOJE), "não está em aberto");
});

test("vencimento só em parcela única sem baixa; conferido só com aviso de revisar", () => {
  assert.equal(motivoFora("vencimento", titulo("a"), HOJE), null);
  assert.equal(motivoFora("vencimento", titulo("b", { pago: 10 }), HOJE), "já tem baixa");
  const duas = [{ dueDate: "2026-12-01", amount: 50, settledAmount: 0 }, { dueDate: "2027-01-01", amount: 50, settledAmount: 0 }];
  assert.equal(motivoFora("vencimento", titulo("c", { parcelas: duas }), HOJE), "tem mais de uma parcela");
  assert.equal(motivoFora("conferido", titulo("d", { revisar: "valor diferente do relatório" }), HOJE), null);
  assert.equal(motivoFora("conferido", titulo("e"), HOJE), "não tem aviso de revisar");
  assert.equal(motivoFora("conta", titulo("f", { status: "cancelled" }), HOJE), null);
  assert.equal(motivoFora("excluir", titulo("g", { status: "settled", pago: 100 }), HOJE), null);
});

test("separar avisa quem fica fora, agrupado pelo motivo", () => {
  const lista = [titulo("a"), titulo("b", { status: "pending_approval" }), titulo("c", { status: "pending_approval" }), titulo("d", { status: "cancelled" })];
  const { entram, fora } = separar("baixar", lista, HOJE);
  assert.deepEqual(entram.map((t) => t.id), ["a"]);
  assert.equal(resumoFora(fora), "2 ainda em aprovação · 1 não está em aberto");
});

test("toda ação tem permissão e as de dinheiro são de quem aprova", () => {
  for (const a of ORDEM_LOTE) assert.ok(PERMISSAO_LOTE[a]);
  for (const a of ["baixar", "aprovar", "cancelar", "excluir"]) assert.equal(PERMISSAO_LOTE[a], "aprovar");
});

test("executarLote: uma falha não para as outras e o avanço chega ao total", async () => {
  const lista = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}` }));
  const avancos = [];
  let aoMesmoTempo = 0, pico = 0;
  const falhas = await executarLote(lista, async (t) => {
    pico = Math.max(pico, ++aoMesmoTempo);
    await new Promise((r) => setTimeout(r, 5));
    aoMesmoTempo--;
    if (t.id === "t3") return "Sem permissão para esta alteração.";
    if (t.id === "t5") throw new Error("rede");
    return null;
  }, (n) => avancos.push(n), 3);
  assert.deepEqual(falhas.map((f) => [f.titulo.id, f.erro]), [["t3", "Sem permissão para esta alteração."], ["t5", "Não foi possível concluir."]]);
  assert.equal(avancos.at(-1), 9);
  assert.ok(pico <= 3, "no máximo 3 ao mesmo tempo");
});
