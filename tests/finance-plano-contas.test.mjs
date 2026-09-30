import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { buildTree, checkMove, compareAccounts, filterTree, nextCode, validateCode } = await import("../lib/finance/plano-contas-core.ts");

const c = (id, code, parentId = null, extra = {}) => ({ id, code, name: `Conta ${id}`, parentId, managementType: "despesa_variavel", allowsPosting: true, active: true, ...extra });

const CONTAS = [
  c("g2", "02"), c("g4", "04"), c("g9", "09"),
  c("a", "02.006", "g2"), c("b", "02.01", "g2"), c("b1", "02.01.001", "b"), c("b2", "02.01.015", "b"),
  c("d", "02.13", "g2"),
  c("e", "04.03", "g4"), c("e1", "04.03.007", "e"), c("e2", "04.03.009", "e"),
  c("s", null, null, { name: "ACORDO PROCESSO" }),
];
const achar = (id) => {
  const andar = (nodes) => nodes.flatMap((n) => [n, ...andar(n.children)]);
  return andar(buildTree(CONTAS)).find((n) => n.id === id);
};

test("ordem do relatório: texto do código, sem código por último", () => {
  const ordem = [...CONTAS].sort(compareAccounts).map((a) => a.code);
  assert.deepEqual(ordem.slice(0, 4), ["02", "02.006", "02.01", "02.01.001"]);
  assert.equal(ordem.at(-1), null);
  const raiz = buildTree(CONTAS);
  assert.deepEqual(raiz.map((n) => n.code), ["02", "04", "09", null]);
  assert.deepEqual(raiz[0].children.map((n) => n.code), ["02.006", "02.01", "02.13"]);
  assert.equal(achar("b1").depth, 3);
});

test("próximo código: 2 dígitos sob a raiz, 3 no terceiro nível, continua do maior", () => {
  const taken = new Set(CONTAS.map((a) => a.code).filter(Boolean));
  assert.equal(nextCode("02", ["02.006", "02.01", "02.13"], taken), "02.14");
  assert.equal(nextCode("02.01", ["02.01.001", "02.01.015"], taken), "02.01.016");
  // buraco em 04.03.008 não é reaproveitado: segue do maior
  assert.equal(nextCode("04.03", ["04.03.007", "04.03.009"], taken), "04.03.010");
  assert.equal(nextCode("09", [], taken), "09.01");
  assert.equal(nextCode(null, ["02", "04", "09", null], taken), "10");
  assert.equal(nextCode("09", [], new Set(["09.01"])), "09.02");
});

test("mover: folha assume o código do grupo de destino", () => {
  assert.deepEqual(checkMove(achar("d"), achar("e"), CONTAS), { ok: true, newCode: "04.03.010" });
  assert.deepEqual(checkMove(achar("s"), achar("g9"), CONTAS), { ok: true, newCode: "09.01" });
  assert.deepEqual(checkMove(achar("b1"), null, CONTAS), { ok: true, newCode: "10" });
});

test("mover: grupo com filhos só onde cabem os 3 níveis", () => {
  assert.deepEqual(checkMove(achar("b"), achar("g4"), CONTAS), { ok: true, newCode: "04.04" });
  assert.equal(checkMove(achar("b"), achar("e"), CONTAS).ok, false);
  assert.equal(checkMove(achar("g2"), achar("g4"), CONTAS).ok, false);
});

test("mover: bloqueios", () => {
  assert.equal(checkMove(achar("b"), achar("b1"), CONTAS).ok, false, "dentro de si mesma");
  assert.equal(checkMove(achar("b"), achar("b"), CONTAS).ok, false);
  assert.equal(checkMove(achar("d"), achar("g2"), CONTAS).ok, false, "já está no grupo");
  assert.equal(checkMove(achar("d"), achar("s"), CONTAS).ok, false, "destino sem código");
  assert.equal(checkMove(achar("d"), achar("b1"), CONTAS).ok, false, "quarto nível");
});

test("código digitado respeita a classe do grupo", () => {
  assert.equal(validateCode("02.20", "02"), null);
  assert.equal(validateCode("02.01.016", "02.01"), null);
  assert.equal(validateCode("10", null), null);
  assert.ok(validateCode("04.20", "02"));
  assert.ok(validateCode("02.01.016", "02"));
  assert.ok(validateCode("02.20", null));
  assert.ok(validateCode("2.1", "02"));
});

test("busca traz o caminho; inativas só quando pedido", () => {
  const contas = CONTAS.map((a) => (a.id === "b2" ? { ...a, active: false } : a));
  const raiz = buildTree(contas);
  const porCodigo = filterTree(raiz, "04.03.009", false);
  assert.deepEqual(porCodigo.map((n) => n.code), ["04"]);
  assert.deepEqual(porCodigo[0].children[0].children.map((n) => n.code), ["04.03.009"]);
  assert.deepEqual(filterTree(raiz, "acordo", false).map((n) => n.name), ["ACORDO PROCESSO"]);
  const b = (lista) => lista[0].children.find((n) => n.id === "b").children.map((n) => n.id);
  assert.deepEqual(b(filterTree(raiz, "", false)), ["b1"]);
  assert.deepEqual(b(filterTree(raiz, "", true)), ["b1", "b2"]);
});
