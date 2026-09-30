import assert from "node:assert/strict";
import test from "node:test";

const { LAYOUT_PAGAR, allocationIssue, conferirRelatorio, isPlaceholder, legacyKeyOf, parseRelatorioTitulos, reviewReasons } = await import("../lib/finance/relatorio-titulos-parser.ts");

// --- Monta páginas como o relatório "Contas à Pagar/Pagas" desenha ---------------
const it = (x, y, s, w = s.length * 3.8) => ({ x, y, w, s });
/** Número alinhado à direita na coluna: lançado (700), corrigido (762) ou pago (820). */
const num = (right, y, s) => it(right - s.length * 3.8, y, s, s.length * 3.8);
const cabecalho = () => [it(21.7, 517.1, "Fornecedor"), it(21.7, 507.1, "Pago"), it(441, 507.1, "Histórico"), it(27, 22.2, "PECSIL METALÚRGICA E FUNDIÇÃO LTDA")];
const grupo = (y, nome) => [it(21.7, y, nome)];
/** Linha do título (datas, caixas, nome, histórico, valores). Devolve os itens e o y logo abaixo. */
function linha(y, { lanc, venc, pgto = null, nome, hist = [], doc = null, tipo = "BOL", valor, pago = null, prev = false, obs = null }) {
  const itens = [it(75, y, lanc), it(125.3, y, venc), it(26.3, y - 1.1, pago ? "þ" : "¨"), it(48, y - 1.1, prev ? "þ" : "¨"), it(610.2, y, tipo), num(700, y, valor), num(762, y, valor)];
  if (pgto) itens.push(it(174, y, pgto));
  if (pago) itens.push(num(820, y, pago));
  nome.forEach(([texto, w], i) => itens.push(it(224.3, y - 8 * i, texto, w)));
  hist.forEach(([texto, w], i) => itens.push(it(438.7, y - 7.9 * i, texto, w)));
  if (doc) itens.push(it(549.7, y, doc));
  let cursor = y - 8 * Math.max(1, hist.length, nome.length) - 2.5;
  if (obs) { itens.push(it(74.8, cursor, "Obs.:"), it(100.4, cursor, obs)); cursor -= 9.8; }
  return { itens, cursor };
}
const conta = (y, texto, valor) => [it(75, y, "Plano de Contas"), it(300.2, y, "Valor (R$)"), num(384, y, valor), it(138, y, texto)];
const totais = (y, { real = null, total }) => [
  it(599.3, y, "Previsões"),
  it(583, y - 9, "Sem Previsões"), ...(real ? [num(820, y - 9, real)] : []),
  it(582.8, y - 18, "Total do Grupo"), num(700, y - 18, total[0]), num(762, y - 18, total[1]), num(820, y - 18, total[2]),
];
const geral = (y, total) => [it(563.5, y, "Total de Previsões"), it(555.8, y - 11, "Total Sem Previsões"), it(592.6, y - 22, "Total Geral"), num(700, y - 22, total[0]), num(762, y - 22, total[1]), num(820, y - 22, total[2])];

function relatorio({ totalAlfa = ["2.333,33", "2.333,33", "1.208,30"], totalGeral = ["3.049,99", "3.049,99", "1.594,96"] } = {}) {
  // Página 1 — ALFA: previsão em aberto; pago a maior (juros rateados); e um título cujas contas caem na página 2.
  const a = linha(478.6, { lanc: "02/02/26", venc: "15/01/26", nome: [["ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAME", 209.6], ["NTAS LTDA", 40]], hist: [["ORDEM DE COMPRA: 13666", 92.9]], tipo: "CRE", valor: "472,50", prev: true, obs: "Diferença de valores da ordem de compra" });
  const b = linha(a.cursor - 22, { lanc: "08/01/26", venc: "09/02/26", pgto: "10/02/26", nome: [["ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAME", 209.6], ["NTAS LTDA", 40]], hist: [["ORDEM DE COMPRA: 13616 (PAR", 108.3], ["C. 1/2)", 25]], doc: "NFSE.4", valor: "1.170,00", pago: "1.208,30" });
  const c = linha(b.cursor - 40, { lanc: "28/05/26", venc: "26/10/26", nome: [["ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAME", 209.6], ["NTAS LTDA", 40]], hist: [["ENTRADA Nº : 14394 (PARC. 3/3) NF: 290", 135.6]], valor: "690,83" });
  const p1 = [...cabecalho(), ...grupo(491.5, "ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAMENTAS LTDA"),
    ...a.itens, ...conta(a.cursor, "05.13.011 - ACESSORIOS VEÍCULOS", "472,50"),
    ...b.itens, ...conta(b.cursor, "02.01.001 - TF. TED / DOC", "2,40"), ...conta(b.cursor - 8.2, "02.01.002 - TF. FORMULÁRIO", "35,90"), ...conta(b.cursor - 16.4, "04.03.026 - AFIAÇÃO DE FERRAMENTAS", "1.170,00"),
    ...c.itens];
  // Página 2 — as contas do último título continuam sob o nome repetido; totais; depois dois blocos com o MESMO nome.
  const d = linha(405, { lanc: "03/02/26", venc: "03/03/26", pgto: "03/03/26", nome: [["CASA DOS PARAFUSOS", 80]], hist: [["ENTRADA Nº : 13930", 70]], doc: "NF: 102862", valor: "386,66", pago: "386,66" });
  const e = linha(330, { lanc: "04/02/26", venc: "04/03/26", nome: [["CASA DOS PARAFUSOS", 80]], hist: [["ENTRADA Nº : 13931", 70]], doc: "NF: 102863", valor: "330,00" });
  const p2 = [...cabecalho(), ...grupo(491.5, "ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAMENTAS LTDA"),
    ...conta(480.8, "06.06 - MÁQUINAS E EQUIPAMENTOS", "650,83"), ...conta(472.6, "04.03.012 - MANUTENÇÃO", "40,00"),
    ...totais(455, { real: "1.208,30", total: totalAlfa }),
    ...grupo(418, "CASA DOS PARAFUSOS"), ...d.itens, ...conta(d.cursor, "05.008 - INSUMOS PRODUÇÃO USINAGEM", "386,66"), ...totais(d.cursor - 20, { real: "386,66", total: ["386,66", "386,66", "386,66"] }),
    ...grupo(343, "CASA DOS PARAFUSOS"), ...e.itens, ...conta(e.cursor, "05.009 - INSUMOS PRODUÇÃO FUNDIÇÃO", "330,00"), ...totais(e.cursor - 20, { total: ["330,00", "330,00", "0,00"] }),
    ...geral(e.cursor - 70, totalGeral)];
  return [p1, p2];
}
const ler = (opcoes) => parseRelatorioTitulos(relatorio(opcoes), LAYOUT_PAGAR);

test("lê pago, em aberto e previsão, com data e valor pago", () => {
  const { titles } = ler();
  assert.equal(titles.length, 5);
  const [a, b, c] = titles;
  assert.deepEqual([a.forecast, a.paid, a.paidDate, a.paidCents], [true, false, null, 0]);
  assert.equal(a.notes, "Diferença de valores da ordem de compra");
  assert.equal(a.documentType, "CRE");
  assert.deepEqual([b.paid, b.paidDate, b.cents, b.correctedCents, b.paidCents], [true, "2026-02-10", 117000, 117000, 120830]);
  assert.equal(b.document, "NFSE.4");
  assert.equal(b.history, "ORDEM DE COMPRA: 13616 (PARC. 1/2)");
  assert.deepEqual([c.paid, c.issueDate, c.dueDate], [false, "2026-05-28", "2026-10-26"]);
});

test("título que continua na página seguinte leva as contas de lá, sem o nome repetido no topo", () => {
  const c = ler().titles[2];
  assert.equal(c.page, 1);
  assert.equal(c.group, "ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAMENTAS LTDA");
  assert.deepEqual(c.allocations.map((x) => [x.code, x.cents]), [["06.06", 65083], ["04.03.012", 4000]]);
  assert.equal(allocationIssue(c), null);
  assert.equal(c.party, "ALFA FERRAMENTAS INDUSTRIA E COMERCIO DE FERRAMENTAS LTDA", "nome cortado no meio da palavra é colado");
});

test("pago a maior: o rateio soma o valor PAGO (juros e tarifa em contas próprias)", () => {
  const b = ler().titles[1];
  assert.deepEqual(b.allocations.map((x) => x.code), ["02.01.001", "02.01.002", "04.03.026"]);
  assert.equal(b.allocations.reduce((s, x) => s + x.cents, 0), b.paidCents);
  assert.equal(allocationIssue(b), null);
  assert.deepEqual(allocationIssue({ ...b, paid: false }), { allocated: 120830, diff: 3830 });
});

test("blocos com o mesmo nome são grupos separados, conferidos pela ordem", () => {
  const r = ler();
  assert.deepEqual(r.groups.map((g) => [g.name.slice(0, 4), g.block, g.total.issued, g.total.paid]), [["ALFA", 0, 233333, 120830], ["CASA", 1, 38666, 38666], ["CASA", 2, 33000, 0]]);
  assert.deepEqual(r.titles.map((t) => t.block), [0, 0, 0, 1, 2]);
  assert.deepEqual(r.grand.total, { issued: 304999, corrected: 304999, paid: 159496 });
  assert.deepEqual(conferirRelatorio(r, 0), { problems: [], notices: [] });
});

test("diferença de centavos do próprio relatório: aviso dentro da tolerância, bloqueio fora dela", () => {
  // O relatório imprime 2.333,34 para linhas que somam 2.333,33.
  const r = ler({ totalAlfa: ["2.333,34", "2.333,34", "1.208,30"], totalGeral: ["3.049,99", "3.049,99", "1.594,96"] });
  const exato = conferirRelatorio(r, 0);
  assert.equal(exato.problems.length, 2);
  assert.match(exato.problems[0], /^ALFA.*total lido 2\.333,33 ≠ relatório 2\.333,34/);
  const tolerante = conferirRelatorio(r, 1);
  assert.deepEqual(tolerante.problems, []);
  assert.equal(tolerante.notices.length, 2);
  // 3 títulos no grupo → até 3 centavos; 10 reais de diferença continua bloqueando.
  const errado = conferirRelatorio(ler({ totalAlfa: ["2.343,33", "2.343,33", "1.208,30"] }), 1);
  assert.ok(errado.problems.some((p) => p.startsWith("ALFA")));
});

test("revisão, valor simbólico e chave", () => {
  const [a, b] = ler().titles;
  assert.deepEqual(reviewReasons(a, "fornecedor"), ["Vencimento anterior ao lançamento"]);
  assert.deepEqual(reviewReasons({ ...a, party: "" }, "fornecedor"), ["Vencimento anterior ao lançamento", "Sem fornecedor"]);
  assert.deepEqual(reviewReasons({ ...b, notes: "BAIXEI CONTRATO" }, "fornecedor"), [], "observação de baixa não pede revisão em título já pago");
  assert.equal(isPlaceholder({ cents: 23 }), true);
  assert.equal(isPlaceholder(b), false);
  assert.ok(legacyKeyOf("cp", a, 0).startsWith("cp|ALFA"));
  assert.notEqual(legacyKeyOf("cp", a, 0), legacyKeyOf("cp", a, 1));
});
