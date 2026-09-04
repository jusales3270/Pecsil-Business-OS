import assert from "node:assert/strict";
import test from "node:test";
import { hasAnyPermission, hasPermission } from "../modules/access-policy.ts";

test("proprietário possui todas as permissões", () => {
  assert.equal(hasPermission({ permissions: ["*"] }, "platform.settings.view"), true);
});

test("curinga do domínio não libera outro domínio", () => {
  const context = { permissions: ["rh.*"] };
  assert.equal(hasPermission(context, "rh.edit"), true);
  assert.equal(hasPermission(context, "core.access.admin"), false);
});

test("permissão explícita limita a ação", () => {
  const context = { permissions: ["rh.view"] };
  assert.equal(hasPermission(context, "rh.view"), true);
  assert.equal(hasPermission(context, "rh.approve"), false);
  assert.equal(hasAnyPermission(context, ["rh.edit", "rh.approve"]), false);
});

function canAccess(context, manifest) {
  if (!manifest.enabled) return false;
  if (!hasPermission(context, manifest.access.entryPermission)) return false;
  return context.scopes.some(
    (scope) => scope.type !== "module" || !scope.moduleCode || scope.moduleCode === manifest.code,
  );
}

test("escopo restrito a Compras: acessa Compras e é bloqueado em RH, Financeiro e Portaria", () => {
  const comprasContext = {
    permissions: ["compras.view", "compras.create", "compras.edit", "compras.approve"],
    scopes: [{ type: "module", moduleCode: "compras" }],
  };

  const comprasManifest = { code: "compras", enabled: true, access: { entryPermission: "compras.view" } };
  const rhManifest = { code: "rh", enabled: true, access: { entryPermission: "rh.view" } };
  const finManifest = { code: "financeiro", enabled: true, access: { entryPermission: "financeiro.view" } };
  const portariaManifest = { code: "portaria", enabled: true, access: { entryPermission: "portaria.view" } };

  assert.equal(canAccess(comprasContext, comprasManifest), true);
  assert.equal(canAccess(comprasContext, rhManifest), false);
  assert.equal(canAccess(comprasContext, finManifest), false);
  assert.equal(canAccess(comprasContext, portariaManifest), false);
});

test("escopo restrito a Portaria: acessa Portaria e é bloqueado em RH, Financeiro e Compras", () => {
  const portariaContext = {
    permissions: ["portaria.view", "portaria.create", "portaria.edit"],
    scopes: [{ type: "module", moduleCode: "portaria" }],
  };

  const comprasManifest = { code: "compras", enabled: true, access: { entryPermission: "compras.view" } };
  const rhManifest = { code: "rh", enabled: true, access: { entryPermission: "rh.view" } };
  const finManifest = { code: "financeiro", enabled: true, access: { entryPermission: "financeiro.view" } };
  const portariaManifest = { code: "portaria", enabled: true, access: { entryPermission: "portaria.view" } };

  assert.equal(canAccess(portariaContext, portariaManifest), true);
  assert.equal(canAccess(portariaContext, comprasManifest), false);
  assert.equal(canAccess(portariaContext, rhManifest), false);
  assert.equal(canAccess(portariaContext, finManifest), false);
});


