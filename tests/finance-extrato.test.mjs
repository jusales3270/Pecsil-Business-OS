import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classificarLancamento, limparDescricao } from "../lib/finance/extrato-classificar.ts";
import { conciliarSaidas, parecenca, subconjuntoUnico, sugerirBaixas } from "../lib/finance/conciliacao-match.ts";
import { OfxInvalido, centavosDe, conferirSaldos, lerOfx } from "../lib/finance/ofx-parser.ts";

const ofx = readFileSync(new URL("./fixtures/extrato-ficticio.ofx", import.meta.url), "latin1");

test("OFX: lê conta, lançamentos e separa as linhas de saldo", () => {
  const extrato = lerOfx(ofx);
  assert.equal(extrato.banco, "0341");
  assert.equal(extrato.conta, "0000000001");
  assert.equal(extrato.lancamentos.length, 6);
  assert.equal(extrato.saldosDiarios.length, 2);
  assert.deepEqual(extrato.saldoAnterior, { data: "2026-03-01", centavos: 100000 });
  assert.equal(extrato.saldoFinal, 89950);
  assert.deepEqual(extrato.lancamentos[0], { data: "2026-03-02", centavos: -10000, fitid: "20260302001", memo: "SISPAG SALARIOS", tipo: "DEBIT" });
});

test("OFX: os saldos diários fecham; um valor alterado é denunciado", () => {
  const ok = conferirSaldos(lerOfx(ofx));
  assert.equal(ok.dias, 2);
  assert.deepEqual(ok.divergentes, []);
  assert.equal(ok.saldoCalculado, 89950);

  const adulterado = lerOfx(ofx.replace("<TRNAMT>-250.50", "<TRNAMT>-250.60"));
  const ruim = conferirSaldos(adulterado);
  assert.equal(ruim.divergentes.length, 1);
  assert.equal(ruim.divergentes[0].data, "2026-03-02");
});

test("OFX: valores em centavos sem erro de ponto flutuante e arquivo inválido é recusado", () => {
  assert.equal(centavosDe("-2095.00"), -209500);
  assert.equal(centavosDe("0.03"), 3);
  assert.equal(centavosDe("1.1"), 110);
  assert.equal(centavosDe("-0.29"), -29);
  assert.throws(() => centavosDe("abc"), OfxInvalido);
  assert.throws(() => lerOfx("isto não é um extrato"), OfxInvalido);
});

test("classificar: CPF nunca fica no texto", () => {
  assert.equal(limparDescricao("PAGAMENTOS TRANSF CC ITAU MARIA DE TESTE 123.456.789-09"), "PAGAMENTOS TRANSF CC ITAU MARIA DE TESTE");
  assert.equal(limparDescricao("PIX ENVIADO JOAO TESTE 12345678909 35.997.206/0001-12"), "PIX ENVIADO JOAO TESTE 35.997.206/0001-12");
  assert.equal(limparDescricao("SISPAG FORNECEDORES PAG TIT 109126542766"), "SISPAG FORNECEDORES PAG TIT 109126542766");
  const c = classificarLancamento("PAGAMENTOS TRANSF CC ITAU MARIA DE TESTE 123.456.789-09");
  assert.equal(c.categoria, "pessoa_fisica");
  assert.equal(c.contraparte, "MARIA DE TESTE");
  assert.ok(!/\d{3}\.\d{3}\.\d{3}/.test(c.descricao));
});

test("classificar: categorias e beneficiário", () => {
  const boleto = classificarLancamento("BOLETO PAGO ACME FERRAM ACME FERRAMENTAS LTDA 11.222.333/0001-81");
  assert.equal(boleto.categoria, "fornecedor");
  assert.equal(boleto.contraparte, "ACME FERRAMENTAS LTDA");
  assert.equal(boleto.cnpj, "11222333000181");

  assert.equal(classificarLancamento("AQUISICAO FORNECEDORES").categoria, "antecipacao_recebiveis");
  assert.equal(classificarLancamento("PIX ENVIADO PECSIL MOLDES 46.839.106/0001-84").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("PIX RECEBIDO PECSIL 02/10 PECSIL METALURGICA E FUNDICAO LTDA 46.839.106/0001-84").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("EMPREST CAPITAL DE GIRO EMPRESTIMO CAPITAL DE GIRO PECSIL METALURGICA E FUNDICAO LTDA. 27355413805").categoria, "emprestimo");
  assert.equal(classificarLancamento("SISPAG SALARIOS").categoria, "folha");
  assert.equal(classificarLancamento("SISPAG TRIBUTOS DARF").categoria, "tributo");
  assert.equal(classificarLancamento("PARC FINAME").categoria, "financiamento");
  assert.equal(classificarLancamento("SAQ DIN AG0278 CHQ001329").categoria, "saque");
  assert.equal(classificarLancamento("RECEBIMENTOS OWENS-ILLINOIS DO BR OWENS-ILLINOIS DO BRASIL INDUSTRIA E COMERCIO LTDA 08.910.541/0001-69").categoria, "recebimento_cliente");

  const iof = classificarLancamento("IOF");
  assert.equal(iof.categoria, "tarifa_bancaria");
  assert.equal(iof.contaSugerida, "02.01.004");
  assert.equal(classificarLancamento("TAR PIX PGTO TRANSF SERV SEM NOME CONTRAPART 60701190000104").contaSugerida, "02.01.014");
  assert.equal(classificarLancamento("RENDIMENTOS REND PAGO APLIC AUT MAIS").contaSugerida, "01.02.001");

  const lote = classificarLancamento("SISPAG FORNECEDORES");
  assert.equal(lote.categoria, "fornecedor");
  assert.equal(lote.semBeneficiario, true);
});

test("parecenca: ignora sufixo societário e acento", () => {
  assert.equal(parecenca("CMBA INDUSTRIA MECANICA LTDA", "CMBA - INDÚSTRIA MECÂNICA"), 1);
  assert.equal(parecenca("ACME FERRAMENTAS", "OUTRA EMPRESA"), 0);
  assert.equal(parecenca(null, "ACME"), 0);
});

const e = (id, data, centavos, contraparte = null) => ({ id, data, centavos, contraparte });

test("casamento nível 1: mesma data e valor; par único é confiança alta", () => {
  const r = conciliarSaidas([e("E1", "2026-03-02", 25050, "ACME FERRAMENTAS")], [e("B1", "2026-03-02", 25050, "ACME FERRAMENTAS LTDA"), e("B2", "2026-03-02", 9900)]);
  assert.deepEqual(r.vinculos, [{ entradaId: "E1", baixaIds: ["B1"], nivel: 1, confianca: "alta" }]);
  assert.deepEqual(r.baixasSemVinculo, ["B2"]);
  assert.deepEqual(r.entradasSemVinculo, []);
});

test("casamento nível 1: valores iguais no dia desempatam pelo nome e ficam com confiança média", () => {
  const r = conciliarSaidas(
    [e("E1", "2026-03-02", 100000, "BETA SERVICOS")],
    [e("B1", "2026-03-02", 100000, "ALFA PECAS"), e("B2", "2026-03-02", 100000, "BETA SERVICOS LTDA")],
  );
  assert.equal(r.vinculos.length, 1);
  assert.deepEqual(r.vinculos[0], { entradaId: "E1", baixaIds: ["B2"], nivel: 1, confianca: "media" });
  assert.deepEqual(r.baixasSemVinculo, ["B1"]);
});

test("casamento nível 2: data deslocada em até 3 dias com par único", () => {
  const r = conciliarSaidas([e("E1", "2026-03-06", 77777)], [e("B1", "2026-03-04", 77777)]);
  assert.deepEqual(r.vinculos, [{ entradaId: "E1", baixaIds: ["B1"], nivel: 2, confianca: "media" }]);
  const longe = conciliarSaidas([e("E1", "2026-03-10", 77777)], [e("B1", "2026-03-04", 77777)]);
  assert.equal(longe.vinculos.length, 0);
});

test("casamento nível 2: não escolhe quando há dois candidatos possíveis", () => {
  const r = conciliarSaidas([e("E1", "2026-03-06", 500)], [e("B1", "2026-03-05", 500), e("B2", "2026-03-07", 500)]);
  assert.equal(r.vinculos.length, 0);
  assert.deepEqual(r.entradasSemVinculo, ["E1"]);
});

test("casamento nível 3: lote SISPAG é a soma única das baixas do dia", () => {
  const baixas = [e("B1", "2026-03-03", 10000), e("B2", "2026-03-03", 25000), e("B3", "2026-03-03", 5000), e("B4", "2026-03-03", 1234)];
  const r = conciliarSaidas([e("E1", "2026-03-03", 40000)], baixas);
  assert.equal(r.vinculos.length, 1);
  assert.equal(r.vinculos[0].nivel, 3);
  assert.deepEqual([...r.vinculos[0].baixaIds].sort(), ["B1", "B2", "B3"]);
  assert.deepEqual(r.baixasSemVinculo, ["B4"]);
});

test("casamento nível 3: soma ambígua não vincula nada", () => {
  // 100 = 60+40 e também 70+30: duas combinações, nenhuma é escolhida.
  const itens = [e("A", "2026-03-03", 6000), e("B", "2026-03-03", 4000), e("C", "2026-03-03", 7000), e("D", "2026-03-03", 3000)];
  assert.equal(subconjuntoUnico(itens, 10000), null);
  const r = conciliarSaidas([e("E1", "2026-03-03", 10000)], itens);
  assert.equal(r.vinculos.length, 0);
});

test("sugerir: valor igual com nome parecido vem primeiro; fora de 3 dias não entra", () => {
  const entrada = e("E1", "2026-03-10", 25050, "ACME FERRAMENTAS");
  const s = sugerirBaixas(entrada, [
    e("B1", "2026-03-09", 25050, "OUTRA FIRMA"),
    e("B2", "2026-03-10", 25050, "ACME FERRAMENTAS LTDA"),
    e("B3", "2026-03-01", 25050, "ACME FERRAMENTAS LTDA"),
  ]);
  assert.deepEqual(s.map((x) => x.baixaId), ["B2", "B1"]);
  assert.equal(s[0].motivo, "valor_e_nome");
});
