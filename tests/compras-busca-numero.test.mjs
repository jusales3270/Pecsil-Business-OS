import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { numeroDaBusca, sugestoesPorNumero } from "../lib/compras/busca-numero.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("busca por número: só número, com ou sem OC/cotação na frente", () => {
  assert.equal(numeroDaBusca("329"), "329");
  assert.equal(numeroDaBusca(" 32 "), "32");
  assert.equal(numeroDaBusca("OC 329"), "329");
  assert.equal(numeroDaBusca("oc nº 329"), "329");
  assert.equal(numeroDaBusca("Cotação nº 329"), "329");
  assert.equal(numeroDaBusca("cotacao 329"), "329");
  assert.equal(numeroDaBusca("#329"), "329");
  assert.equal(numeroDaBusca("0329"), "329");
  assert.equal(numeroDaBusca("G.H METAIS"), null, "texto continua sendo busca por fornecedor ou produto");
  assert.equal(numeroDaBusca("barra 19"), null);
  assert.equal(numeroDaBusca(""), null);
});

test("busca por número: o exato primeiro; com OC, a mesma compra vem como cotação e como OC", () => {
  const compras = [{ id: 3215 }, { id: 329 }, { id: 32 }, { id: 328 }, { id: 41 }];
  const comOC = new Set([329, 32]);
  const s = sugestoesPorNumero(compras, "32", (c) => comOC.has(c.id));
  assert.deepEqual(s.map((x) => `${x.tipo}:${x.id}`), ["cotacao:32", "oc:32", "cotacao:328", "cotacao:329", "oc:329", "cotacao:3215"]);
  assert.deepEqual(sugestoesPorNumero(compras, "329", (c) => comOC.has(c.id)).map((x) => `${x.tipo}:${x.id}`), ["cotacao:329", "oc:329"]);
  assert.deepEqual(sugestoesPorNumero(compras, "328", (c) => comOC.has(c.id)).map((x) => `${x.tipo}:${x.id}`), ["cotacao:328"], "sem OC, só a cotação");
  assert.deepEqual(sugestoesPorNumero(compras, "9", () => true), []);
  assert.equal(sugestoesPorNumero(Array.from({ length: 30 }, (_, i) => ({ id: 100 + i })), "1", () => false).length, 6, "até 6 compras");
});

test("Minhas Cotações: a busca procura o número nas cotações da pessoa e abre detalhes ou a OC", () => {
  const pagina = ler("modules/compras/src/pages/CotacoesPage.tsx");
  assert.match(pagina, /<BuscaCompraInput/);
  assert.match(pagina, /onCotacao=\{c => setDetailModal\(c\)\}/);
  assert.match(pagina, /onOC=\{c => abrirOrdemDeCompra\(c\.id\)\}/);
  assert.match(pagina, /String\(c\.id\)\.startsWith\(numero\)/, "a tabela também filtra pelo número");
});
