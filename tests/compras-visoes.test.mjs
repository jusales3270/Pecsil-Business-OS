import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { availableViews, comprasCaps, tabsFor } = await import("../modules/compras/src/lib/access.ts");

const conta = (grants, extra = {}) => ({ isOwner: false, jobTitle: null, grants, permissions: [], scopes: [], ...extra });
const visoes = (acesso) => availableViews(comprasCaps(acesso), acesso);
const tudo = { "compras.cotacoes": "operar", "compras.aprovacoes": "aprovar", "compras.realizadas": "operar" };

test("diretor vê só a visão de Gestor, mesmo com cotações liberadas", () => {
  assert.deepEqual(visoes(conta(tudo, { jobTitle: "diretor" })), ["GESTOR"]);
  // Caso real: aprovar + compras realizadas.
  const ricardo = conta({ "compras.aprovacoes": "aprovar", "compras.realizadas": "operar" }, { jobTitle: "diretor" });
  assert.deepEqual(visoes(ricardo), ["GESTOR"]);
  const abas = tabsFor("GESTOR", comprasCaps(ricardo)).map((t) => t.page);
  assert.deepEqual(abas, ["dashboard", "pendentes", "historico", "compras"]);
});

test("gerente, assistente e estagiário veem só a visão de Orçamentista", () => {
  for (const cargo of ["gerente", "assistente", "estagiario"]) {
    assert.deepEqual(visoes(conta(tudo, { jobTitle: cargo })), ["ORCAMENTISTA"], cargo);
  }
});

test("sem nada do Compras liberado, o cargo não abre visão", () => {
  assert.deepEqual(visoes(conta({ "rh.ferias": "ver" }, { jobTitle: "diretor" })), []);
  assert.deepEqual(visoes(conta({}, { jobTitle: "assistente" })), []);
});

test("proprietário e contas sem cargo seguem as funcionalidades liberadas", () => {
  assert.deepEqual(visoes(conta(tudo, { isOwner: true, jobTitle: "diretor" })), ["ORCAMENTISTA", "GESTOR"]);
  assert.deepEqual(visoes(conta(tudo)), ["ORCAMENTISTA", "GESTOR"]);
  assert.deepEqual(visoes(conta({ "compras.cotacoes": "operar" })), ["ORCAMENTISTA"]);
});
