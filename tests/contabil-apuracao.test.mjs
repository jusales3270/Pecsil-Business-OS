import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { apurarPresumidoAno, apurarPisCofinsCumulativo } = await import("../lib/contabil/apuracao/presumido.ts");

// Parâmetros como estão no banco (versão sem a LC 224 até 2025; com ela desde 2026).
const linha = (chave, valor, vigente_de, vigente_ate = null, situacao = "rascunho") => ({
  id: `${chave}:${vigente_de}`, chave, titulo: chave, escopo: "legal", uf: null, codigo_municipio: null, valor, vigente_de, vigente_ate,
  fonte: { norma: "teste", url: "" }, confianca: "alta", observacao: null, situacao,
});
const BASE = { industria_comercio: { irpj: 0.08, csll: 0.12 }, servicos: { irpj: 0.32, csll: 0.32 }, irpj_aliquota: 0.15, csll_aliquota: 0.09, irpj_adicional: { aliquota: 0.1, excedente_trimestral: 60000 } };
const LC224 = { percentuais_majorados: { industria_comercio: { irpj: 0.088, csll: 0.132 }, servicos: { irpj: 0.352, csll: 0.352 } }, vigencia_irpj: "2026-01-01", vigencia_csll: "2026-04-01", limite_trimestral: 1250000 };
const PARAMS = [
  linha("lucro_presumido_percentuais", BASE, "1996-01-01", "2025-12-31"),
  linha("lucro_presumido_percentuais", { ...BASE, lc_224_2025: LC224 }, "2026-01-01"),
  linha("pis_cofins_aliquotas", { cumulativo: { pis: 0.0065, cofins: 0.03 } }, "2023-05-01", "2026-12-31"),
  linha("codigos_darf", { 2089: "IRPJ lucro presumido", 2372: "CSLL lucro presumido", 8109: "PIS", 2172: "COFINS" }, "2026-01-01"),
];
const tri = (trimestre, industria_comercio, outras = 0, servicos = 0) => ({ trimestre, receitas: { industria_comercio, servicos }, outras });

test("presumido sem LC 224 (2025): 8%/12%, adicional sobre o que passa de R$ 60 mil, outras receitas inteiras", () => {
  const { trimestres, aConferir } = apurarPresumidoAno(PARAMS, 2025, [tri(1, 7_000_000, 50_000, 100_000)]);
  const t = trimestres[0];
  // IRPJ: 7.000.000 × 8% + 100.000 × 32% + 50.000 = 642.000; CSLL: 840.000 + 32.000 + 50.000 = 922.000.
  assert.equal(t.baseIrpj, 642000); assert.equal(t.irpjNormal, 96300); assert.equal(t.adicional, 58200); assert.equal(t.irpj, 154500);
  assert.equal(t.baseCsll, 922000); assert.equal(t.csllDevida, 82980);
  assert.equal(t.limite, null); assert.equal(t.excesso, 0);
  assert.deepEqual(t.darf, { irpj: null, csll: null }, "códigos DARF só têm versão desde 2026");
  assert.equal(aConferir.length, 1, "o percentual em rascunho volta para conferir");
});

test("LC 224 em 2026: acréscimo só acima de R$ 1,25 mi no trimestre; CSLL só desde abril; o 4º trimestre fecha com o ano", () => {
  const { trimestres, notas } = apurarPresumidoAno(PARAMS, 2026, [tri(1, 8e6), tri(2, 8e6), tri(3, 8e6), tri(4, 8e6)]);
  const [q1, q2, , q4] = trimestres;
  assert.equal(q1.limite, 1250000); assert.equal(q1.excesso, 6750000);
  assert.equal(q1.baseIrpj, 694000, "1,25 mi × 8% + 6,75 mi × 8,8%");
  assert.equal(q1.baseCsll, 960000, "CSLL de jan–mar ainda sem o acréscimo");
  assert.equal(q2.baseCsll, 1041000, "1,25 mi × 12% + 6,75 mi × 13,2%");
  assert.equal(q4.excesso, 6750000, "32 mi − 5 mi = 27 mi de excedente no ano, 6,75 mi por trimestre");
  assert.deepEqual(q4.deducao, { irpj: 0, csll: 0 });
  assert.deepEqual(q1.darf, { irpj: "2089", csll: "2372" });
  assert.match(notas.join(" "), /CSLL só teve acréscimo a partir/);
});

test("LC 224: a sobra de um trimestre fraco aumenta o limite do seguinte", () => {
  const { trimestres } = apurarPresumidoAno(PARAMS, 2026, [tri(1, 500_000), tri(2, 3_000_000)]);
  assert.equal(trimestres[0].excesso, 0);
  assert.equal(trimestres[1].limite, 2000000, "1,25 mi + 0,75 mi que sobraram");
  assert.equal(trimestres[1].excesso, 1000000);
});

test("LC 224, § 5º I: o ano não passou de R$ 5 mi, o acréscimo do 1º trimestre volta como dedução (e o que sobra, a restituir)", () => {
  const { trimestres, notas } = apurarPresumidoAno(PARAMS, 2026, [tri(1, 3e6), tri(2, 0), tri(3, 0), tri(4, 200_000)]);
  const [q1, , , q4] = trimestres;
  assert.equal(q1.excesso, 1750000);
  // Acréscimo pago no 1º trimestre: 1,75 mi × 0,8% = 14.000 de base, a 25% (15% + adicional) = 3.500.
  assert.equal(q4.deducao.irpj, 3500); assert.equal(q4.deducao.csll, 0, "a CSLL de jan–mar não teve acréscimo");
  // 4º trimestre: 200.000 × 8% = 16.000 de base → IRPJ 2.400 (sem adicional); dedução de 3.500 → nada a pagar, 1.100 a restituir.
  assert.equal(q4.irpj, 0); assert.equal(q4.restituir.irpj, 1100);
  assert.match(notas.join(" "), /§ 5º, I/);
});

test("LC 224, § 5º II e § 6º: excedente menor que o já majorado; atividades repartem o excedente", () => {
  const { trimestres, notas } = apurarPresumidoAno(PARAMS, 2026, [tri(1, 6e6), tri(2, 0), tri(3, 0), tri(4, 0)]);
  // Ano: 6 mi − 5 mi = 1 mi de excedente; o 1º trimestre majorou 4,75 mi → refaz com 1/4,75 do excedente.
  assert.equal(trimestres[3].excesso, 0);
  assert.equal(trimestres[3].deducao.irpj, 7500, "(4,75 mi − 1 mi) × 0,8% × 25%");
  assert.match(notas.join(" "), /§ 5º, II/);
  const misto = apurarPresumidoAno(PARAMS, 2026, [tri(1, 6e6, 0, 2e6)]).trimestres[0];
  // 8 mi no trimestre, 6,75 mi acima do limite: 75% indústria, 25% serviços.
  // 6 mi × 8% + 2 mi × 32% + o acréscimo (0,8 e 3,2 p.p.) sobre 5,0625 mi e 1,6875 mi = 480.000 + 640.000 + 40.500 + 54.000.
  assert.equal(misto.baseIrpj, 1214500);
});

test("PIS e COFINS cumulativos: 0,65% e 3% sobre a receita do mês menos as exclusões", () => {
  const r = apurarPisCofinsCumulativo(PARAMS, "2025-05", 1_000_000, [{ rotulo: "Exportação", valor: 200_000 }]);
  assert.equal(r.base, 800000); assert.equal(r.pis, 5200); assert.equal(r.cofins, 24000);
  assert.deepEqual(r.darf, { pis: null, cofins: null });
  assert.equal(apurarPisCofinsCumulativo(PARAMS, "2026-05", 100).darf.pis, "8109");
  assert.throws(() => apurarPisCofinsCumulativo(PARAMS, "2027-01", 100), /Sem alíquotas/);
});
