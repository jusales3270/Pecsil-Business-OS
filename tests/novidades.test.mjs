import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { NOVIDADES, novidadesNovas } = await import("../lib/novidades.ts");

test("cada novidade tem id único, data válida, título e itens; a mais nova no topo", () => {
  const ids = NOVIDADES.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "id repetido");
  for (const n of NOVIDADES) {
    assert.match(n.data, /^\d{4}-\d{2}-\d{2}$/, n.id);
    assert.ok(n.titulo && n.area && n.itens.length, n.id);
  }
  const datas = NOVIDADES.map((n) => n.data);
  assert.deepEqual(datas, [...datas].sort().reverse(), "mais recente primeiro");
});

test("mostra só o que a versão aberta ainda não tem", () => {
  const velha = NOVIDADES.slice(1);
  assert.deepEqual(novidadesNovas(NOVIDADES, velha).map((n) => n.id), [NOVIDADES[0].id]);
  assert.deepEqual(novidadesNovas(NOVIDADES, NOVIDADES), []);
});

test("cada pessoa só vê as novidades dos módulos a que tem acesso", async () => {
  const { novidadesPara } = await import("../lib/novidades.ts");
  const lista = [
    { id: "a", data: "2026-10-01", area: "Financeiro", modulos: ["financeiro"], titulo: "F", itens: ["x"] },
    { id: "b", data: "2026-10-01", area: "Compras", modulos: ["compras"], titulo: "C", itens: ["x"] },
    { id: "c", data: "2026-10-01", area: "Plataforma", titulo: "P", itens: ["x"] },
  ];
  const ids = (acesso) => novidadesPara(lista, acesso).map((n) => n.id);
  assert.deepEqual(ids({ isOwner: false, grants: { "rh.ferias": "aprovar" } }), ["c"], "RH: só a da plataforma");
  assert.deepEqual(ids({ isOwner: false, grants: { "compras.cotacoes": "operar" } }), ["b", "c"]);
  assert.deepEqual(ids({ isOwner: true, grants: {} }), ["a", "b", "c"], "proprietário vê tudo");
  for (const n of NOVIDADES) for (const m of n.modulos ?? []) assert.match(m, /^[a-z]+$/, `${n.id}: código de módulo`);
});
