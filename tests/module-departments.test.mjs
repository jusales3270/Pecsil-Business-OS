import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { moduleRegistry, getDepartmentAreas, getModuleById } = await import("../modules/registry.ts");
const { canAccessModule, getCatalogModules, getVisibleModules } = await import("../modules/access.ts");

/** Contexto mínimo de acesso: só o que essas funções leem. */
const usuario = (grants) => ({ isOwner: false, grants, permissions: [], scopes: [] });
const proprietario = { isOwner: true, grants: {}, permissions: [], scopes: [] };

const comercial = getModuleById("comercial");
const compras = getModuleById("compras");

test("Compras é uma área do Comercial, e o Comercial não é área de ninguém", () => {
  assert.equal(compras.department, "comercial");
  assert.equal(compras.menu.enabled, false);
  assert.equal(comercial.department, undefined);
  assert.deepEqual(
    getDepartmentAreas("comercial").map((area) => area.id),
    ["compras"],
  );
});

test("quem só tem Compras entra pelo departamento Comercial", () => {
  const orcamentista = usuario({ "compras.cotacoes": "operar" });
  assert.equal(canAccessModule(orcamentista, comercial), true);
  assert.equal(canAccessModule(orcamentista, compras), true);
  // No menu aparece o departamento, nunca a área solta.
  const menu = getVisibleModules(orcamentista, moduleRegistry).map((module) => module.id);
  assert.deepEqual(menu, ["comercial"]);
});

test("o menu e o catálogo não listam áreas soltas", () => {
  for (const contexto of [proprietario, usuario({ "compras.cotacoes": "ver", "rh.ferias": "ver" })]) {
    const catalogo = getCatalogModules(contexto, moduleRegistry).map((module) => module.id);
    assert.ok(!catalogo.includes("compras"), "Compras não é card de catálogo");
    assert.ok(catalogo.includes("comercial"), "Comercial é card de catálogo");
    const menu = getVisibleModules(contexto, moduleRegistry).map((module) => module.id);
    assert.ok(!menu.includes("compras"), "Compras não é item de menu");
  }
});

test("quem não tem nada do Comercial não abre o departamento", () => {
  const portaria = usuario({ "portaria.visitas": "operar" });
  assert.equal(canAccessModule(portaria, comercial), false);
});
