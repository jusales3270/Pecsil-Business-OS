import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { rankSuggestions, productCatalog, isExactOnly } = await import("../lib/compras/sugestoes-core.ts");

const s = (value, weight = 0, alsoMatches) => ({ value, weight, alsoMatches });

test("menos de 2 letras não sugere", () => {
  assert.deepEqual(rankSuggestions("p", [s("PLAM")]), []);
});

test("começo do nome vem antes de começo de palavra, que vem antes de trecho", () => {
  const lista = [s("CAIXA PLAM"), s("PLAMONT"), s("PLAM EMBALAGENS", 5), s("EMPLAMAR")];
  assert.deepEqual(rankSuggestions("plam", lista).map((x) => x.value), ["PLAM EMBALAGENS", "PLAMONT", "CAIXA PLAM", "EMPLAMAR"]);
});

test("ignora acento e maiúscula e acha pelo apelido unificado", () => {
  assert.equal(rankSuggestions("camargo pec", [s("CAMARGO PEÇAS")])[0].value, "CAMARGO PEÇAS");
  assert.equal(rankSuggestions("mercobroz", [s("MERCOBRONZE", 0, ["MERCOBROZE"])])[0].value, "MERCOBRONZE");
});

test("sem lista quando o texto já é a única sugestão", () => {
  assert.equal(isExactOnly("plam embalagens", [s("PLAM EMBALAGENS")]), true);
  assert.equal(isExactOnly("plam", [s("PLAM EMBALAGENS")]), false);
});

test("catálogo: grafia mais usada vence, com unidade e último preço", () => {
  const cat = productCatalog([
    { produto: "Lixa Grana 100", unidade: "un", valorUnit: 3, fornecedor: "A", supplierId: "a", data: "2026-07-01" },
    { produto: "LIXA GRANA 100", unidade: "un", valorUnit: 3.2, fornecedor: "B", supplierId: "b", data: "2026-08-01" },
    { produto: "LIXA GRANA 100", unidade: "cx", valorUnit: 0, fornecedor: "B", supplierId: "b", data: "2026-09-01" },
  ]);
  assert.equal(cat.length, 1);
  const [lixa] = cat;
  assert.equal(lixa.value, "LIXA GRANA 100");
  assert.deepEqual(lixa.alsoMatches, ["Lixa Grana 100"]);
  assert.equal(lixa.meta.unidade, "cx");
  assert.equal(lixa.meta.ultimoValor, 3.2, "o último com preço");
  assert.equal(lixa.meta.ultimoFornecedor, "B");
  assert.deepEqual(lixa.meta.fornecedores.sort(), ["a", "b"]);
  assert.equal(lixa.meta.usos, 3);
});
