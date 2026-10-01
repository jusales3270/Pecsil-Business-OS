import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NfeInvalida, lerNfe } from "../lib/almoxarifado/nfe-xml.ts";

const xml = readFileSync(new URL("./fixtures/nfe-ficticia.xml", import.meta.url), "utf8");

test("lê chave, número, série, emissão e emitente", () => {
  const nfe = lerNfe(xml);
  assert.equal(nfe.chave, "35261011222333000181550010000123451000012345");
  assert.equal(nfe.numero, "12345");
  assert.equal(nfe.serie, "1");
  assert.equal(nfe.emissao, "2026-09-28");
  assert.equal(nfe.emitente.cnpj, "11222333000181");
  assert.equal(nfe.emitente.nome, "FERRAMENTAS EXEMPLO & CIA LTDA");
  assert.equal(nfe.emitente.fantasia, "FERRAMENTAS EXEMPLO");
  assert.equal(nfe.emitente.uf, "SP");
});

test("lê os totais do ICMS e o valor da nota", () => {
  const nfe = lerNfe(xml);
  assert.equal(nfe.valorProdutos, 222.5);
  assert.equal(nfe.valorNota, 233.63);
  assert.equal(nfe.baseIcms, 222.5);
  assert.equal(nfe.icms, 40.05);
  assert.equal(nfe.ipi, 11.13);
});

test("lê os itens com quantidade e unidade", () => {
  const { itens } = lerNfe(xml);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens[0], { numero: 1, codigo: "BR10", descricao: "BROCA HSS 10MM", cfop: "5102", unidade: "UN", quantidade: 5, valorUnitario: 12.5, valorTotal: 62.5 });
  assert.equal(itens[1].numero, 2);
  assert.equal(itens[1].unidade, "L");
});

test("as duplicatas viram os vencimentos e somam a nota", () => {
  const { duplicatas, valorNota } = lerNfe(xml);
  assert.deepEqual(duplicatas.map((d) => d.vencimento), ["2026-10-28", "2026-11-27"]);
  assert.equal(Math.round(duplicatas.reduce((a, d) => a + d.valor, 0) * 100) / 100, valorNota);
});

test("nota sem cobrança (à vista) vem sem duplicatas", () => {
  const semCobr = xml.replace(/<cobr>[\s\S]*<\/cobr>/, "");
  assert.deepEqual(lerNfe(semCobr).duplicatas, []);
});

test("aceita prefixo de namespace e a chave só no protocolo", () => {
  const prefixado = xml.replace(/<(\/?)(\w+)([\s>])/g, (m, barra, tag, fim) => (tag === "nfeProc" ? m : `<${barra}nfe:${tag}${fim}`)).replace(' Id="NFe35261011222333000181550010000123451000012345"', "");
  const nfe = lerNfe(prefixado);
  assert.equal(nfe.chave, "35261011222333000181550010000123451000012345");
  assert.equal(nfe.itens.length, 2);
});

test("arquivo que não é NF-e é recusado com mensagem clara", () => {
  assert.throws(() => lerNfe("<html><body>oi</body></html>"), NfeInvalida);
  assert.throws(() => lerNfe(xml.replace(/NFe3526\d+/, "NFe123").replace(/<chNFe>\d+<\/chNFe>/, "")), /chave de acesso/);
});
