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

import { PlanilhaInvalida, centavosPlanilha, lerExtratoSantander } from "../lib/finance/extrato-planilha.ts";

// Planilha fictícia no formato do Santander: mais novo em cima, saldo corrido.
const planilha = [
  ["AGENCIA", "0099", "CONTA", "123456789", null],
  ["", "", "", "", ""],
  ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"],
  ["03/03/2026", "PIX RECEBIDO  46839106000184", "", 500, 640.5],
  ["03/03/2026", "TARIFA MENSALIDADE PACOTE SERVICOS  FEVEREIRO / 2026", "", -59.5, 140.5],
  ["02/03/2026", "PAGAMENTO DE BOLETO OUTROS BANCOS  ACME FERRAMENTAS LT", "0000000000", -100, 200],
  ["02/03/2026", "OPERACAO DE CAMBIO-CREDITO RESERVA  ", "", 250, 300],
];

test("Santander: lê agência/conta, inverte a ordem e confere o saldo corrido", () => {
  const e = lerExtratoSantander(planilha);
  assert.equal(e.banco, "0033");
  assert.equal(e.agencia, "0099");
  assert.equal(e.numeroConta, "12345678");
  assert.equal(e.digito, "9");
  assert.equal(e.saldoCorridoDivergente, 0);
  assert.deepEqual(e.saldoAnterior, { data: "2026-03-01", centavos: 5000 });
  assert.deepEqual(e.lancamentos.map((l) => [l.data, l.centavos]), [["2026-03-02", 25000], ["2026-03-02", -10000], ["2026-03-03", -5950], ["2026-03-03", 50000]]);
  assert.deepEqual(e.saldosDiarios, [{ data: "2026-03-02", centavos: 20000 }, { data: "2026-03-03", centavos: 64050 }]);
  assert.deepEqual(conferirSaldos(e).divergentes, []);
  assert.equal(conferirSaldos(e).saldoCalculado, 64050);
});

test("Santander: saldo corrido adulterado é denunciado; planilha sem cabeçalho é recusada", () => {
  const ruim = planilha.map((l) => [...l]);
  ruim[5][3] = -101;
  assert.equal(lerExtratoSantander(ruim).saldoCorridoDivergente, 1);
  assert.throws(() => lerExtratoSantander([["qualquer coisa"]]), PlanilhaInvalida);
  assert.equal(centavosPlanilha(-10082.4), -1008240);
  assert.equal(centavosPlanilha("1.234,56"), 123456);
});

test("classificar: históricos do Santander", () => {
  assert.equal(classificarLancamento("PIX RECEBIDO  46839106000184").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("PIX AGENDADO  PECSIL MOLDES").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("PIX RECEBIDO  40049874000158").categoria, "recebimento_cliente");
  assert.equal(classificarLancamento("OPERACAO DE CAMBIO-DEBITO RESERVA").categoria, "cambio");
  assert.equal(classificarLancamento("IMPOSTO DE RENDA SOBRE OPER CAMBIO").categoria, "tributo");
  assert.equal(classificarLancamento("PAGAMENTO DARF EM CANAIS INTERNET TRIBUTOS FEDERAI").categoria, "tributo");
  assert.equal(classificarLancamento("PREST. DE EMPREST. FINANCIAMENTO CONTRATO 290000006190").categoria, "financiamento");
  assert.equal(classificarLancamento("PRESTACAO CONSORCIO PGTO EVENTUAIS").categoria, "financiamento");
  assert.equal(classificarLancamento("CONTRATACAO EMPREST/FINANCIAMENTO CNR 0065290000006190").categoria, "emprestimo");
  assert.equal(classificarLancamento("DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 1234").contaSugerida, "02.14");
  assert.equal(classificarLancamento("TARIFA MENSALIDADE PACOTE SERVICOS SETEMBRO / 2026").categoria, "tarifa_bancaria");
  assert.equal(classificarLancamento("RENDIMENTO LIQUIDO DE CONTAMAX 7000 RENDIMENTO LIQUIDO DE CONTAMAX").categoria, "rendimento");
  const boleto = classificarLancamento("PAGAMENTO DE BOLETO OUTROS BANCOS  COMIL COVER SAND IND E CO");
  assert.equal(boleto.categoria, "fornecedor");
  assert.equal(boleto.contraparte, "COMIL COVER SAND IND E CO");
  assert.equal(classificarLancamento("PAGAMENTO DE TITULO 0065.4907516278").semBeneficiario, true);
});

test("classificar: PIX enviado só com nome é pagamento (fornecedor)", () => {
  const c = classificarLancamento("PIX ENVIADO  JBE SEGURANCA LTDA");
  assert.equal(c.categoria, "fornecedor");
  assert.equal(c.contraparte, "JBE SEGURANCA LTDA");
});

import { tipoDoArquivo } from "../lib/arquivos/detectar.ts";
import { lerXlsx } from "../lib/arquivos/xlsx.ts";
import { lerExtratoItauPdf, pareceExtratoItau } from "../lib/finance/extrato-itau-pdf.ts";
import { lerExtratoDoArquivo, contaDoExtrato, prepararLancamentos } from "../lib/finance/extrato-carga.ts";

const xlsx = readFileSync(new URL("./fixtures/extrato-santander-ficticio.xlsx", import.meta.url));

test("detectar: tipo pelo conteúdo, não pela extensão", () => {
  assert.equal(tipoDoArquivo(new Uint8Array(xlsx)), "xlsx");
  assert.equal(tipoDoArquivo(new TextEncoder().encode(ofx)), "ofx");
  assert.equal(tipoDoArquivo(new TextEncoder().encode("%PDF-1.7\n...")), "pdf");
  assert.equal(tipoDoArquivo(new TextEncoder().encode('<?xml version="1.0"?><nfeProc versao="4.00"><NFe>')), "nfe-xml");
  assert.equal(tipoDoArquivo(new TextEncoder().encode("qualquer coisa")), "desconhecido");
});

test("xlsx: lê a primeira aba sem biblioteca (texto e número)", () => {
  const linhas = lerXlsx(xlsx);
  assert.deepEqual(linhas[0].slice(0, 4), ["AGENCIA", "0099", "CONTA", "123456789"]);
  assert.deepEqual(linhas[2], ["Data", "Histórico", "Documento", "Valor (R$)", "Saldo (R$)"]);
  assert.deepEqual(linhas[3], ["03/03/2026", "PIX RECEBIDO  46839106000184", "", 500, 640.5]);
  assert.equal(linhas[4][3], -59.5);
});

test("carga: planilha do Santander pelo arquivo, conta e chaves estáveis", async () => {
  const e = await lerExtratoDoArquivo(new Uint8Array(xlsx));
  assert.equal(e.formato, "planilha");
  assert.equal(e.nomeBanco, "Santander");
  assert.deepEqual(contaDoExtrato(e), { bank_code: "0033", bank_name: "Santander", branch: "0099", account_number: "12345678", account_digit: "9", account_type: "checking", opening_balance: 50 });
  const a = prepararLancamentos(e).map((l) => l.externalId);
  const b = prepararLancamentos(await lerExtratoDoArquivo(new Uint8Array(xlsx))).map((l) => l.externalId);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test("carga: OFX pelo arquivo, banco pelo código; nota fiscal é recusada como extrato", async () => {
  const e = await lerExtratoDoArquivo(new TextEncoder().encode(ofx));
  assert.equal(e.formato, "ofx");
  assert.equal(e.nomeBanco, "Itaú");
  await assert.rejects(() => lerExtratoDoArquivo(new TextEncoder().encode('<?xml version="1.0"?><nfeProc><NFe>')), /nota fiscal/);
  await assert.rejects(() => lerExtratoDoArquivo(new TextEncoder().encode("texto qualquer")), /não reconhecido/);
});

// PDF do Itaú: páginas com os pedaços posicionados (x, y), como o pdfjs entrega.
const it = (x, y, s, w = 30) => ({ x, y, w, s });
const pag1 = [
  it(34, 820, "PECSIL TESTE LTDA."), it(436, 820, "Agência 0001"), it(493, 820, "Conta 0012345-6"),
  it(34, 790, "Lançamentos do período:"), it(35, 770, "Data"), it(87, 770, "Lançamentos"), it(223, 770, "Razão Social"), it(360, 770, "CNPJ/CPF"), it(467, 770, "Valor (R$)"), it(521, 770, "Saldo (R$)"),
  it(35, 750, "31/12/2025"), it(87, 750, "SALDO ANTERIOR"), it(536, 750, "1.000,00", 30),
  // razão social quebrada em duas linhas, acima e abaixo da linha da data
  it(223, 736, "ACME FERRAMENTAS"), it(35, 730, "02/01/2026"), it(87, 730, "BOLETO PAGO ACME FERRAM"), it(360, 730, "11.222.333/0001-81"), it(469, 730, "-250,00", 35), it(223, 725, "LTDA"),
  it(35, 712, "02/01/2026"), it(87, 712, "SISPAG FORNECEDORES PIX QR-"), it(469, 712, "-100,00", 35), it(87, 707, "CODE"),
  it(35, 694, "02/01/2026"), it(87, 694, "SALDO TOTAL DISPONÍVEL DIA"), it(529, 694, "650,00", 30),
  // pé da página: começa um lançamento que continua na página seguinte
  it(87, 40, "RENDIMENTOS REND PAGO APLIC"),
];
const pag2 = [
  it(35, 805, "03/01/2026"), it(87, 805, "AUT MAIS"), it(476, 805, "0,10", 30),
  it(35, 792, "03/01/2026"), it(87, 792, "SALDO TOTAL DISPONÍVEL DIA"), it(529, 792, "650,10", 30),
];

test("PDF do Itaú: quebra de linha, palavra com hífen e lançamento que continua na outra página", () => {
  assert.equal(pareceExtratoItau([pag1, pag2]), true);
  const e = lerExtratoItauPdf([pag1, pag2]);
  assert.equal(e.agencia, "0001");
  assert.equal(e.numeroConta, "12345");
  assert.equal(e.digito, "6");
  assert.deepEqual(e.saldoAnterior, { data: "2025-12-31", centavos: 100000 });
  assert.deepEqual(e.lancamentos.map((l) => [l.data, l.centavos, l.memo]), [
    ["2026-01-02", -25000, "BOLETO PAGO ACME FERRAM ACME FERRAMENTAS LTDA 11.222.333/0001-81"],
    ["2026-01-02", -10000, "SISPAG FORNECEDORES PIX QR-CODE"],
    ["2026-01-03", 10, "RENDIMENTOS REND PAGO APLIC AUT MAIS"],
  ]);
  assert.deepEqual(e.saldosDiarios, [{ data: "2026-01-02", centavos: 65000 }, { data: "2026-01-03", centavos: 65010 }]);
  assert.deepEqual(conferirSaldos(e).divergentes, []);
  assert.equal(pareceExtratoItau([[it(10, 10, "Relatório qualquer")]]), false);
});

import { lerExtratoBradesco, pareceExtratoBradesco } from "../lib/finance/extrato-bradesco.ts";

const bradesco = [
  ["", "", "", "", "", ""],
  ["", "Bradesco Net Empresa", "", "", "", ""],
  ["Extrato de: Agência: 328  Conta: 6864-0", "", "", "", "", ""],
  ["Data", "Lançamento", "Dcto.", "Crédito (R$)", "Débito (R$)", "Saldo (R$)"],
  ["31/12/2025", "SALDO ANTERIOR", "", "", "", "-1.000,00"],
  ["02/01/2026", "TED-TRANSF ELET DISPON REMET.ACME VIDROS S A", "111", "1.500,00", "", "500,00"],
  ["02/01/2026", "PAGTO ELETRON  COBRANCA ACME FERRAMENTAS", "222", "", "-200,50", "299,50"],
  ["03/01/2026", "PIX ENVIADO DES: PECSIL MOLDES         03/01", "333", "", "-99,50", "200,00"],
  ["Total", "", "", "1.500,00", "-300,00", "200,00"],
  ["Últimos Lançamentos", "", "", "", "", ""],
  ["Data", "Lançamento", "Dcto.", "Crédito (R$)", "Débito (R$)", "Saldo (R$)"],
  ["10/03/2026", "SALDO ANTERIOR", "", "", "", "50,00"],
  ["10/03/2026", "RENTAB.INVEST FACILCRED*", "444", "0,10", "", "50,10"],
  ["Total", "", "", "0,10", "0,00", "50,10"],
];

test("Bradesco: lê o extrato principal, confere o saldo e avisa do período que falta", () => {
  assert.equal(pareceExtratoBradesco(bradesco), true);
  const e = lerExtratoBradesco(bradesco);
  assert.equal(e.banco, "0237");
  assert.equal(e.agencia, "0328");
  assert.equal(e.numeroConta, "6864");
  assert.equal(e.digito, "0");
  assert.deepEqual(e.saldoAnterior, { data: "2025-12-31", centavos: -100000 });
  assert.deepEqual(e.lancamentos.map((l) => l.centavos), [150000, -20050, -9950]);
  assert.equal(e.saldoCorridoDivergente, 0);
  assert.deepEqual(conferirSaldos(e).divergentes, []);
  assert.equal(e.avisos.length, 1);
  assert.match(e.avisos[0], /falta o período/);
});

test("Bradesco: últimos lançamentos entram quando continuam o saldo", () => {
  const continua = bradesco.map((l) => [...l]);
  continua[11][5] = "200,00";
  continua[12][5] = "200,10";
  const e = lerExtratoBradesco(continua);
  assert.equal(e.lancamentos.length, 4);
  assert.deepEqual(e.avisos, []);
});

test("classificar: históricos do Bradesco", () => {
  const ted = classificarLancamento("TED-TRANSF ELET DISPON REMET.AMBEV S A");
  assert.equal(ted.categoria, "recebimento_cliente");
  assert.equal(ted.contraparte, "AMBEV S A");
  const cob = classificarLancamento("PAGTO ELETRON  COBRANCA CMBA INDUSTRIA MECANICA LTDA");
  assert.equal(cob.categoria, "fornecedor");
  assert.equal(cob.contraparte, "CMBA INDUSTRIA MECANICA LTDA");
  const pix = classificarLancamento("PIX ENVIADO DES: JOAO FORNECEDOR LTDA 01/07");
  assert.equal(pix.categoria, "fornecedor");
  assert.equal(pix.contraparte, "JOAO FORNECEDOR LTDA");
  assert.equal(classificarLancamento("PIX ENVIADO DES: PECSIL MOLDES         01/07").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("TRANSF CC PARA CC PJ PECSIL METALURGICA E FUN").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("TED D CC HBANK* DEST. PECSIL METALURGICA E").categoria, "transferencia_interna");
  assert.equal(classificarLancamento("PAGTO ELETRONICO TRIBUTO INTERNET --RECEITA FEDERAL").categoria, "tributo");
  assert.equal(classificarLancamento("GASTOS CARTAO DE CREDITO").categoria, "cartao_credito");
  assert.equal(classificarLancamento("ENCARGOS C GARANTIDA IOF CONTR 123").categoria, "financiamento");
  assert.equal(classificarLancamento("RENTAB.INVEST FACILCRED*").categoria, "rendimento");
  assert.equal(classificarLancamento("RECEBIMENTO FORNECEDOR WHEATON BRASIL VIDROS").categoria, "recebimento_cliente");
  assert.equal(classificarLancamento("CHEQUE COMPENSADO").categoria, "saque");
  assert.equal(classificarLancamento("TARIFA BANCARIA TRANSF PGTO PIX").categoria, "tarifa_bancaria");
});

test("detectar: .xls antigo (arquivo composto)", () => {
  const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
  assert.equal(tipoDoArquivo(xls), "xls");
});

import { chaveValida, lerDanfe, pareceDanfe } from "../lib/fiscal/danfe-pdf.ts";
import { fornecedorDaNota, lerNotaDoArquivo, pedidosDaNota } from "../lib/fiscal/nota-carga.ts";

// DANFE fictício: chave com dígito verificador válido e rótulos do layout oficial.
const chaveFicticia = (() => {
  const base = "3526091122233300018155001000012345100001234";
  let soma = 0, peso = 2;
  for (let i = base.length - 1; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base + String(r < 2 ? 0 : 11 - r);
})();
const d = (x, y, s) => ({ x, y, w: 40, s });
const danfe = [[
  d(36, 813, "RECEBEMOS DE FERRAMENTAS EXEMPLO LTDA OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO"),
  d(296, 752, "DANFE"), d(377, 714, "CHAVE DE ACESSO"), d(383, 704, chaveFicticia.replace(/(\d{4})/g, "$1 ").trim()),
  d(36, 659, "NATUREZA DA OPERAÇÃO"), d(35, 649, "VENDA"),
  d(36, 607, "NOME/RAZÃO SOCIAL"), d(390, 607, "CNPJ/CPF"), d(487, 607, "DATA DA EMISSÃO"),
  d(36, 597, "PECSIL"), d(389, 597, "46.839.106/0001-84"), d(487, 597, "28/09/2026"),
  d(36, 501, "BASE DE CÁLCULO DO ICMS"), d(146, 501, "VALOR DO ICMS"), d(255, 501, "BASE DE CÁLCULO DO ICMS ST"), d(472, 501, "VALOR TOTAL DOS PRODUTOS"),
  d(119, 491, "222,50"), d(229, 491, "40,05"), d(337, 491, "0,00"), d(513, 491, "222,50"),
  d(378, 480, "VALOR DO IPI"), d(473, 480, "VALOR TOTAL DA NOTA"), d(446, 470, "11,13"), d(514, 470, "233,63"),
]];

test("DANFE: chave com dígito verificador e valores lidos abaixo de cada rótulo", () => {
  assert.equal(chaveValida(chaveFicticia), true);
  assert.equal(chaveValida(chaveFicticia.slice(0, 43) + ((Number(chaveFicticia[43]) + 1) % 10)), false);
  assert.equal(pareceDanfe(danfe), true);
  const n = lerDanfe(danfe);
  assert.equal(n.chave, chaveFicticia);
  assert.equal(n.numero, "12345");
  assert.equal(n.serie, "1");
  assert.equal(n.emitente.cnpj, "11222333000181");
  assert.equal(n.emitente.nome, "FERRAMENTAS EXEMPLO LTDA");
  assert.equal(n.emissao, "2026-09-28");
  assert.equal(n.destinatarioCnpj, "46839106000184");
  assert.deepEqual([n.valorProdutos, n.valorNota, n.baseIcms, n.icms, n.ipi], [222.5, 233.63, 222.5, 40.05, 11.13]);
  assert.deepEqual(n.camposNaoLidos, []);
});

test("nota: XML pelo arquivo; fornecedor pelo CNPJ ou pelo nome; pedido a caminho", async () => {
  const xmlNota = readFileSync(new URL("./fixtures/nfe-ficticia.xml", import.meta.url));
  const lida = await lerNotaDoArquivo(new Uint8Array(xmlNota));
  assert.equal(lida.origem, "xml");
  assert.ok(lida.xml);
  const cadastro = [{ id: "a", name: "FERRAMENTAS EXEMPLO", tax_id: null }, { id: "b", name: "OUTRA EMPRESA", tax_id: "99999999000199" }];
  assert.deepEqual(fornecedorDaNota(lida.nfe, cadastro), { id: "a", nome: "FERRAMENTAS EXEMPLO", porCnpj: false, gravarCnpj: true });
  assert.deepEqual(fornecedorDaNota(lida.nfe, [{ id: "c", name: "QUALQUER", tax_id: "11.222.333/0001-81" }]), { id: "c", nome: "QUALQUER", porCnpj: true, gravarCnpj: false });
  const pedidos = pedidosDaNota(lida.nfe, { id: "a", nome: "FERRAMENTAS EXEMPLO", porCnpj: false, gravarCnpj: true }, [
    { cotacaoId: 1, fornecedor: "FERRAMENTAS EXEMPLO", supplierId: "a", cnpj: null, totalComprado: 233.63, jaRecebido: 0 },
    { cotacaoId: 2, fornecedor: "SEM RELAÇÃO", supplierId: "z", cnpj: null, totalComprado: 233.63, jaRecebido: 0 },
  ]);
  assert.deepEqual(pedidos.map((p) => [p.cotacaoId, p.motivo, p.valorConfere]), [[1, "fornecedor", true]]);
  await assert.rejects(() => lerNotaDoArquivo(new TextEncoder().encode("OFXHEADER:100\n<OFX>")), /extrato bancário/);
});
