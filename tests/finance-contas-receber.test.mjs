import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { parseContasReceber, conferir, isPlaceholder, reviewReasons, legacyKey, parseCents, parseDate } = await import("../lib/finance/contas-receber-parser.ts");
const { situacaoRecebivel, resumoRecebiveis, agruparRecebiveis, emAberto } = await import("../lib/finance/recebiveis-core.ts");

// --- Monta uma página como o relatório desenha (mesmas colunas do PDF) ---------
const it = (x, y, s, w = s.length * 3.8) => ({ x, y, w, s });
const cabecalho = () => [it(21.7, 517.1, "Cliente"), it(21.7, 507.1, "Pago"), it(441.7, 507.1, "Histórico"), it(27, 22.2, "PECSIL METALÚRGICA E FUNDIÇÃO LTDA")];
const grupo = (y, nome) => [it(21.7, y, nome)];
function titulo(y, { lanc, venc, cliente = [], hist = [], doc = [], tipo = "BOL", valor, prev = false, obs = [], contas }) {
  const itens = [it(101.3, y, lanc), it(151.5, y, venc), it(26.3, y - 1.1, "¨"), it(48, y - 1.1, prev ? "þ" : "¨"), it(69, y - 1.1, "¨"), it(610.2, y, tipo), it(665.3, y, valor), it(727.6, y, valor)];
  cliente.forEach((linha, i) => itens.push(it(249, y - 8 * i, linha)));
  hist.forEach(([linha, w], i) => itens.push(it(442.4, y - 7.9 * i, linha, w)));
  doc.forEach(([linha, w], i) => itens.push(it(551.2, y - 8 * i, linha, w)));
  let cursor = y - 8 * Math.max(1, hist.length, cliente.length, doc.length) - 2;
  if (obs.length) {
    itens.push(it(74.8, cursor, "Obs.:"));
    obs.forEach(([linha, w]) => { itens.push(it(100.4, cursor, linha, w)); cursor -= 7.9; });
    cursor -= 2;
  }
  for (const [conta, v] of contas) {
    itens.push(it(75, cursor, "Plano de Contas"), it(300.2, cursor, "Valor (R$)"), it(350.3, cursor, v));
    conta.forEach((linha, i) => itens.push(it(i === 0 && linha === "-" ? 139.9 : 138, cursor - 8.1 * i, linha)));
    cursor -= 23.3;
  }
  itens.push(it(75, cursor, "Carteira"), it(111.4, cursor, "-"), it(270, cursor, "Nosso Número"), it(392.3, cursor - 9, "Remessa"));
  return { itens, fim: cursor - 24 };
}
const totais = (y, prev, real, total) => [
  it(599.3, y, "Previsões"), it(655.7, y, prev), it(718, y, prev),
  it(583, y - 9, "Sem Previsões"), it(661.4, y - 9, real), it(723.7, y - 9, real), it(807.1, y - 9, "0,00"),
  it(582.8, y - 18, "Total do Grupo"), it(655.7, y - 18, total), it(718, y - 18, total), it(807.1, y - 18, "0,00"),
];
const geral = (y, prev, real, total) => [
  it(563.5, y, "Total de Previsões"), it(647, y, prev), it(709.2, y, prev),
  it(555.8, y - 11, "Total Sem Previsões"), it(647, y - 11, real), it(709.2, y - 11, real),
  it(592.6, y - 22, "Total Geral"), it(647, y - 22, total), it(709.2, y - 22, total), it(807.1, y - 22, "0,00"),
];

function relatorio() {
  // Página 1: grupo ACME com um título simples (previsão) e um rateado, que continua na página 2.
  const a = titulo(478.6, { lanc: "25/08/26", venc: "12/12/26", cliente: ["ACME VIDROS INDÚSTRIA E COMÉRCIO", "LTDA."], prev: true, valor: "34.450,00",
    hist: [["ORÇAMENTO Nº 3312 - TÍTULO:", 104.8], ["EQ. MOLDES PARA VIDRO - MO", 105.6], ["LDE GFA. BURDEOS", 60]], contas: [[["01.01.001 - VENDAS DE MOLDES"], "34.450,00"]] });
  const b = titulo(a.fim, { lanc: "24/08/21", venc: "24/09/21", cliente: ["ACME VIDROS INDÚSTRIA E COMÉRCIO", "LTDA."], valor: "271.646,02",
    hist: [["NF 6573 PARC. 1", 60]], doc: [["6573", 16]], contas: [[["01.01.001 - VENDAS DE MOLDES"], "248.130,43"], [["01.01.006 - REVENDA"], "23.515,59"]] });
  const p1 = [...cabecalho(), ...grupo(491.5, "ACME"), ...a.itens, ...b.itens];
  // Página 2: o grupo continua (nome repetido no topo), observação em linhas, conta em duas linhas, totais; depois outro grupo.
  const c = titulo(478.6, { lanc: "28/12/17", venc: "28/01/18", cliente: ["ACME VIDROS INDÚSTRIA E COMÉRCIO", "LTDA."], valor: "84.661,89",
    hist: [["DIF. - NF 3738 PARC. 1", 80]], doc: [["4848 (PARCEL", 44.2], ["A 2 DE 12)", 30]], tipo: "DEP",
    obs: [["LIQUIDEI PARTE CONTRATO ACC NO VALOR DE USD 25.000,00", 300], ["RECUSA FEITA EM 26/05/", 700], ["2026 E REFATURADA", 80]],
    contas: [[["01.01.004 - PRESTAÇÃO DE SERVIÇOS /", "CONSERTOS"], "84.661,89"]] });
  const t = totais(c.fim, "34.450,00", "356.307,91", "390.757,91");
  const d = titulo(c.fim - 45, { lanc: "29/04/26", venc: "01/10/26", cliente: ["BETA S.A."], valor: "0,01", hist: [["NF 10813 PARC. 1", 60]], doc: [["10813-1/1", 30]],
    obs: [["NFE. RECUSADA PELO CLIENTE", 120]], contas: [[["-"], "0,00"], [["01.01.001 - VENDAS DE MOLDES"], "0,01"]] });
  const p2 = [...cabecalho(), ...grupo(491.5, "ACME"), ...c.itens, ...t, ...grupo(c.fim - 32, "BETA"), ...d.itens,
    ...totais(d.fim, "0,00", "0,01", "0,01"), ...geral(d.fim - 35, "34.450,00", "356.307,92", "390.757,92")];
  return [p1, p2];
}

test("valores e datas do relatório", () => {
  assert.equal(parseCents("1.718.182,85"), 171818285);
  assert.equal(parseCents("0,01"), 1);
  assert.equal(parseDate("25/08/26"), "2026-08-25");
});

test("lê título simples, previsão, cliente em duas linhas e histórico quebrado no meio da palavra", () => {
  const r = parseContasReceber(relatorio());
  assert.equal(r.titles.length, 4);
  const a = r.titles[0];
  assert.equal(a.group, "ACME");
  assert.equal(a.client, "ACME VIDROS INDÚSTRIA E COMÉRCIO LTDA.");
  assert.equal(a.issueDate, "2026-08-25");
  assert.equal(a.dueDate, "2026-12-12");
  assert.equal(a.cents, 3445000);
  assert.equal(a.forecast, true);
  assert.equal(a.documentType, "BOL");
  assert.equal(a.history, "ORÇAMENTO Nº 3312 - TÍTULO: EQ. MOLDES PARA VIDRO - MOLDE GFA. BURDEOS");
  assert.deepEqual(a.allocations, [{ code: "01.01.001", name: "VENDAS DE MOLDES", cents: 3445000 }]);
});

test("rateio em duas contas soma o valor do título", () => {
  const b = parseContasReceber(relatorio()).titles[1];
  assert.equal(b.forecast, false);
  assert.equal(b.document, "6573");
  assert.deepEqual(b.allocations.map((x) => [x.code, x.cents]), [["01.01.001", 24813043], ["01.01.006", 2351559]]);
  assert.equal(b.allocations.reduce((s, x) => s + x.cents, 0), b.cents);
});

test("grupo continua na página seguinte; observação, documento e conta em várias linhas", () => {
  const c = parseContasReceber(relatorio()).titles[2];
  assert.equal(c.group, "ACME");
  assert.equal(c.page, 2);
  assert.equal(c.document, "4848 (PARCELA 2 DE 12)");
  assert.equal(c.documentType, "DEP");
  assert.equal(c.notes, "LIQUIDEI PARTE CONTRATO ACC NO VALOR DE USD 25.000,00\nRECUSA FEITA EM 26/05/2026 E REFATURADA");
  assert.deepEqual(c.allocations, [{ code: "01.01.004", name: "PRESTAÇÃO DE SERVIÇOS / CONSERTOS", cents: 8466189 }]);
  assert.equal(c.history, "DIF. - NF 3738 PARC. 1");
});

test("totais por grupo e geral conferem ao centavo; divergência é acusada", () => {
  const r = parseContasReceber(relatorio());
  assert.deepEqual(r.groups.map((g) => [g.name, g.forecastCents, g.realCents, g.totalCents]), [["ACME", 3445000, 35630791, 39075791], ["BETA", 0, 1, 1]]);
  assert.deepEqual(r.grand, { forecastCents: 3445000, realCents: 35630792, totalCents: 39075792 });
  assert.deepEqual(conferir(r), []);
  const errado = { ...r, titles: r.titles.map((t, i) => (i === 0 ? { ...t, cents: t.cents + 1, allocations: [{ ...t.allocations[0], cents: t.cents + 1 }] } : t)) };
  assert.ok(conferir(errado).some((p) => p.startsWith("ACME: previsões lidas")));
  assert.ok(conferir(errado).some((p) => p.startsWith("Total geral lido")));
});

test("valor simbólico fica à parte; motivos de revisão; chave estável", () => {
  const [a, , c, d] = parseContasReceber(relatorio()).titles;
  assert.equal(isPlaceholder(d), true);
  assert.equal(isPlaceholder(a), false);
  assert.equal(d.allocations.length, 2, "linha de conta vazia é lida, sem código");
  assert.equal(d.allocations[0].code, null);
  assert.deepEqual(reviewReasons(a), []);
  assert.deepEqual(reviewReasons(c), ["Observação diz que já foi liquidado"]);
  assert.deepEqual(reviewReasons({ ...a, notes: "NOTA CANCELADA" }), ["Observação diz cancelada/recusada"]);
  assert.deepEqual(reviewReasons({ ...a, dueDate: "2026-01-01" }), ["Vencimento anterior ao lançamento"]);
  assert.deepEqual(reviewReasons({ ...a, client: "" }), ["Sem cliente"]);
  assert.equal(legacyKey(a, 0), legacyKey({ ...a, history: "outro texto" }, 0));
  assert.notEqual(legacyKey(a, 0), legacyKey(a, 1));
});

// --- Regras da tela --------------------------------------------------------------
const HOJE = "2026-09-30";
const rec = (id, due, amount, extra = {}) => ({ id, counterparty: "Cliente " + id, group: null, issueDate: "2026-01-01", originalAmount: amount, status: "approved", isForecast: false, reviewReason: null,
  installments: [{ dueDate: due, amount, settledAmount: 0 }], ...extra });

test("situação sai da data de vencimento e do que foi recebido", () => {
  assert.equal(situacaoRecebivel(rec("a", "2026-09-29", 100), HOJE), "Vencido");
  assert.equal(situacaoRecebivel(rec("b", "2026-09-30", 100), HOJE), "Em aberto");
  assert.equal(situacaoRecebivel(rec("c", "2026-12-01", 100, { installments: [{ dueDate: "2026-12-01", amount: 100, settledAmount: 40 }] }), HOJE), "Parcial");
  assert.equal(situacaoRecebivel(rec("d", "2020-01-01", 100, { installments: [{ dueDate: "2020-01-01", amount: 100, settledAmount: 100 }] }), HOJE), "Recebido");
  assert.equal(situacaoRecebivel(rec("e", "2020-01-01", 100, { status: "settled" }), HOJE), "Recebido");
  assert.equal(situacaoRecebivel(rec("f", "2020-01-01", 100, { status: "cancelled" }), HOJE), "Cancelado");
  assert.equal(emAberto(rec("g", "2020-01-01", 100, { status: "cancelled" })), 0);
});

test("resumo: em aberto, vencido, a vencer e próximo vencimento", () => {
  const lista = [rec("a", "2019-03-01", 1000), rec("b", "2026-12-01", 500, { reviewReason: "x" }), rec("c", "2026-10-15", 250), rec("d", "2026-11-01", 900, { status: "cancelled" }), rec("e", "2026-11-01", 300, { status: "settled" })];
  assert.deepEqual(resumoRecebiveis(lista, HOJE), { aberto: 1750, vencido: 1000, aVencer: 750, quantidade: 3, quantidadeVencida: 1, revisar: 1, proximo: "2026-10-15" });
});

test("agrupa pelo grupo do cliente, maior valor primeiro, títulos por vencimento", () => {
  const lista = [rec("a", "2026-12-01", 100, { group: "O-I / SP", counterparty: "OWENS SP" }), rec("b", "2019-01-01", 50, { group: "O-I / SP", counterparty: "OWENS SP" }),
    rec("c", "2026-11-01", 900, { group: "VERALLIA", counterparty: "VERALLIA BRASIL" }), rec("d", "2026-11-01", 10, { group: "VERALLIA", counterparty: "VERALLIA CHILE" }), rec("e", "2026-11-01", 5)];
  const grupos = agruparRecebiveis(lista, HOJE);
  assert.deepEqual(grupos.map((g) => [g.nome, g.aberto, g.vencido, g.cliente]), [["VERALLIA", 910, 0, null], ["O-I / SP", 150, 50, "OWENS SP"], ["Cliente e", 5, 0, "Cliente e"]]);
  assert.deepEqual(grupos[1].titulos.map((t) => t.id), ["b", "a"]);
});
