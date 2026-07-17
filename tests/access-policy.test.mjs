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
