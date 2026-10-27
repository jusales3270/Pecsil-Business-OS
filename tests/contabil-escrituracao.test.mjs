import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { aplicarRegra, regraNaData } = await import("../lib/contabil/escrituracao/regras.ts");
const { eventoDoTitulo, eventoDaBaixa } = await import("../lib/contabil/escrituracao/eventos.ts");
const { lerEcd, lerPlanoCsv, partidasDeAbertura } = await import("../lib/contabil/escrituracao/ecd.ts");
const { montarBalancete } = await import("../lib/contabil/escrituracao/balancete.ts");
const { planoDeExemplo } = await import("../lib/contabil/escrituracao/exemplo.ts");

// As regras padrão, iguais às da migração 202610260001.
const REGRAS = [
  { id: "r1", organization_id: null, evento: "titulo_pagar", descricao: "", vigente_de: "2000-01-01", vigente_ate: null, partidas: [{ lado: "D", conta: "alocacao", valor: "alocacao" }, { lado: "C", conta: "papel:contas_a_pagar", valor: "valor" }] },
  { id: "r2", organization_id: null, evento: "titulo_receber", descricao: "", vigente_de: "2000-01-01", vigente_ate: null, partidas: [{ lado: "D", conta: "papel:contas_a_receber", valor: "valor" }, { lado: "C", conta: "alocacao", valor: "alocacao" }] },
  { id: "r3", organization_id: null, evento: "baixa_pagar", descricao: "", vigente_de: "2000-01-01", vigente_ate: null, partidas: [{ lado: "D", conta: "papel:contas_a_pagar", valor: "principal" }, { lado: "D", conta: "papel:juros_pagos", valor: "juros" }, { lado: "D", conta: "papel:multas_pagas", valor: "multa" }, { lado: "C", conta: "papel:descontos_obtidos", valor: "desconto" }, { lado: "C", conta: "banco", valor: "caixa" }] },
  { id: "r4", organization_id: null, evento: "baixa_receber", descricao: "", vigente_de: "2000-01-01", vigente_ate: null, partidas: [{ lado: "D", conta: "banco", valor: "caixa" }, { lado: "D", conta: "papel:descontos_concedidos", valor: "desconto" }, { lado: "C", conta: "papel:contas_a_receber", valor: "principal" }, { lado: "C", conta: "papel:juros_recebidos", valor: "juros" }, { lado: "C", conta: "papel:multas_recebidas", valor: "multa" }] },
];
const V = {
  gerencial: new Map([["g-energia", "c-cif"], ["g-material", "c-mat"], ["g-venda", "c-receita"]]),
  bancaria: new Map([["b-itau", "c-banco"]]),
  papel: new Map([["contas_a_pagar", "c-fornec"], ["contas_a_receber", "c-clientes"], ["juros_pagos", "c-juros-p"], ["multas_pagas", "c-multas-p"], ["descontos_obtidos", "c-desc-o"], ["juros_recebidos", "c-juros-r"], ["multas_recebidas", "c-multas-r"], ["descontos_concedidos", "c-desc-c"]]),
};
const soma = (ps, lado) => Math.round(ps.filter((p) => p.lado === lado).reduce((t, p) => t + p.valor * 100, 0)) / 100;
const titulo = (extra = {}) => ({ id: "t1", direction: "payable", counterparty_name: "FORNECEDOR X", document_number: "123", description: null, competence_date: "2026-03-10", issue_date: "2026-03-01", original_amount: "1500.00", chart_account_id: "g-energia", cost_center_id: "cc1", is_forecast: false, archived_at: null, cancelled_at: null, ...extra });
const baixa = (extra = {}, tit = {}) => ({ id: "s1", settlement_date: "2026-04-10", amount: "1000.00", discount: "0", interest: "0", penalty: "0", exchange_difference: "0", bank_account_id: "b-itau", reversed_at: null, titulo: { id: "t1", direction: "payable", counterparty_name: "FORNECEDOR X", document_number: "123", cost_center_id: "cc1", ...tit }, ...extra });

test("título a pagar rateado: cada conta gerencial debita a sua conta contábil, contas a pagar no crédito", () => {
  const e = eventoDoTitulo(titulo(), [{ title_id: "t1", chart_account_id: "g-energia", amount: "1000" }, { title_id: "t1", chart_account_id: "g-material", amount: "500" }]);
  const r = aplicarRegra(e, regraNaData(REGRAS, e.tipo, e.data), V);
  assert.deepEqual(r.partidas.map((p) => [p.conta_id, p.lado, p.valor]), [["c-cif", "D", 1000], ["c-mat", "D", 500], ["c-fornec", "C", 1500]]);
  assert.equal(r.partidas[0].centro_custo_id, "cc1");
  assert.equal(r.partidas[2].centro_custo_id, null, "contas a pagar sem centro de custo");
  assert.match(e.historico, /Título a pagar nº 123 · FORNECEDOR X/);
});

test("pagamento com juros, multa e desconto fecha ao centavo; partida zero sai", () => {
  // Juros: o valor é a parcela e os juros vêm por cima (o banco paga valor + juros).
  const comJuros = eventoDaBaixa(baixa({ amount: "1795.25", interest: "38.30" }), null);
  const r1 = aplicarRegra(comJuros, regraNaData(REGRAS, comJuros.tipo, comJuros.data), V);
  assert.deepEqual(r1.partidas.map((p) => [p.conta_id, p.lado, p.valor]), [["c-fornec", "D", 1795.25], ["c-juros-p", "D", 38.3], ["c-banco", "C", 1833.55]]);
  // Desconto: o valor é o que saiu do banco; a parcela quitada é valor + desconto.
  const comDesconto = eventoDaBaixa(baixa({ amount: "2614.50", discount: "39.50" }), null);
  const r2 = aplicarRegra(comDesconto, regraNaData(REGRAS, comDesconto.tipo, comDesconto.data), V);
  assert.deepEqual(r2.partidas.map((p) => [p.conta_id, p.lado, p.valor]), [["c-fornec", "D", 2654], ["c-desc-o", "C", 39.5], ["c-banco", "C", 2614.5]]);
  assert.equal(soma(r2.partidas, "D"), soma(r2.partidas, "C"));
});

test("recebimento: banco no débito, contas a receber no crédito", () => {
  const e = eventoDaBaixa(baixa({ amount: "500", interest: "5", penalty: "10" }, { direction: "receivable" }), null);
  const r = aplicarRegra(e, regraNaData(REGRAS, e.tipo, e.data), V);
  assert.deepEqual(r.partidas.map((p) => [p.conta_id, p.lado, p.valor]), [["c-banco", "D", 515], ["c-clientes", "C", 500], ["c-juros-r", "C", 5], ["c-multas-r", "C", 10]]);
});

test("nada vai para conta adivinhada: sem vínculo, sem banco ou rateio que não fecha viram pendência", () => {
  const e = eventoDoTitulo(titulo({ chart_account_id: "g-desconhecida" }), []);
  assert.deepEqual(aplicarRegra(e, REGRAS[0], V).pendencia, { motivo: "sem_vinculo_gerencial", detalhe: "g-desconhecida" });
  const semBanco = eventoDaBaixa(baixa({ bank_account_id: null }), null);
  assert.equal(aplicarRegra(semBanco, REGRAS[2], V).pendencia.motivo, "sem_banco");
  const pelaConciliacao = eventoDaBaixa(baixa({ bank_account_id: null }), "b-itau");
  assert.ok(aplicarRegra(pelaConciliacao, REGRAS[2], V).partidas, "o banco vem da conciliação com o extrato");
  const torto = eventoDoTitulo(titulo(), [{ title_id: "t1", chart_account_id: "g-energia", amount: "1000" }]);
  assert.equal(aplicarRegra(torto, REGRAS[0], V).pendencia.motivo, "desequilibrado");
  assert.equal(aplicarRegra(eventoDoTitulo(titulo({ chart_account_id: null }), []), REGRAS[0], V).pendencia.motivo, "sem_rateio");
  assert.equal(aplicarRegra(eventoDoTitulo(titulo(), [{ title_id: "t1", chart_account_id: "g-energia", amount: "1500" }]), REGRAS[0], { ...V, papel: new Map() }).pendencia.detalhe, "contas_a_pagar");
  assert.equal(eventoDaBaixa(baixa({ exchange_difference: "12.5" }), null).pendencia.detalhe, "Baixa com variação cambial: lance à mão.");
});

test("previsão, arquivado, cancelado e baixa estornada não entram; regra da empresa vale mais que a padrão", () => {
  assert.equal(eventoDoTitulo(titulo({ is_forecast: true }), []), null);
  assert.equal(eventoDoTitulo(titulo({ archived_at: "2026-05-01" }), []), null);
  assert.equal(eventoDoTitulo(titulo({ cancelled_at: "2026-05-01" }), []), null);
  assert.equal(eventoDaBaixa(baixa({ reversed_at: "2026-05-01" }), null), null);
  const daEmpresa = { ...REGRAS[0], id: "r-org", organization_id: "org", vigente_de: "2026-01-01" };
  assert.equal(regraNaData([...REGRAS, daEmpresa], "titulo_pagar", "2026-03-10").id, "r-org");
  assert.equal(regraNaData([...REGRAS, daEmpresa], "titulo_pagar", "2025-12-31").id, "r1");
});

const ECD = [
  "|0000|LECD|01012025|31122025|EMPRESA EXEMPLO LTDA|11222333000181|SP||3523909|||0|1|0||0|0||N|N|0|0|1|",
  "|I050|01012020|01|S|1|1||ATIVO|",
  "|I050|01012020|01|A|2|1.01|1|BANCOS|",
  "|I051||1.01.01.02.00|",
  "|I050|01012020|01|A|2|1.02|1|CLIENTES|",
  "|I050|01012020|02|S|1|2||PASSIVO|",
  "|I050|01012020|02|A|2|2.01|2|FORNECEDORES|",
  "|I050|01012020|03|A|2|3.01|2|CAPITAL SOCIAL|",
  "|I050|01012020|04|A|1|4.01||RECEITA|",
  "|I150|01112025|30112025|",
  "|I155|1.01||100,00|D|0,00|0,00|100,00|D|",
  "|I150|01122025|31122025|",
  "|I155|1.01||100,00|D|1.200,00|300,00|1.000,00|D|",
  "|I155|1.02||0,00|D|500,50|0,00|500,50|D|",
  "|I155|2.01||0,00|C|0,00|700,50|700,50|C|",
  "|I155|3.01||0,00|C|0,00|800,00|800,00|C|",
  "|I155|4.01||0,00|C|0,00|0,00|0,00|C|",
].join("\r\n");

test("ECD: plano (I050), referencial (I051) e saldos do último período (I155), e a abertura fecha", () => {
  const r = lerEcd(ECD);
  assert.equal(r.contas.length, 7);
  assert.deepEqual(r.contas[1], { codigo: "1.01", nome: "BANCOS", natureza: "ativo", tipo: "analitica", nivel: 2, superior_codigo: "1", referencial: "1.01.01.02.00", reduzido: null, dre_grupo: null, saldo_normal: null });
  assert.equal(r.contas[6].natureza, "resultado");
  assert.equal(r.saldosEm, "2025-12-31");
  assert.deepEqual(r.saldos, [{ codigo: "1.01", valor: 1000, lado: "D" }, { codigo: "1.02", valor: 500.5, lado: "D" }, { codigo: "2.01", valor: 700.5, lado: "C" }, { codigo: "3.01", valor: 800, lado: "C" }]);
  assert.equal(r.empresa.cnpj, "11222333000181");
  const contas = r.contas.map((c, k) => ({ ...c, id: `id${k}` }));
  const a = partidasDeAbertura(contas, r.saldos);
  assert.ok(a.fecha);
  assert.equal(a.debitos, 1500.5);
  assert.deepEqual(a.faltam, []);
  assert.match(lerEcd("|0000|x|").avisos[0], /I050/);
});

test("planilha: nível, superior e tipo saem do código quando faltam", () => {
  const r = lerPlanoCsv("Código;Nome;Natureza\n1;ATIVO;Ativo\n1.1;CIRCULANTE;ativo\n1.1.01;Caixa;01\n4;RESULTADO;Resultado\n4.1;Receita;04\nX;Sem natureza;??");
  assert.deepEqual(r.contas.map((c) => [c.codigo, c.nivel, c.superior_codigo, c.tipo, c.natureza]), [["1", 1, null, "sintetica", "ativo"], ["1.1", 2, "1", "sintetica", "ativo"], ["1.1.01", 3, "1.1", "analitica", "ativo"], ["4", 1, null, "sintetica", "resultado"], ["4.1", 2, "4", "analitica", "resultado"]]);
  assert.match(r.avisos[0], /Linha 7/);
  assert.match(lerPlanoCsv("a;b\n1;2").avisos[0], /codigo, nome e natureza/);
});

test("planilha do escritório: máscara fixa, reduzido, grupo da DRE e saldo normal", () => {
  const csv = [
    "Conta;Descrição;Reduzida;D.R.E.;Plano Ref.;NATUREZADC;NATUREZA",
    "1.0.00.00.0000;Ativo;;;;D;1",
    "1.2.03.02.0000;(-) Depreciação Acumulada;;;;C;1",
    "1.2.03.02.0001;(-) Depreciação Acumulada Modelos;1100;;8;C;1",
    "2.3.03.00.0000;Ajuste de Avaliação Patrimonial;;;;C;3",
    "3.1.01.01.0001;Vendas de Mercadorias;29;A;671;C;4",
    "6.1.01.01.0001;Resultado do Exercício;75;R;;C;9",
  ].join("\n");
  const r = lerPlanoCsv(csv);
  assert.deepEqual(r.avisos, []);
  assert.deepEqual(r.contas.map((c) => [c.codigo, c.nivel, c.superior_codigo, c.tipo, c.natureza, c.reduzido, c.dre_grupo, c.saldo_normal, c.referencial]), [
    ["1.0.00.00.0000", 1, null, "sintetica", "ativo", null, null, "D", null],
    ["1.2.03.02.0000", 4, "1.2.03.00.0000", "sintetica", "ativo", null, null, "C", null],
    ["1.2.03.02.0001", 5, "1.2.03.02.0000", "analitica", "ativo", "1100", null, "C", null],
    ["2.3.03.00.0000", 3, "2.3.00.00.0000", "sintetica", "pl", null, null, "C", null],
    ["3.1.01.01.0001", 5, "3.1.01.01.0000", "analitica", "resultado", "29", "A", "C", null],
    ["6.1.01.01.0001", 5, "6.1.01.01.0000", "analitica", "outras", "75", "R", "C", null],
  ], "a natureza vem da coluna NATUREZA (não da NATUREZADC) e o \"Plano Ref.\" do escritório não vira referencial da Receita");
});

test("balancete: redutora com saldo do lado do seu saldo normal não alerta", () => {
  const contas = [
    { id: "dep", codigo: "1.2.03.02.0001", nome: "(-) Depreciação", natureza: "ativo", tipo: "analitica", nivel: 5, superior_codigo: null, saldo_normal: "C" },
    { id: "maq", codigo: "1.2.03.01.0004", nome: "Máquinas", natureza: "ativo", tipo: "analitica", nivel: 5, superior_codigo: null, saldo_normal: "D" },
    { id: "for", codigo: "2.1.01.01.0682", nome: "Fornecedor", natureza: "passivo", tipo: "analitica", nivel: 5, superior_codigo: null },
  ];
  const b = montarBalancete(contas, [{ conta_id: "dep", anterior: 0, debitos: 0, creditos: 300 }, { conta_id: "maq", anterior: 0, debitos: 0, creditos: 100 }, { conta_id: "for", anterior: 0, debitos: 400, creditos: 0 }]);
  const alerta = Object.fromEntries(b.linhas.map((l) => [l.id, l.alerta]));
  assert.equal(alerta.dep, null);
  assert.equal(alerta.maq, "Saldo credor numa conta de saldo devedor.");
  assert.equal(alerta.for, "Saldo devedor numa conta de passivo.", "sem saldo normal, vale o grupo");
});

test("balancete: sintética soma as filhas, débito = crédito e alerta de natureza", () => {
  const contas = [
    { id: "a", codigo: "1", nome: "ATIVO", natureza: "ativo", tipo: "sintetica", nivel: 1, superior_codigo: null },
    { id: "b", codigo: "1.1", nome: "Banco", natureza: "ativo", tipo: "analitica", nivel: 2, superior_codigo: "1" },
    { id: "c", codigo: "1.2", nome: "Clientes", natureza: "ativo", tipo: "analitica", nivel: 2, superior_codigo: "1" },
    { id: "d", codigo: "2.1", nome: "Fornecedores", natureza: "passivo", tipo: "analitica", nivel: 2, superior_codigo: "2" },
    { id: "e", codigo: "2", nome: "PASSIVO", natureza: "passivo", tipo: "sintetica", nivel: 1, superior_codigo: null },
  ];
  const b = montarBalancete(contas, [{ conta_id: "b", anterior: 100, debitos: 50, creditos: 300 }, { conta_id: "c", anterior: 0, debitos: 400, creditos: 0 }, { conta_id: "d", anterior: -100, debitos: 300, creditos: 450 }]);
  const l = Object.fromEntries(b.linhas.map((x) => [x.codigo, x]));
  assert.equal(l["1"].final, 250);
  assert.equal(l["1"].debitos, 450);
  assert.equal(l["1.1"].final, -150);
  assert.match(l["1.1"].alerta, /credor numa conta de ativo/);
  assert.equal(l["2"].final, -250);
  assert.ok(b.integro);
  assert.deepEqual(b.linhas.map((x) => x.codigo), ["1", "1.1", "1.2", "2", "2.1"]);
  assert.equal(montarBalancete(contas, [{ conta_id: "b", anterior: 0, debitos: 10, creditos: 0 }]).integro, false);
});

test("plano de exemplo: códigos únicos, papéis em contas analíticas e só exemplo", () => {
  const { contas, vinculos } = planoDeExemplo();
  assert.equal(new Set(contas.map((c) => c.codigo)).size, contas.length);
  const analiticas = new Set(contas.filter((c) => c.tipo === "analitica").map((c) => c.codigo));
  assert.equal(vinculos.length, 8);
  assert.ok(vinculos.every((v) => analiticas.has(v.codigo)));
  assert.ok(contas.every((c) => !c.superior_codigo || contas.some((x) => x.codigo === c.superior_codigo && x.tipo === "sintetica")));
});

test("ECD inteira: abertura pelo saldo inicial, lançamentos com encerramento marcado e saldos que fecham mês a mês", async () => {
  const { lerEscrituracaoEcd, codigoChave } = await import("../lib/contabil/escrituracao/ecd.ts");
  const ecd = [
    "|0000|LECD|01012025|31122025|EMPRESA EXEMPLO LTDA|11222333000181|SP||3523909|||0|1|0||0|0||N|N|0|0|2|",
    "|I050|01012025|01|A|5|1101020001|110102|BANCO|", "|I051||1.01.01.02.00|",
    "|I050|01012025|02|A|5|2101010001|210101|FORNECEDOR A|", "|I051||2.01.01.01.00|",
    "|I050|01012025|03|A|5|2401010001|240101|CAPITAL|",
    "|I050|01012025|04|A|5|5101010001|510101|CUSTO|",
    "|I150|01012025|31012025|",
    "|I155|1101020001||1000,00|D|0,00|300,00|700,00|D|", "|I155|2101010001||0,00|C|300,00|300,00|0,00|C|",
    "|I155|2401010001||1000,00|C|0,00|0,00|1000,00|C|", "|I155|5101010001||0,00|D|300,00|0,00|300,00|D|",
    "|I150|01022025|28022025|",
    "|I155|1101020001||700,00|D|0,00|0,00|700,00|D|", "|I155|2401010001||1000,00|C|300,00|0,00|700,00|C|", "|I155|5101010001||300,00|D|0,00|300,00|0,00|D|",
    "|I200|1|10012025|300,00|N||", "|I250|5101010001||300,00|D|||CONFORME NF: 10 FORNECEDOR A||", "|I250|2101010001||300,00|C|||CONFORME NF: 10 FORNECEDOR A||",
    "|I200|2|20012025|300,00|N||", "|I250|2101010001||300,00|D|||PAGTO REF. NF N.10 FORNECEDOR A||", "|I250|1101020001||300,00|C|||PAGTO REF. NF N.10 FORNECEDOR A||",
    "|I200|3|28022025|300,00|E||", "|I250|2401010001||300,00|D|||ENCERRAMENTO||", "|I250|5101010001||300,00|C|||ENCERRAMENTO||",
    "|J930|Fulano|12345678901|Contabilista|900|1SP000000|||||||",
  ].join("\r\n");
  const e = lerEscrituracaoEcd(ecd);
  assert.deepEqual([e.inicio, e.fim, e.abertura, e.empresa.cnpj], ["2025-01-01", "2025-12-31", "2025-01-01", "11222333000181"]);
  assert.deepEqual(e.saldosIniciais, [{ codigo: "1101020001", valor: 1000, lado: "D" }, { codigo: "2401010001", valor: 1000, lado: "C" }]);
  assert.equal(e.referencial.get("2101010001"), "2.01.01.01.00");
  assert.equal(e.lancamentos.length, 3);
  assert.deepEqual(e.lancamentos.map((l) => l.encerramento), [false, false, true]);
  assert.equal(e.lancamentos[0].historico, "CONFORME NF: 10 FORNECEDOR A");
  assert.deepEqual(e.avisos, []);
  assert.ok(!JSON.stringify(e).includes("12345678901"), "o CPF do signatário (J930) não é lido");
  // Saldo inicial + lançamentos = saldo final do I155, mês a mês.
  const saldo = new Map(e.saldosIniciais.map((s) => [s.codigo, s.lado === "D" ? s.valor : -s.valor]));
  for (const mes of ["2025-01-31", "2025-02-28"]) {
    for (const l of e.lancamentos.filter((x) => x.data <= mes && x.data > (mes === "2025-01-31" ? "0" : "2025-01-31"))) for (const p of l.partidas) saldo.set(p.codigo, (saldo.get(p.codigo) ?? 0) + (p.lado === "D" ? p.valor : -p.valor));
    for (const [c, v] of e.saldosFinais.get(mes)) assert.equal(Math.round((saldo.get(c) ?? 0) * 100), Math.round(v * 100), `${c} em ${mes}`);
  }
  assert.equal(codigoChave("1.1.01.02.0001"), codigoChave("1101020001"));
  const torta = lerEscrituracaoEcd(ecd.replace("|I250|2101010001||300,00|C|||CONFORME", "|I250|2101010001||299,00|C|||CONFORME"));
  assert.match(torta.avisos[0], /sem partida dobrada \(ex\.: nº 1\)/);
});

test("DRE e balanço: grupos como a ECD, prejuízo no fim e resultado não encerrado no PL para fechar", async () => {
  const { montarDre, montarBalanco } = await import("../lib/contabil/escrituracao/demonstracoes.ts");
  const conta = (id, codigo, nome, natureza, nivel, superior, tipo = "sintetica") => ({ id, codigo, nome, natureza, tipo, nivel, superior_codigo: superior });
  const contas = [
    conta("a", "1", "ATIVO", "ativo", 1, null), conta("a1", "1.1", "Bancos", "ativo", 2, "1"), conta("itau", "1.1.01", "Itaú", "ativo", 3, "1.1", "analitica"),
    conta("p", "2", "PASSIVO", "passivo", 1, null), conta("p1", "2.1", "Fornecedores", "passivo", 2, "2"), conta("forn", "2.1.01", "Fornecedor X", "passivo", 3, "2.1", "analitica"),
    conta("pl", "2.3", "Capital", "pl", 2, "2"), conta("cap", "2.3.01", "Capital social", "pl", 3, "2.3", "analitica"),
    conta("r", "3", "RECEITA", "resultado", 1, null), conta("rv", "3.1", "Vendas", "resultado", 2, "3"), conta("venda", "3.1.01", "Venda de peças", "resultado", 3, "3.1", "analitica"),
    conta("d", "5", "DESPESAS", "resultado", 1, null), conta("da", "5.1", "Administrativas", "resultado", 2, "5"), conta("luz", "5.1.01", "Energia", "resultado", 3, "5.1", "analitica"),
    conta("x", "5.1.02", "Aluguel", "resultado", 3, "5.1", "analitica"),
  ];
  const dre = montarDre(contas, [{ conta_id: "venda", debitos: 0, creditos: 1000 }, { conta_id: "luz", debitos: 1300.5, creditos: 0 }]);
  assert.deepEqual(dre.linhas.map((l) => [l.codigo, l.tipo, l.valor]), [["3", "grupo", 1000], ["3.1", "grupo", 1000], ["3.1.01", "conta", 1000], ["5", "grupo", -1300.5], ["5.1", "grupo", -1300.5], ["5.1.01", "conta", -1300.5], ["", "total", -300.5]]);
  assert.equal(dre.linhas.at(-1).nome, "= Prejuízo");
  assert.equal(dre.resultado, -300.5);
  // Banco 5.000 D; fornecedor 2.000 C; capital 3.300,50 C; resultado do período (prejuízo de 300,50) ainda nas contas.
  const bal = montarBalanco(contas, [
    { conta_id: "itau", anterior: 5000, debitos: 0, creditos: 0 }, { conta_id: "forn", anterior: -2000, debitos: 0, creditos: 0 },
    { conta_id: "cap", anterior: -3300.5, debitos: 0, creditos: 0 }, { conta_id: "venda", anterior: 0, debitos: 0, creditos: 1000 }, { conta_id: "luz", anterior: 0, debitos: 1300.5, creditos: 0 },
  ]);
  assert.equal(bal.ativo, 5000);
  assert.equal(bal.resultadoNaoEncerrado, -300.5);
  assert.equal(bal.passivoPl, 5000);
  assert.equal(bal.fecha, true);
  assert.deepEqual(bal.linhas.map((l) => [l.codigo, l.valor]), [["1", 5000], ["1.1", 5000], ["1.1.01", 5000], ["2", -5300.5], ["2.1", -2000], ["2.1.01", -2000], ["2.3", -3300.5], ["2.3.01", -3300.5]]);
});
