import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { simular, caixa, premissasDosParametros, aliquotasDoAno, parcelaDoSaldoIcms } = await import("../lib/contabil/reforma.ts");
const P = { cbsReferencia: 0.0921, ibsReferencia: 0.187, reducaoCbs2027: 0.001, cbs2026: 0.009, ibs2026: 0.001, ibs2027: 0.001, fatorIcms: { 2029: 0.9, 2030: 0.8, 2031: 0.7, 2032: 0.6 } };
// Venda de R$ 1.000 com ICMS 18%, IPI 5% e PIS/COFINS cumulativos (0,65% + 3%).
const IMP = { icms: 18, reducaoBaseIcms: 0, ipi: 5, pis: 0.65, cofins: 3, pisCofinsExcluiIcms: false };

test("2026: IBS/CBS só destacados (fora da nota); a nota é produtos + IPI", () => {
  const [a] = simular(1000, IMP, P, "receita");
  assert.deepEqual([a.produtos, a.icms, a.pis, a.cofins, a.ipi, a.receitaLiquida, a.cbs, a.ibs, a.totalNota, a.tributos], [1000, 180, 6.5, 30, 50, 783.5, 7.05, 0.78, 1050, 266.5]);
  assert.equal(a.ibsCbsNaNota, false);
});

test("2027 mantendo a receita: IPI zero, PIS/COFINS fora, CBS do Senado por fora", () => {
  const a = simular(1000, IMP, P, "receita").find((x) => x.ano === 2027);
  assert.equal(a.produtos, 955.49, "783,50 / (1 − 18%)");
  assert.equal(a.receitaLiquida, 783.5);
  assert.deepEqual([a.ipi, a.pis, a.cofins], [0, 0, 0]);
  assert.equal(a.cbs, 71.38, "783,50 × (9,21% − 0,1 p.p.)");
  assert.equal(a.ibs, 0.78);
  assert.equal(a.totalNota, 1027.65);
  assert.ok(a.variacaoNota < 0, "com IPI zero, a nota fica mais barata para o cliente");
});

test("2029–2033: ICMS cai e o IBS sobe; em 2033 só CBS e IBS", () => {
  const anos = simular(1000, IMP, P, "receita");
  const a29 = anos.find((x) => x.ano === 2029), a33 = anos.find((x) => x.ano === 2033);
  assert.equal(aliquotasDoAno(2029, P, IMP).icms.toFixed(3), "0.162");
  assert.equal(aliquotasDoAno(2029, P, IMP).ibs.toFixed(4), "0.0187");
  assert.equal(a33.icms, 0);
  assert.deepEqual([a33.produtos, a33.cbs, a33.ibs, a33.totalNota], [783.5, 72.16, 146.51, 1002.17]);
  assert.ok(anos.every((x) => Math.abs(x.receitaLiquida - 783.5) < 0.02), "a receita líquida se mantém");
  // Mantendo o preço dos produtos, a receita sobe quando o tributo por dentro cai.
  const preco = simular(1000, IMP, P, "preco");
  assert.ok(preco.every((x) => x.produtos === 1000));
  assert.ok(preco.find((x) => x.ano === 2033).receitaLiquida === 1000);
  assert.ok(a29.receitaLiquida > 783 && a29.receitaLiquida < 784);
});

test("caixa: com prazo longo a empresa banca o tributo hoje; o split payment tira o IBS/CBS do pagamento", () => {
  const anos = simular(1000, IMP, P, "receita");
  const c = caixa(anos, 60);
  assert.equal(c.hoje.recebe, 1050);
  assert.equal(c.split.retidoNoPagamento, 72.16);
  assert.equal(c.split.recebe, 955.49);
  assert.equal(c.financiaHoje, 20);
  assert.equal(c.tributoFinanciadoHoje, 266.5);
  assert.equal(caixa(anos, 28).financiaHoje, 0);
  assert.equal(parcelaDoSaldoIcms(240000), 1000);
});

test("premissas vêm dos parâmetros e marcam a conferir enquanto houver rascunho", () => {
  const linhas = [
    { chave: "reforma_aliquota_referencia", situacao: "rascunho", valor: { ibs: 0.187, cbs_por_diferenca: 0.0921 }, fonte: { norma: "Res. CGIBS 14/2026" } },
    { chave: "reforma_2026_fase_teste", situacao: "conferido", valor: { cbs: 0.009, ibs: 0.001 } },
    { chave: "reforma_2027", situacao: "conferido", valor: {} },
    { chave: "reforma_2029_2033", situacao: "conferido", valor: { transicao_icms_iss: { 2029: 0.9, 2030: 0.8, 2031: 0.7, 2032: 0.6 } } },
  ];
  const r = premissasDosParametros(linhas);
  assert.equal(r.premissas.cbsReferencia, 0.0921);
  assert.equal(r.premissas.fatorIcms[2031], 0.7);
  assert.ok(r.aConferir);
  assert.deepEqual(r.fontes, ["Res. CGIBS 14/2026"]);
  assert.equal(premissasDosParametros(linhas.map((l) => ({ ...l, situacao: "conferido" }))).aConferir, false);
});
