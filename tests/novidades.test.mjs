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

test("novidade de funcionalidade só vai para quem tem a funcionalidade; quem tem vários módulos recebe de todos", async () => {
  const { novidadesPara } = await import("../lib/novidades.ts");
  const lista = [
    { id: "coleta", data: "2026-10-10", area: "Plataforma", funcionalidades: ["financeiro.coleta", "compras.coleta"], modulos: ["financeiro", "compras"], titulo: "C", itens: ["x"] },
    { id: "fin", data: "2026-10-10", area: "Financeiro", modulos: ["financeiro"], titulo: "F", itens: ["x"] },
    { id: "fis", data: "2026-10-10", area: "Fiscal", modulos: ["fiscal"], titulo: "I", itens: ["x"] },
  ];
  const ids = (grants, isOwner = false) => novidadesPara(lista, { isOwner, grants }).map((n) => n.id);
  assert.deepEqual(ids({ "financeiro.pagar": "aprovar" }), ["fin"], "do Financeiro sem coleta: não recebe a da coleta");
  assert.deepEqual(ids({ "financeiro.coleta": "operar" }), ["coleta"], "só coleta: recebe só a da coleta");
  assert.deepEqual(ids({ "financeiro.pagar": "ver", "fiscal.icms": "operar" }), ["fin", "fis"], "dois módulos: as dos dois");
  assert.deepEqual(ids({}, true), ["coleta", "fin", "fis"], "proprietário vê tudo");
});

test("as novidades por funcionalidade mantêm `modulos` (o app de versão antiga só conhece `modulos`)", async () => {
  const { NOVIDADES } = await import("../lib/novidades.ts");
  const { findFeature } = await import("../modules/access-catalog.ts");
  for (const n of NOVIDADES.filter((x) => x.funcionalidades?.length)) {
    assert.ok(n.modulos?.length, `${n.id}: falta modulos`);
    for (const f of n.funcionalidades) assert.ok(findFeature(f), `${n.id}: funcionalidade desconhecida ${f}`);
  }
});
