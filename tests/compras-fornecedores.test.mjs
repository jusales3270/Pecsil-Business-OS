import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { normalizeName, suggestDuplicates, priceHistory, supplierChanges } = await import("../lib/compras/fornecedores-core.ts");
const { comprasCaps, tabsFor } = await import("../modules/compras/src/lib/access.ts");

const conta = (grants) => ({ isOwner: false, jobTitle: null, grants, permissions: [], scopes: [] });

test("normaliza o nome como o banco (acento, pontuação, espaço)", () => {
  assert.equal(normalizeName("  Camargo  E Peças-Ltda. "), "camargo e pecas ltda");
  assert.equal(normalizeName(null), "");
});

test("sugere duplicados por grafia parecida ou mesma primeira palavra", () => {
  const s = [
    { id: "1", name: "MERCOBRONZE" }, { id: "2", name: "MERCOBROZE" },
    { id: "3", name: "OTZI" }, { id: "4", name: "OTZI METALS" },
    { id: "5", name: "PASIFER" }, { id: "6", name: "MG3" },
  ];
  const pares = suggestDuplicates(s).map((d) => [d.a, d.b].sort().join("-"));
  assert.ok(pares.includes("1-2"));
  assert.ok(pares.includes("3-4"));
  assert.ok(!pares.some((p) => p.includes("5") || p.includes("6")));
});

test("preço por produto: último, menor, maior e variação sobre o primeiro", () => {
  const precos = priceHistory([
    { produto: "Lixa Grana 100", valorUnit: 3, quantidade: 50, unidade: "un", data: "2026-07-01" },
    { produto: "LIXA GRANA 100", valorUnit: 3.3, quantidade: 50, unidade: "un", data: "2026-09-01" },
    { produto: "Estopa", valorUnit: 10, quantidade: 1, unidade: "kg", data: "2026-08-01" },
    { produto: "Sem preço", valorUnit: 0, quantidade: 1, unidade: "un", data: "2026-08-01" },
  ]);
  assert.equal(precos.length, 2);
  const lixa = precos.find((p) => p.produto === "LIXA GRANA 100");
  assert.deepEqual([lixa.compras, lixa.ultimo, lixa.menor, lixa.maior, lixa.variacao, lixa.quantidadeTotal], [2, 3.3, 3, 3.3, 10, 100]);
  assert.equal(precos.find((p) => p.produto === "Estopa").variacao, null);
  assert.equal(precos[0].produto, "LIXA GRANA 100", "mais recente primeiro");
});

test("valida o cadastro: CNPJ, UF, e-mail, divisões e nome", () => {
  const ok = supplierChanges({ name: " PLAM ", taxId: "12.345.678/0001-90", state: "sp", email: "compras@plam.com.br", divisions: ["USINAGEM", "USINAGEM"], city: "" });
  assert.deepEqual(ok, { changes: { name: "PLAM", city: null, email: "compras@plam.com.br", tax_id: "12345678000190", state: "SP", divisions: ["USINAGEM"] } });
  assert.ok("error" in supplierChanges({ taxId: "123" }));
  assert.ok("error" in supplierChanges({ state: "São Paulo" }));
  assert.ok("error" in supplierChanges({ email: "sem-arroba" }));
  assert.ok("error" in supplierChanges({ divisions: ["OUTRA"] }));
  assert.ok("error" in supplierChanges({ name: "   " }));
});

test("aba Fornecedores nas duas visões, só com a permissão", () => {
  const com = comprasCaps(conta({ "compras.cotacoes": "operar", "compras.fornecedores": "ver" }));
  assert.ok(tabsFor("ORCAMENTISTA", com).some((t) => t.page === "fornecedores"));
  assert.ok(tabsFor("GESTOR", com).some((t) => t.page === "fornecedores"));
  assert.equal(com.editarFornecedores, false);
  const sem = comprasCaps(conta({ "compras.cotacoes": "operar" }));
  assert.ok(!tabsFor("ORCAMENTISTA", sem).some((t) => t.page === "fornecedores"));
  assert.equal(comprasCaps(conta({ "compras.fornecedores": "operar" })).editarFornecedores, true);
});
