import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { achados, cnpjValido, algumAchado } = await import("../lib/ligacoes/achados.ts");

test("ligações: CNPJ só com dígito verificador certo, formatado ou não", () => {
  assert.equal(cnpjValido("11.222.333/0001-81"), true);
  assert.equal(cnpjValido("11222333000181"), true);
  assert.equal(cnpjValido("11.222.333/0001-82"), false);
  assert.equal(cnpjValido("11.111.111/1111-11"), false);
  const a = achados("Emitente CNPJ 11.222.333/0001-81 · Destinatário 46839106000184 · errado 11.222.333/0001-82");
  assert.deepEqual(a.cnpjs, ["11222333000181", "46839106000184"]);
});

test("ligações: a chave de acesso não vira CNPJ nem número solto", () => {
  const a = achados("CHAVE DE ACESSO\n3526 0911 2223 3300 0181 5500 1000\n0123 4510 0001 2349");
  assert.deepEqual(a.chaves, ["35260911222333000181550010000123451000012349"]);
  assert.deepEqual(a.cnpjs, []);
  assert.deepEqual(a.nfs, []);
});

test("ligações: NF só com prefixo, sem zeros à esquerda", () => {
  assert.deepEqual(achados("NOTA FISCAL Nº 004567").nfs, ["4567"]);
  assert.deepEqual(achados("NF-e nº 000.002.045").nfs, ["2045"]);
  assert.deepEqual(achados("NF 30719 e Nota Fiscal Eletrônica 1238").nfs, ["30719", "1238"]);
  assert.deepEqual(achados("Total 004567 itens").nfs, []);
});

test("ligações: cotação/OC e OS só com prefixo; \"os\" minúsculo é artigo", () => {
  const a = achados("Ref. Ordem de Compra nº 234, OC 235, cotação 236 e pedido de compra nº 237. OS 12676, O.S. 12677, ordem de serviço 12678; os 12345 itens; oc 99");
  assert.deepEqual(a.cotacoes.sort((x, y) => x - y), [234, 235, 236, 237]);
  assert.deepEqual(a.os.sort(), ["12676", "12677", "12678"]);
  assert.deepEqual(achados("Total 234 · 12676").cotacoes, []);
  assert.equal(algumAchado(achados("Reunião de alinhamento")), false);
});
