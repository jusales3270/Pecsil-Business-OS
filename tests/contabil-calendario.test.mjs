import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { ocorrencias, vencimento, calendarioUtil, diasAte, rotuloCompetencia } = await import("../lib/contabil/calendario.ts");
const semente = JSON.parse(readFileSync(new URL("../docs/contabil/calendario-obrigacoes.json", import.meta.url), "utf8"));
const OBR = [...semente.legal.obrigacoes, ...semente.uf_sp.obrigacoes];
const por = (codigo) => OBR.find((o) => o.codigo === codigo);
// Feriados nacionais de 2026 e 2027 como estão nos parâmetros (BrasilAPI, conferidos).
const FERIADOS = [
  ["2026-01-01", "Confraternização mundial"], ["2026-02-16", "Carnaval"], ["2026-02-17", "Carnaval"], ["2026-04-03", "Sexta-feira Santa"], ["2026-04-05", "Páscoa"],
  ["2026-04-21", "Tiradentes"], ["2026-05-01", "Dia do trabalho"], ["2026-06-04", "Corpus Christi"], ["2026-09-07", "Independência do Brasil"], ["2026-10-12", "Nossa Senhora Aparecida"],
  ["2026-11-02", "Finados"], ["2026-11-15", "Proclamação da República"], ["2026-11-20", "Dia da consciência negra"], ["2026-12-25", "Natal"],
  ["2027-01-01", "Confraternização mundial"], ["2027-02-08", "Carnaval"], ["2027-02-09", "Carnaval"], ["2027-03-26", "Sexta-feira Santa"],
].map(([data, nome]) => ({ data, nome }));
const cal = calendarioUtil(FERIADOS);
const v = (codigo, competencia) => vencimento(por(codigo), competencia, cal);

test("dia que não é útil: antecipa, prorroga ou mantém conforme a regra da obrigação", () => {
  assert.deepEqual(v("fgts", "2026-11"), { vencimento: "2026-12-18", original: "2026-12-20", ajuste: "Antecipado: dia 20 cai em domingo" });
  assert.deepEqual(v("efd_reinf", "2026-10"), { vencimento: "2026-11-16", original: "2026-11-15", ajuste: "Prorrogado: dia 15 cai em Proclamação da República" });
  assert.equal(v("pis_cofins", "2026-03").vencimento, "2026-04-24", "25/04/2026 é sábado");
  assert.equal(v("esocial_s1299", "2026-02").vencimento, "2026-03-13", "15/03/2026 é domingo");
  assert.deepEqual(v("ipi", "2026-01"), { vencimento: "2026-02-25", original: "2026-02-25", ajuste: null });
  // EFD ICMS/IPI de SP: regra do dia não útil ainda a conferir, a data fica como está.
  assert.equal(v("efd_icms_ipi_sp", "2026-05").vencimento, "2026-06-20");
});

test("último dia útil, N-ésimo dia útil, trimestral e anual", () => {
  assert.equal(v("dctfweb", "2026-10").vencimento, "2026-11-30");
  assert.equal(v("efd_contribuicoes", "2026-09").vencimento, "2026-11-16", "10º dia útil de nov/2026, depois de Finados");
  assert.equal(v("irpj_csll_trimestral", "2026-09").vencimento, "2026-10-30", "31/10/2026 é sábado");
  assert.equal(v("ecd", "2025-12").vencimento, "2026-06-30");
  assert.equal(v("ecf", "2026-12").vencimento, "2027-07-30", "31/07/2027 é sábado");
  assert.equal(rotuloCompetencia(por("irpj_csll_trimestral"), "2026-09"), "3º tri/2026");
  assert.equal(rotuloCompetencia(por("ecd"), "2025-12"), "ano 2025");
  assert.equal(rotuloCompetencia(por("fgts"), "2026-11"), "nov/2026");
});

test("ocorrências do período: regime filtra, regime a definir marca, ICMS-SP fica a definir", () => {
  const ctx = { feriados: FERIADOS, de: "2026-11-01", ate: "2026-11-30" };
  const presumido = ocorrencias(OBR, { ...ctx, regime: "presumido" });
  assert.ok(!presumido.some((o) => o.codigo === "irpj_csll_estimativa"), "estimativa mensal é só do Lucro Real");
  const aDefinir = ocorrencias(OBR, { ...ctx, regime: "a_definir" });
  assert.ok(aDefinir.find((o) => o.codigo === "irpj_csll_estimativa").dependeRegime);
  const icms = aDefinir.find((o) => o.codigo === "icms_sp");
  assert.ok(icms.aDefinir && icms.vencimento === null);
  const datas = aDefinir.filter((o) => o.vencimento).map((o) => `${o.codigo}@${o.vencimento}`);
  assert.ok(datas.includes("dctfweb@2026-11-30") && datas.includes("fgts@2026-11-19") && datas.includes("efd_contribuicoes@2026-11-16"));
  assert.equal(aDefinir.find((o) => o.codigo === "fgts").ajuste, "Antecipado: dia 20 cai em Dia da consciência negra");
  assert.ok(aDefinir.filter((o) => o.vencimento).every((o) => o.vencimento >= "2026-11-01" && o.vencimento <= "2026-11-30"));
  const ordem = aDefinir.filter((o) => o.vencimento).map((o) => o.vencimento);
  assert.deepEqual(ordem, [...ordem].sort());
  // Cada obrigação mensal aparece uma vez por mês.
  assert.equal(aDefinir.filter((o) => o.codigo === "fgts").length, 1);
  assert.equal(diasAte("2026-11-10", "2026-11-16"), 6);
  assert.equal(diasAte("2026-11-17", "2026-11-16"), -1);
});

test("a semente aponta parâmetros que existem e não repete código", () => {
  const params = JSON.parse(readFileSync(new URL("../docs/contabil/parametros-2026.json", import.meta.url), "utf8"));
  const chaves = new Set((params.parametros ?? params.itens ?? Object.values(params).find(Array.isArray) ?? []).map((p) => p.chave));
  assert.ok(chaves.size > 10);
  for (const o of OBR) assert.ok(chaves.has(o.parametro), `${o.codigo} aponta ${o.parametro}`);
  assert.equal(new Set(OBR.map((o) => o.codigo)).size, OBR.length);
});

test("montar: a obrigação da UF substitui a legal de mesmo código e o rascunho marca a conferir", async () => {
  const { montarCalendario } = await import("../lib/contabil/calendario.ts");
  const linha = (escopo, obrigacoes, situacao = "rascunho", uf = null) => ({ escopo, uf, valor: { obrigacoes }, situacao, vigente_de: "2026-01-01", vigente_ate: null, fonte: { norma: escopo } });
  const sp = { ...por("efd_reinf"), nome: "Reinf versão SP" };
  const r = montarCalendario({ uf: "SP", codigo_municipio: null, perfil: null, feriados: FERIADOS, obrigacoes: [linha("legal", semente.legal.obrigacoes, "conferido"), linha("uf", [sp], "rascunho", "SP")] }, { de: "2026-11-01", ate: "2026-11-30", hoje: "2026-10-26" });
  assert.equal(r.ocorrencias.find((o) => o.codigo === "efd_reinf").nome, "Reinf versão SP");
  assert.equal(r.regime, "a_definir");
  assert.ok(r.aConferir);
  const so = montarCalendario({ uf: "SP", codigo_municipio: null, perfil: { modo: "escritorio", regime: "presumido" }, feriados: FERIADOS, obrigacoes: [linha("legal", semente.legal.obrigacoes, "conferido")] }, { de: "2026-11-01", ate: "2026-11-30", hoje: "2026-10-26" });
  assert.equal(so.aConferir, false);
  assert.equal(so.regime, "presumido");
});
