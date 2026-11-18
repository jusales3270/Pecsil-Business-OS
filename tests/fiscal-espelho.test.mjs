import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

/**
 * Espelho do GRV (docs/PLANO-VIRADA-FISCAL.md, trava 1). As notas de tests/fixtures/espelho são cópias de notas
 * autorizadas que o sistema antigo emitiu (uma de cada operação da empresa), ANONIMIZADAS: CNPJ, nomes, endereços,
 * placas, textos dos itens e chaves referenciadas são fictícios; valores e tributos ficaram como vieram. A plataforma
 * refaz cada nota e o XML tem de bater campo a campo, salvo as diferenças aceitas (cada uma com o motivo escrito).
 */
const { espelhar, notaDoXml, compararXml, DIFERENCAS_ACEITAS } = await import("../lib/fiscal/emissao/espelho.ts");
const { lerXml, achatar } = await import("../lib/fiscal/xml-arvore.ts");
const { validarNota } = await import("../lib/fiscal/emissao/regras.ts");
const { assinaturaDeTreino } = await import("../lib/fiscal/emissao/xml.ts");

const pasta = new URL("./fixtures/espelho/", import.meta.url);
const notas = readdirSync(pasta).filter((n) => n.endsWith(".xml")).sort();
const ler = (n) => readFileSync(new URL(n, pasta), "utf8");

test("espelho: há uma nota de cada operação do GRV", () => {
  const cfops = new Set(notas.flatMap((n) => notaDoXml(ler(n)).nota.itens.map((i) => i.cfop)));
  for (const c of ["5101", "6101", "5915", "5916", "6916", "5901", "6949", "7101", "7501", "3101", "3551", "1101", "1604"]) assert.ok(cfops.has(c), `falta a operação ${c}`);
});

for (const nome of notas) {
  test(`espelho: ${nome} sai igual à nota do GRV`, () => {
    const r = espelhar(ler(nome));
    const reprovadas = r.vereditos.filter((v) => !v.aceita).map((v) => `${v.diferenca.caminho}: nosso=${v.diferenca.nosso} deles=${v.diferenca.deles}`);
    assert.deepEqual(reprovadas, []);
    assert.equal(r.bate, true);
  });
}

test("espelho: as notas do GRV passam nas regras da plataforma (nada que a SEFAZ aceitou é recusado aqui)", () => {
  for (const nome of notas) {
    const { nota, emitente } = notaDoXml(ler(nome));
    const { erros } = validarNota(nota, emitente);
    assert.deepEqual(erros.map((e) => e.mensagem), [], nome);
  }
});

test("espelho: grupos que o GRV usa e a plataforma agora gera", () => {
  const xml = (n) => espelhar(ler(n)).xmlNosso;
  assert.match(xml("venda-5101-cbenef.xml"), /<NCM>84805000<\/NCM><cBenef>SP020120<\/cBenef><CFOP>5101<\/CFOP>/);
  assert.match(xml("exportacao-7101-cbenef.xml"), /<cBenef>SP070050<\/cBenef>/);
  assert.match(xml("industrializacao-5901.xml"), /<cBenef>SP054020<\/cBenef>/);
  assert.match(xml("venda-5101-sp.xml"), /<infAdic><infAdFisco>ICMS - BASE DE CALCULO REDUZIDA/);
  assert.match(xml("venda-5101-sp.xml"), /<modFrete>3<\/modFrete><transporta>.*<xEnder>.*<\/xEnder><xMun>.*<\/xMun><UF>SP<\/UF><\/transporta><veicTransp><placa>ABC1D23<\/placa><UF>SP<\/UF><\/veicTransp>/);
  const exp = xml("exportacao-7101-7501.xml");
  assert.match(exp, /<dest><idEstrangeiro><\/idEstrangeiro>.*<cMun>9999999<\/cMun>.*<UF>EX<\/UF><cPais>639<\/cPais><xPais>ARGENTINA<\/xPais>/);
  assert.match(exp, /<indTot>1<\/indTot><detExport><nDraw>000000000<\/nDraw><exportInd><nRE>000000000<\/nRE><chNFe>\d{44}<\/chNFe><qExport>50\.0000<\/qExport><\/exportInd><\/detExport><xPed>/);
  assert.match(exp, /<\/infAdic><exporta><UFSaidaPais>SP<\/UFSaidaPais><xLocExporta>ITU<\/xLocExporta><\/exporta><\/infNFe>/);
  const imp = xml("importacao-3551.xml");
  assert.match(imp, /<indTot>1<\/indTot><DI><nDI>2600000010<\/nDI><dDI>2026-01-04<\/dDI>.*<adi><nAdicao>2<\/nAdicao><nSeqAdic>1<\/nSeqAdic><cFabricante>FABRICANTE EXEMPLO<\/cFabricante><\/adi><\/DI><\/prod>/);
  assert.match(imp, /<\/IPI><II><vBC>13381\.92<\/vBC><vDespAdu>0\.00<\/vDespAdu><vII>1686\.12<\/vII><vIOF>0\.00<\/vIOF><\/II><PIS>/);
  assert.match(imp, /<vNF>19191\.50<\/vNF>/, "o total da importação é o informado pela DI");
  assert.match(xml("sucata-1101.xml"), /<ICMS00><orig>0<\/orig><CST>00<\/CST><modBC>3<\/modBC><vBC>17056\.10<\/vBC><pICMS>18\.0000<\/pICMS><vICMS>3070\.10<\/vICMS>/, "ICMS por dentro (art. 392)");
  const ciap = xml("ciap-1604.xml");
  assert.match(ciap, /<ICMS90><orig>0<\/orig><CST>90<\/CST><modBC>3<\/modBC><vBC>0\.00<\/vBC><pICMS>0\.0000<\/pICMS><vICMS>28815\.94<\/vICMS><\/ICMS90>/);
  assert.doesNotMatch(ciap, /<vNFTot>/, "o esquema não aceita vNFTot zero");
  assert.match(xml("conserto-5915.xml"), /<PISOutr><CST>49<\/CST><vBC>0\.00<\/vBC><pPIS>0\.6500<\/pPIS><vPIS>0\.00<\/vPIS><\/PISOutr>/, "remessa sem débito de PIS");
});

test("espelho: arredondamento pela metade para cima sem erro de ponto flutuante", () => {
  const r = espelhar(ler("venda-6101-arredondamento.xml"));
  assert.match(r.xmlNosso, /<vBC>32125\.63<\/vBC>/, "43.750 × 0,7343 = 32.125,625 → 32.125,63");
});

test("comparação: qualquer campo novo ou diferente reprova (o espelho não aceita por padrão)", () => {
  const original = ler("venda-5101-sp.xml");
  const mexida = original.replace(/<vICMS>1179\.23<\/vICMS>/, "<vICMS>1179.33</vICMS>");
  const difs = compararXml(espelhar(original).xmlNosso, mexida);
  assert.ok(difs.some((d) => d.caminho.endsWith("ICMS20/vICMS") && d.deles === "1179.33"));
  assert.ok(DIFERENCAS_ACEITAS.every((r) => r.motivo.length > 20), "toda diferença aceita tem o motivo escrito");
});

test("leitor de XML: atributos, índices de irmãos e entidades", () => {
  const raiz = lerXml(`<?xml version="1.0"?><a x="1"><b>um &amp; dois</b><b>3</b><c/></a>`);
  const m = achatar(raiz);
  assert.equal(m.get("a/@x"), "1");
  assert.equal(m.get("a/b[1]"), "um & dois");
  assert.equal(m.get("a/b[2]"), "3");
  assert.equal(m.get("a/c"), "");
  assert.throws(() => lerXml("<a><b></a>"));
});

test("esquema oficial: as notas refeitas passam no XSD (quando a biblioteca do transmissor está instalada)", async (t) => {
  const lib = new URL("../services/transmissor-nfe/node_modules/nfewizard-io/dist/index.mjs", import.meta.url);
  if (!existsSync(lib)) return t.skip("transmissor sem node_modules: rode npm ci em services/transmissor-nfe");
  for (const nivel of ["error", "warn", "log", "info", "debug"]) { const o = console[nivel].bind(console); console[nivel] = (...a) => { if (typeof a[0] === "string" && a[0].startsWith("[winston]")) return; o(...a); }; }
  const { NFE_SchemaValidate } = await import(lib.href);
  for (const nome of notas) {
    const r = espelhar(ler(nome));
    const xml = r.xmlNosso.replace("</infNFe></NFe>", `</infNFe>${assinaturaDeTreino(r.lida.chave)}</NFe>`);
    const v = await NFE_SchemaValidate(xml, "NFeAutorizacao", { validator: "validateSchemaJsBased" }).catch((e) => e);
    assert.equal(v.success, true, `${nome}: ${(v.errors ?? []).map((e) => e.humanized ?? e.message).join(" | ")}`);
  }
});
