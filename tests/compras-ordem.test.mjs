import assert from "node:assert/strict";
import test from "node:test";
import { OrdemIndisponivel, despesasDoPedido, itensDaOrdem, montarOrdemCompra } from "../lib/compras/ordem-compra.ts";

const cab = (extra = {}) => ({
  id: 191, status: "APROVADO", fornecedor: "MIRAI METALS & MINERALS LTDA", aprovadoPor: "Ricardo", dataDecisao: "2026-10-02T13:00:00Z",
  freteTipo: "CIF", freteValor: 0, seguroValor: 0, outrasDespesas: 0, prazoEntrega: "2026-10-06", observacao: null, ...extra,
});
const item = (produto, quantidade, valorUnit, extra = {}) => ({ produto, quantidade, unidade: "kg", valorUnit, icms: 0, ipi: 3.25, prazo: "60 DDL", status: "APROVADO", ...extra });
const fornecedor = { nome: "MIRAI METALS & MINERALS LTDA", cnpj: "21583926000127", ie: "083077430", contato: null, telefone: "11 86340307", email: null, endereco: "RODOVIA GOVERNADOR MARIO COVAS, 10600", cidade: "CARIACICA", uf: "ES", cep: "29147030", prazoPagamento: "30 DDL" };
// Os três itens da Ordem de Compra nº 14805 (modelo do sistema antigo).
const modelo = [item("FERRO MOLIBDÊNIO (60/65%) 10/60 MM", 150, 244.74), item("FERRO TITÂNIO (30/35%) 2/10 MM", 200, 31), item("FERRO VANÁDIO 50% 10/20 MM", 30, 137)];

test("OC: totais iguais ao modelo 14805 (itens 47.021,00 + IPI 1.528,18 = 48.549,18)", () => {
  const oc = montarOrdemCompra(cab(), modelo, fornecedor, null);
  assert.equal(oc.numero, 191);
  assert.deepEqual(oc.itens.map((l) => l.total), [36711, 6200, 4110]);
  assert.deepEqual(oc.totais, { itens: 47021, frete: 0, seguro: 0, outras: 0, icms: 0, ipi: 1528.18, pedido: 48549.18 });
  assert.equal(oc.formaPagamento, "60 DDL");
  assert.equal(oc.frete.texto, "0-Contratação do Frete por Conta do Remetente (CIF)");
  assert.equal(oc.solicitante, "COMPRAS");
  assert.equal(oc.parcial, false);
  assert.deepEqual(oc.avisos, []);
});

test("OC: item rejeitado ou pendente fica de fora e a OC é marcada parcial", () => {
  const itens = [modelo[0], { ...modelo[1], status: "REJEITADO" }, { ...modelo[2], status: "PENDENTE" }];
  const oc = montarOrdemCompra(cab({ status: "PENDENTE" }), itens, fornecedor, "Henrique");
  assert.deepEqual(oc.itens.map((l) => [l.item, l.descricao]), [[1, "FERRO MOLIBDÊNIO (60/65%) 10/60 MM"]]);
  assert.equal(oc.parcial, true);
  assert.equal(oc.solicitante, "Henrique");
});

test("OC: frete, seguro e outras despesas somam no total; ICMS é só informativo", () => {
  const oc = montarOrdemCompra(cab({ freteTipo: "FOB", freteValor: 350, seguroValor: 20.5, outrasDespesas: 9.5 }), [item("CHAPA", 10, 100, { icms: 12, ipi: 0 })], fornecedor, null);
  assert.deepEqual(oc.totais, { itens: 1000, frete: 350, seguro: 20.5, outras: 9.5, icms: 120, ipi: 0, pedido: 1380 });
  assert.equal(oc.frete.tipo, "FOB");
  assert.equal(despesasDoPedido({ freteValor: 350, seguroValor: 20.5, outrasDespesas: 9.5 }), 380);
});

test("OC: forma de pagamento junta os prazos dos itens; sem prazo, usa o do cadastro", () => {
  const dois = montarOrdemCompra(cab(), [item("A", 1, 10), item("B", 1, 10, { prazo: "28/56 DDL" }), item("C", 1, 10)], fornecedor, null);
  assert.equal(dois.formaPagamento, "60 DDL / 28/56 DDL");
  const semPrazo = montarOrdemCompra(cab(), [item("A", 1, 10, { prazo: " " })], fornecedor, null);
  assert.equal(semPrazo.formaPagamento, "30 DDL");
});

test("OC: sem item aprovado não sai; cotação antiga sem status por item leva todos", () => {
  assert.throws(() => montarOrdemCompra(cab({ status: "PENDENTE" }), modelo.map((i) => ({ ...i, status: "PENDENTE" })), fornecedor, null), OrdemIndisponivel);
  assert.throws(() => montarOrdemCompra(cab({ status: "REJEITADO" }), modelo.map((i) => ({ ...i, status: null })), fornecedor, null), OrdemIndisponivel);
  assert.equal(itensDaOrdem({ status: "COMPRADO" }, modelo.map((i) => ({ ...i, status: null }))).length, 3);
});

test("OC: avisa quando o cadastro do fornecedor está incompleto", () => {
  const oc = montarOrdemCompra(cab(), modelo, { ...fornecedor, cnpj: null, endereco: null }, null);
  assert.deepEqual(oc.avisos, ["O fornecedor está sem CNPJ no cadastro.", "O fornecedor está sem endereço completo no cadastro."]);
});
