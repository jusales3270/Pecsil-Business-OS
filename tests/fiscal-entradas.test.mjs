import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { lerNotaEntrada, checar, classificar, situacaoDa, cfopEntradaPara } = await import("../lib/fiscal/entradas/checagem.ts");

const EMPRESA = "11222333000181";
// Nota fictícia no formato real: emitente, itens com ICMS/IPI e o total.
const nota = ({ uf = "SP", crt = "3", fin = "1", ref = "", itens, vProd } = {}) => `<?xml version="1.0"?><nfeProc><NFe><infNFe versao="4.00" Id="NFe35261099888777000166550010000012341000012345">
<ide><nNF>1234</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi><finNFe>${fin}</finNFe>${ref}</ide>
<emit><CNPJ>99888777000166</CNPJ><xNome>FORNECEDOR &amp; CIA</xNome><enderEmit><UF>${uf}</UF></enderEmit><CRT>${crt}</CRT></emit><dest><CNPJ>${EMPRESA}</CNPJ></dest>
${itens.join("\n")}
<total><ICMSTot><vProd>${vProd}</vProd><vNF>${vProd}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
const item = ({ n = 1, cfop = "5102", ncm = "73181500", icms = "<ICMS00><orig>0</orig><CST>00</CST><pICMS>18.0000</pICMS><vICMS>18.00</vICMS></ICMS00>", ibs = true, v = "100.00" } = {}) =>
  `<det nItem="${n}"><prod><cProd>P${n}</cProd><xProd>PARAFUSO ${n}</xProd><NCM>${ncm}</NCM><CFOP>${cfop}</CFOP><uCom>UN</uCom><qCom>10</qCom><vProd>${v}</vProd></prod><imposto><ICMS>${icms}</ICMS>${ibs ? "<IBSCBS><CST>000</CST></IBSCBS>" : ""}</imposto></det>`;
const regras = (x) => checar(x, "SP").map((a) => a.regra);

test("nota limpa não acusa nada e lê emitente, UF, regime e itens", () => {
  const n = lerNotaEntrada(nota({ itens: [item()], vProd: "100.00" }));
  assert.equal(n.emitente.nome, "FORNECEDOR & CIA");
  assert.equal(n.emitente.uf, "SP");
  assert.equal(n.emitente.crt, 3);
  assert.equal(n.itens[0].pICMS, 18);
  assert.deepEqual(checar(n, "SP"), []);
  assert.equal(situacaoDa([]), "ok");
});

test("CFOP × origem, NCM, CST × regime e CST × valor", () => {
  assert.ok(regras(lerNotaEntrada(nota({ uf: "MG", itens: [item({ cfop: "5102", icms: "<ICMS00><orig>0</orig><CST>00</CST><pICMS>12.0000</pICMS><vICMS>12.00</vICMS></ICMS00>" })], vProd: "100.00" }))).includes("cfop_uf"));
  assert.ok(regras(lerNotaEntrada(nota({ itens: [item({ ncm: "0000" })], vProd: "100.00" }))).includes("ncm"));
  const simplesComCst = lerNotaEntrada(nota({ crt: "1", itens: [item({ ibs: false })], vProd: "100.00" }));
  assert.ok(regras(simplesComCst).includes("cst_regime"));
  assert.ok(!regras(simplesComCst).includes("ibs_cbs"), "Simples sem o grupo do IBS/CBS não é falta em 2026");
  const normalComCsosn = lerNotaEntrada(nota({ itens: [item({ icms: "<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>" })], vProd: "100.00" }));
  assert.ok(regras(normalComCsosn).includes("cst_regime"));
  const isentoComValor = lerNotaEntrada(nota({ itens: [item({ icms: "<ICMS40><orig>0</orig><CST>40</CST><vICMS>5.00</vICMS></ICMS40>" })], vProd: "100.00" }));
  assert.equal(checar(isentoComValor, "SP")[0].nivel, "erro");
});

test("alíquota interestadual: 12% para SP, 4% para importado", () => {
  const de = (orig, p) => lerNotaEntrada(nota({ uf: "PR", itens: [item({ cfop: "6102", icms: `<ICMS00><orig>${orig}</orig><CST>00</CST><pICMS>${p}</pICMS><vICMS>1.00</vICMS></ICMS00>` })], vProd: "100.00" }));
  assert.deepEqual(regras(de("0", "12.0000")), []);
  assert.deepEqual(regras(de("1", "4.0000")), []);
  assert.match(checar(de("0", "7.0000"), "SP")[0].mensagem, /7%.*esperado é 12%/);
  assert.match(checar(de("1", "12.0000"), "SP")[0].mensagem, /esperado é 4%.*importada/);
});

test("grupo IBS/CBS, devolução sem origem e totais; achado repetido vira um só", () => {
  const sem = lerNotaEntrada(nota({ itens: [item({ ibs: false }), item({ n: 2, ibs: false })], vProd: "200.00" }));
  const a = checar(sem, "SP");
  assert.equal(a.length, 1);
  assert.match(a[0].mensagem, /^Itens 1, 2: Sem o grupo do IBS\/CBS/);
  assert.equal(situacaoDa(a), "atencao");
  assert.ok(regras(lerNotaEntrada(nota({ fin: "4", itens: [item({ cfop: "5202" })], vProd: "100.00" }))).includes("devolucao"));
  const comRef = lerNotaEntrada(nota({ fin: "4", ref: "<NFref><refNFe>35261011222333000181550010000000011000000011</refNFe></NFref>", itens: [item({ cfop: "5202" })], vProd: "100.00" }));
  assert.ok(!regras(comRef).includes("devolucao"));
  assert.ok(regras(lerNotaEntrada(nota({ itens: [item()], vProd: "150.00" }))).includes("totais"));
});

test("classificação: CFOP do emitente manda, depois o cadastro de materiais, depois o Painel do ICMS", () => {
  const n = (cfop, uf = "SP", extra = {}) => { const x = lerNotaEntrada(nota({ uf, itens: [item({ cfop })], vProd: "100.00", ...extra })); return classificar(x, x.itens[0], "SP", {}); };
  assert.deepEqual([n("5551").tipo, n("5551").cfopEntrada], ["08", "1551"]);
  assert.match(n("5551").credito, /CIAP em 48 meses/);
  assert.deepEqual([n("6202", "MG").tipo, n("6202", "MG").cfopEntrada], ["DV", "2202"]);
  assert.deepEqual([n("5901").tipo, n("5901").cfopEntrada], ["RI", "1901"]);
  assert.deepEqual([n("5910").tipo, n("5910").cfopEntrada], ["BO", "1910"]);
  const x = lerNotaEntrada(nota({ itens: [item()], vProd: "100.00" }));
  assert.deepEqual([classificar(x, x.itens[0], "SP", { tipoMaterial: "01" }).cfopEntrada, classificar(x, x.itens[0], "SP", { tipoMaterial: "01" }).porque], ["1101", "Pelo cadastro de materiais (código do fornecedor ligado)"]);
  assert.equal(classificar(x, x.itens[0], "SP", { tipoPainel: "Uso e consumo" }).cfopEntrada, "1556");
  assert.match(classificar(x, x.itens[0], "SP", { tipoPainel: "Uso e consumo" }).credito, /Sem crédito de ICMS/);
  assert.equal(classificar(x, x.itens[0], "SP", {}).tipo, "??");
  // Com ST, a família 140x.
  const st = lerNotaEntrada(nota({ itens: [item({ cfop: "5405", icms: "<ICMS10><orig>0</orig><CST>10</CST><pICMS>18.0000</pICMS><vICMS>18.00</vICMS><vICMSST>9.00</vICMSST></ICMS10>" })], vProd: "100.00" }));
  assert.equal(classificar(st, st.itens[0], "SP", { tipoPainel: "Uso e consumo" }).cfopEntrada, "1407");
  assert.equal(cfopEntradaPara("08", "2", "6102", false), "2551");
  assert.equal(cfopEntradaPara("RI", "1", "5102", false), null);
});
