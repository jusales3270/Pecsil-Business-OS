import assert from "node:assert/strict";
import test from "node:test";
import { calcularSaving, comparar, diasPagamento } from "../lib/compras/comparativo.ts";

const item = (produto, valorUnit, extra = {}) => ({ produto, quantidade: 10, valorUnit, ipi: 0, prazo: "30 DDL", ...extra });
const prop = (id, fornecedor, prazoEntrega, itens) => ({ cotacaoId: id, fornecedor, prazoEntrega, itens });

test("comparativo: prazo de pagamento lido do texto", () => {
  assert.equal(diasPagamento("30/60/90 DDL"), 60);
  assert.equal(diasPagamento("À vista"), 0);
  assert.equal(diasPagamento("28 dias"), 28);
  assert.equal(diasPagamento(""), null);
});

test("comparativo: selos e regra 'primeiro quem entrega no prazo, depois o menor custo'", () => {
  const propostas = [
    prop(1, "BARATO ATRASADO", "2026-11-20", [item("BROCA", 9, { prazo: "28 DDL" })]),
    prop(2, "MEDIO NO PRAZO", "2026-11-05", [item("BROCA", 10, { prazo: "60 DDL" })]),
    prop(3, "CARO RAPIDO", "2026-11-01", [item("BROCA", 12)]),
  ];
  const { linhas, ninguemNoPrazo } = comparar(propostas, "2026-11-10");
  const por = Object.fromEntries(linhas.map((l) => [l.fornecedor, l]));
  assert.deepEqual(por["BARATO ATRASADO"].selos, ["preco"]);
  assert.deepEqual(por["CARO RAPIDO"].selos, ["entrega"]);
  assert.deepEqual(por["MEDIO NO PRAZO"].selos, ["pagamento"]);
  assert.equal(por["MEDIO NO PRAZO"].recomendada, true, "o mais barato entre os que entregam no prazo");
  assert.equal(por["BARATO ATRASADO"].noPrazo, false);
  assert.equal(ninguemNoPrazo, false);
  // Sem data no pedido: menor custo.
  assert.equal(comparar(propostas, null).linhas.find((l) => l.recomendada).fornecedor, "BARATO ATRASADO");
  // Ninguém no prazo: quem chega primeiro, com aviso.
  const tarde = comparar(propostas, "2026-10-20");
  assert.equal(tarde.ninguemNoPrazo, true);
  assert.equal(tarde.linhas.find((l) => l.recomendada).fornecedor, "CARO RAPIDO");
});

test("comparativo: economia contra a maior cotação, a última compra e o prazo de pagamento", () => {
  const escolhida = prop(2, "MEDIO", "2026-11-05", [item("Broca HSS  10mm", 10, { prazo: "60 DDL", materialId: "m1" }), item("Item só aqui", 5)]);
  const outras = [prop(1, "A", null, [item("BROCA HSS 10MM", 12, { materialId: "m1" })]), prop(3, "B", null, [item("outra coisa", 1, { prazo: "28 DDL" })])];
  const s = calcularSaving(escolhida, outras, [
    { produto: "x", materialId: "m1", valorUnit: 11, data: "2026-09-01" },
    { produto: "x", materialId: "m1", valorUnit: 13, data: "2026-12-01" },
  ], "2026-10-17");
  assert.equal(s.vsMaior, 20, "(12 − 10) × 10");
  assert.equal(s.vsUltimaCompra, 10, "última compra antes da cotação: 11 × 10 − 10 × 10");
  assert.equal(s.ganhoPagamentoDias, 32, "60 DDL contra 28 DDL");
  assert.equal(s.concorrentes, 2);
  assert.equal(s.itensComparados, 1);
});
