import assert from "node:assert/strict";
import test from "node:test";
import { ehOrdemDeCompra, rotuloCompra, rotuloOC } from "../lib/compras/rotulo.ts";

test("nome pela fase: cotação até a aprovação, OC depois, mesmo número", () => {
  assert.equal(rotuloCompra({ id: 283, status: "PENDENTE" }), "Cotação nº 283");
  assert.equal(rotuloCompra({ id: 283, status: "REJEITADO", produtos: [{ status: "REJEITADO" }] }), "Cotação nº 283");
  assert.equal(rotuloCompra({ id: 283, status: "APROVADO" }), "OC nº 283");
  assert.equal(rotuloCompra({ id: 283, status: "COMPRADO" }), "OC nº 283");
  // Aprovação parcial: algum item aprovado já é OC (só esses itens entram nela).
  assert.equal(rotuloCompra({ id: 283, status: "PENDENTE", produtos: [{ status: "APROVADO" }, { status: "PENDENTE" }] }), "OC nº 283");
  assert.equal(rotuloOC(283), "OC nº 283");
});

test("compra direta já nasce OC", () => {
  assert.equal(ehOrdemDeCompra({ id: 9, status: "COMPRADO", origem: "direta" }), true);
  assert.equal(rotuloCompra({ id: 9, status: "COMPRADO", origem: "direta" }), "OC nº 9 · compra direta");
  assert.equal(rotuloCompra({ id: 9, status: "COMPRADO", origem: "direta" }, { curto: true }), "OC nº 9");
});
