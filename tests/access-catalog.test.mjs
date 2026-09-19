import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCESS_CATALOG,
  derivePermissions,
  endOfDayBrasilia,
  hasFeature,
  isAccessExpired,
  hasModuleAccess,
  normalizeGrants,
} from "../modules/access-catalog.ts";
import { pruneDashboard } from "../lib/forja/forja-session.ts";

const migration = readFileSync(new URL("../supabase/migrations/202609190001_user_access.sql", import.meta.url), "utf8");

test("catálogo em código é o mesmo semeado no banco", () => {
  const seeded = new Map(
    [...migration.matchAll(/\('([a-z]+\.[a-z]+)',\s*'([a-z]+)',\s*'[^']+',\s*'\{([a-z,]+)\}'/g)]
      .map(([, code, module, levels]) => [code, { module, levels }]),
  );
  const catalog = ACCESS_CATALOG.flatMap((module) => module.features.map((feature) => ({ module: module.code, ...feature })));
  assert.equal(seeded.size, catalog.length);
  for (const feature of catalog) {
    const row = seeded.get(feature.code);
    assert.ok(row, `${feature.code} falta no seed`);
    assert.equal(row.module, feature.module, feature.code);
    assert.equal(row.levels, feature.levels.join(","), feature.code);
  }
});

test("níveis são cumulativos e o proprietário passa em tudo", () => {
  const rosana = { grants: { "rh.ferias": "aprovar", "rh.colaboradores": "ver" } };
  assert.equal(hasFeature(rosana, "rh.ferias", "ver"), true);
  assert.equal(hasFeature(rosana, "rh.ferias", "aprovar"), true);
  assert.equal(hasFeature(rosana, "rh.colaboradores", "operar"), false);
  assert.equal(hasFeature(rosana, "rh.sst"), false);
  assert.equal(hasFeature({ isOwner: true, grants: {} }, "financeiro.pagar", "aprovar"), true);
});

test("financeiro que só vê férias no RH não enxerga o resto do RH", () => {
  const ana = { grants: { "financeiro.pagar": "aprovar", "rh.ferias": "ver" } };
  assert.equal(hasModuleAccess(ana, "rh"), true);
  assert.equal(hasModuleAccess(ana, "compras"), false);
  assert.equal(hasFeature(ana, "rh.ferias", "operar"), false);
  assert.equal(hasFeature(ana, "rh.documentos"), false);
});

test("permissões da tela são validadas: código desconhecido cai e nível é rebaixado", () => {
  assert.deepEqual(
    normalizeGrants({ "rh.relatorios": "aprovar", "compras.aprovacoes": "operar", "rh.inexistente": "ver", "rh.ferias": "tudo" }),
    { "rh.relatorios": "ver", "compras.aprovacoes": "ver" },
  );
});

test("permissões antigas derivadas espelham o banco", () => {
  const permissions = derivePermissions({ "financeiro.pagar": "aprovar", "financeiro.bancos": "operar", "rh.documentos": "operar" });
  for (const expected of ["financeiro.view", "financeiro.approve", "financeiro.settle", "financeiro.reconcile", "rh.view", "core.people.view", "core.documents.edit"]) {
    assert.ok(permissions.includes(expected), expected);
  }
  assert.equal(permissions.includes("financeiro.admin"), false);
  assert.equal(permissions.includes("core.access.admin"), false);
  assert.equal(permissions.includes("core.documents.approve"), false);
});

test("Produção: quem só vê Paradas não recebe OS, clientes nem envios externos", () => {
  const full = {
    geradoEm: "2026-09-19T12:00:00.000Z",
    osPorStatus: { aberta: 2 },
    osPorStatusLista: { aberta: [{ id: "os1" }] },
    osAtrasadas: [{ id: "os2" }],
    kanban: [{ etapaId: "e1", cards: [{}] }],
    pipelines: [{ etapaId: "e1" }],
    inspecao: { aprovado: 1 },
    paradas: { ativas: [{ id: "p1" }], porMotivoHoje: { SETUP: { minutos: 10 } } },
    fantasmas: { opsParadas: [{}], turnosNaoFechados: [] },
    indicadores: { carteira: { total: 5 }, historico: { total: 3 } },
    gargalos: [{ etapaId: "e1" }],
    enviosExternos: [{ opLoteId: "x" }],
    totalOSExternas: 1,
  };
  const empty = {
    geradoEm: "", osPorStatus: {}, osPorStatusLista: {}, osAtrasadas: [], kanban: [], pipelines: [], inspecao: {},
    paradas: { ativas: [], porMotivoHoje: {} }, fantasmas: { opsParadas: [], turnosNaoFechados: [] },
    indicadores: { carteira: { total: 0 }, historico: { total: 0 } }, gargalos: [], enviosExternos: [], totalOSExternas: 0,
  };
  const data = pruneDashboard(full, (feature) => feature === "producao.paradas", empty);
  assert.deepEqual(data.paradas, full.paradas);
  assert.deepEqual(data.osPorStatusLista, {});
  assert.deepEqual(data.osAtrasadas, []);
  assert.deepEqual(data.enviosExternos, []);
  assert.deepEqual(data.kanban, []);
  assert.equal(data.indicadores.carteira.total, 0);
});

test("validade de terceiro: sem data nunca vence; vence no fim do dia em Brasília", () => {
  assert.equal(isAccessExpired(null), false);
  const limit = endOfDayBrasilia("2026-09-30");
  assert.equal(limit, "2026-10-01T02:59:59.000Z");
  assert.equal(isAccessExpired(limit, new Date("2026-09-30T23:00:00-03:00")), false);
  assert.equal(isAccessExpired(limit, new Date("2026-10-01T00:00:01-03:00")), true);
  assert.equal(endOfDayBrasilia("30/09/2026"), null);
});
