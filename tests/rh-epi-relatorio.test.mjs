import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dataValida, montarRelatorio, situacaoDaExigencia, situacaoGeral } from "../lib/rh/epi-relatorio.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const ent = (x) => ({ id: x.id ?? `${x.employeeId}-${x.itemId}-${x.entregueEm}`, item: x.itemId, ca: null, quantidade: 1, assinadoEm: x.entregueEm, metodo: "biometria", ...x });

test("epi: situação de cada EPI exigido na data de referência", () => {
  const ex = { itemId: "luva", validadeDias: 30 };
  assert.deepEqual(situacaoDaExigencia(ex, [], "2026-10-28"), { ultima: null, vence: null, situacao: "nunca_entregue" });
  assert.equal(situacaoDaExigencia(ex, [{ itemId: "luva", entregueEm: "2026-10-20" }], "2026-10-28").situacao, "a_vencer", "vence em 19/11, dentro de 30 dias");
  assert.equal(situacaoDaExigencia({ itemId: "luva", validadeDias: 90 }, [{ itemId: "luva", entregueEm: "2026-10-20" }], "2026-10-28").situacao, "em_dia");
  assert.deepEqual(situacaoDaExigencia(ex, [{ itemId: "luva", entregueEm: "2026-08-01" }, { itemId: "luva", entregueEm: "2026-09-01" }], "2026-10-28"), { ultima: "2026-09-01", vence: "2026-10-01", situacao: "vencido" });
  assert.equal(situacaoDaExigencia(ex, [{ itemId: "luva", entregueEm: "2026-11-01" }], "2026-10-28").situacao, "nunca_entregue", "entrega depois da referência não conta");
  assert.equal(situacaoDaExigencia({ itemId: "luva", validadeDias: null }, [{ itemId: "luva", entregueEm: "2020-01-01" }], "2026-10-28").situacao, "em_dia", "sem validade: em dia depois da 1ª entrega");
  assert.equal(situacaoDaExigencia(ex, [{ itemId: "outro", entregueEm: "2026-10-27" }], "2026-10-28").situacao, "nunca_entregue", "outro EPI não conta");
});

test("epi: situação geral — sem exigências não é 'em dia'; sem assinatura é pendência", () => {
  assert.equal(situacaoGeral([], 0), "sem_exigencias");
  assert.equal(situacaoGeral([{ situacao: "em_dia" }, { situacao: "a_vencer" }], 0), "em_dia");
  assert.equal(situacaoGeral([{ situacao: "em_dia" }], 1), "pendente");
  assert.equal(situacaoGeral([{ situacao: "nunca_entregue" }], 0), "pendente");
  assert.equal(situacaoGeral([{ situacao: "vencido" }], 0), "pendente");
});

test("epi: montar o relatório com os filtros", () => {
  const colaboradores = [
    { id: "ana", nome: "Ana", setor: "Usinagem", funcao: "Operador", positionId: "op", ativo: true },
    { id: "bia", nome: "Bia", setor: "Fundição", funcao: "Fundidor", positionId: "fu", ativo: true },
    { id: "caio", nome: "Caio", setor: "Usinagem", funcao: "Operador", positionId: "op", ativo: false },
    { id: "davi", nome: "Davi", setor: "Usinagem", funcao: "Auxiliar", positionId: "aux", ativo: true },
  ];
  const exigencias = [{ positionId: "op", itemId: "luva", item: "Luva", ca: "1", validadeDias: 30 }, { positionId: "op", itemId: "oculos", item: "Óculos", ca: "2", validadeDias: null }];
  const entregas = [
    ent({ employeeId: "ana", itemId: "luva", entregueEm: "2026-10-20" }), ent({ employeeId: "ana", itemId: "oculos", entregueEm: "2025-12-01" }),
    ent({ employeeId: "bia", itemId: "luva", entregueEm: "2026-10-10", assinadoEm: null, metodo: null }),
    ent({ employeeId: "caio", itemId: "luva", entregueEm: "2025-03-01" }),
  ];
  const r = montarRelatorio({ colaboradores, exigencias, entregas, hoje: "2026-10-28", filtros: { de: "2026-01-01", ate: "2026-12-31" } });
  assert.equal(r.referencia, "2026-10-28", "a referência nunca passa de hoje");
  assert.deepEqual(r.fichas.map((f) => [f.nome, f.situacao]), [["Bia", "sem_exigencias"], ["Ana", "em_dia"]], "Caio (desligado, sem entrega no período) e Davi (sem nada) ficam de fora");
  const ana = r.fichas.find((f) => f.id === "ana");
  assert.equal(ana.entregas.length, 1, "só as entregas do período são listadas");
  assert.equal(ana.exigencias.find((e) => e.itemId === "oculos").situacao, "em_dia", "entrega anterior ao período conta para a situação");
  assert.equal(r.fichas.find((f) => f.id === "bia").semAssinatura, 1);
  assert.deepEqual(r.resumo, { colaboradores: 2, emDia: 1, pendentes: 0, semExigencias: 1, entregas: 2, semAssinatura: 1 });
  // Colaborador escolhido sempre entra; filtro de EPI restringe entregas e exigências; situação filtra.
  assert.equal(montarRelatorio({ colaboradores, exigencias, entregas, hoje: "2026-10-28", filtros: { de: "2026-01-01", ate: "2026-12-31", colaborador: "davi" } }).fichas[0].situacao, "sem_exigencias");
  const soLuva = montarRelatorio({ colaboradores, exigencias, entregas, hoje: "2026-10-28", filtros: { de: "2026-01-01", ate: "2026-12-31", item: "luva", colaborador: "ana" } }).fichas[0];
  assert.deepEqual(soLuva.exigencias.map((e) => e.itemId), ["luva"]);
  assert.deepEqual(montarRelatorio({ colaboradores, exigencias, entregas, hoje: "2026-10-28", filtros: { de: "2026-01-01", ate: "2026-12-31", situacao: "em_dia" } }).fichas.map((f) => f.id), ["ana"]);
  assert.deepEqual(montarRelatorio({ colaboradores, exigencias, entregas, hoje: "2026-10-28", filtros: { de: "2026-01-01", ate: "2026-12-31", setor: "Fundição" } }).fichas.map((f) => f.id), ["bia"]);
  // Período no passado: a situação é a daquela data.
  const passado = montarRelatorio({ colaboradores, exigencias, entregas, hoje: "2026-10-28", filtros: { de: "2025-01-01", ate: "2025-06-30", colaborador: "caio" } }).fichas[0];
  assert.equal(passado.exigencias.find((e) => e.itemId === "luva").situacao, "vencido", "em 30/06/2025 a luva de 01/03/2025 já tinha vencido");
});

test("epi: datas, rota com a permissão de SST e documento com Imprimir", () => {
  assert.ok(dataValida("2026-10-28") && !dataValida("2026-13-01") && !dataValida("28/10/2026") && !dataValida(null));
  const rota = ler("app/api/rh/epi/relatorio/route.ts");
  assert.match(rota, /requireFeature\("rh\.sst"\)/);
  assert.match(rota, /range\(from, from \+ 999\)/);
  assert.match(ler("app/relatorios/epi/page.tsx"), /printButton/);
  assert.match(ler("packages/design-system/report.css"), /\.epi-ficha \{ break-before: page; \}/);
});
