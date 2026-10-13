import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { normalizarProduto, normalizarOrcamento, totalOrcamento } = await import("../lib/comercial/vendas.ts");
const { notaDoOrcamento, destinatarioDoCliente } = await import("../lib/fiscal/emissao/do-orcamento.ts");
const { gerarXmlNfe } = await import("../lib/fiscal/emissao/xml.ts");
const { normalizarNota } = await import("../lib/fiscal/emissao/normalizar.ts");

const ler = (c) => readFileSync(new URL(c, import.meta.url), "utf8");
const sqlOrc = ler("../supabase/migrations/202610130005_comercial_orcamentos.sql");
const sqlFat = ler("../supabase/migrations/202610130006_faturamento_orcamento.sql");
const UUID = "11111111-2222-3333-4444-555555555555";

test("produto: código, NCM e unidade normalizados; erros para quem preenche", () => {
  const { produto, erros } = normalizarProduto({ codigo: "5-24-00040", descricao: "anel gfa. cerveja", ncm: "8480.50.00", unidade: "pç", peso_liquido: "1,250", tipo_peca: "molde", origem: "0" });
  assert.deepEqual(erros, ["Unidade: até 6 letras ou números (ex.: PC, CJ, KG)."]);
  assert.equal(produto.ncm, "84805000");
  assert.equal(produto.descricao, "ANEL GFA. CERVEJA");
  assert.equal(produto.peso_liquido, 1.25);
  const ok = normalizarProduto({ descricao: "x", ncm: "123", tipo_peca: "inventado" });
  assert.ok(ok.erros.includes("O NCM tem 8 dígitos."));
  assert.equal(ok.produto.tipo_peca, null);
  assert.equal(ok.produto.codigo, null, "sem código: o grupo gera");
});

test("orçamento: cliente obrigatório, itens com quantidade e preço em formato brasileiro", () => {
  const { orcamento, erros } = normalizarOrcamento({
    customer_id: UUID, pedido_cliente: " 4502385803 ", frete_modalidade: "7",
    itens: [{ product_id: UUID, descricao: "anel", quantidade: "1.200", preco_unitario: "120,50", item_pedido: "060" }, { descricao: "", quantidade: "0" }],
  });
  assert.equal(orcamento.pedido_cliente, "4502385803");
  assert.equal(orcamento.frete_modalidade, 9);
  assert.equal(orcamento.itens[0].quantidade, 1200);
  assert.equal(orcamento.itens[0].preco_unitario, 120.5);
  assert.ok(erros.some((e) => e.startsWith("Item 2: escolha o produto")));
  assert.ok(erros.some((e) => e.startsWith("Item 2: quantidade")));
  assert.ok(normalizarOrcamento({}).erros.includes("Escolha o cliente."));
  assert.equal(totalOrcamento([{ quantidade: "238", preco_unitario: "120" }, { quantidade: 10, preco_unitario: 50 }]), 29060);
});

const CLIENTE = { name: "AMBEV S.A.", tax_id: "07526557000100", ie: "123456789012", ind_ie: 1, email_nfe: "nf@ambev.exemplo", cep: "13300000", logradouro: "RUA X", numero: "1", complemento: null, bairro: "CENTRO", municipio: "JACAREI", codigo_municipio: "3524402", uf: "SP", telefone: null };
const LINHA = { item_id: UUID, numero: 3196, pedido_cliente: "4502385803", descricao: "ANEL GFA. CERVEJA 600ML", preco_unitario: 120, item_pedido: "060" };
const PRODUTO = { codigo: "5-24-00040", ncm: "84805000", unidade: "PC", origem: 0 };

test("nota do orçamento: destinatário do cadastro, CFOP pela UF, pedido e item do cliente em cada item", () => {
  const dentro = notaDoOrcamento({ cliente: CLIENTE, linhas: [{ linha: LINHA, quantidade: 80, produto: PRODUTO }], ufEmitente: "SP", crt: 3 });
  assert.equal(dentro.destinatario.documento, "07526557000100");
  assert.equal(dentro.itens[0].cfop, "5101");
  assert.equal(dentro.itens[0].codigo, "5-24-00040");
  assert.equal(dentro.itens[0].ncm, "84805000");
  assert.equal(dentro.itens[0].quantidade, 80);
  assert.equal(dentro.itens[0].valorUnitario, 120);
  assert.equal(dentro.itens[0].itemOrcamento, UUID);
  assert.equal(dentro.itens[0].pedidoCompra, "4502385803");
  assert.equal(dentro.itens[0].itemPedido, "060");
  assert.match(dentro.infoComplementar, /Orçamento #3196 · Pedido de compra 4502385803/);
  const fora = notaDoOrcamento({ cliente: { ...CLIENTE, uf: "RJ" }, linhas: [{ linha: LINHA, quantidade: 1, produto: PRODUTO }], ufEmitente: "SP", crt: 3 });
  assert.equal(fora.itens[0].cfop, "6101");
  assert.equal(destinatarioDoCliente({ ...CLIENTE, ind_ie: 9 }).indIE, 9);
  // A marca do orçamento sobrevive à normalização (vai e volta da tela).
  assert.equal(normalizarNota(dentro).itens[0].itemOrcamento, UUID);
  assert.equal(normalizarNota({ ...dentro, itens: [{ ...dentro.itens[0], itemOrcamento: "x" }] }).itens[0].itemOrcamento, undefined);
});

test("XML: xPed e nItemPed no produto (ordem do esquema) e o texto do pedido em infAdProd", () => {
  const nota = notaDoOrcamento({ cliente: CLIENTE, linhas: [{ linha: LINHA, quantidade: 80, produto: PRODUTO }], ufEmitente: "SP", crt: 3 });
  const emitente = { cnpj: "11222333000181", razaoSocial: "EMPRESA EXEMPLO LTDA", fantasia: null, ie: "123456789012", im: null, cnae: null, crt: 3, logradouro: "RUA UM", numero: "1", complemento: null, bairro: "CENTRO", codigoMunicipio: "3523909", municipio: "ITU", uf: "SP", cep: "13300000", telefone: null };
  const { xml } = gerarXmlNfe({ nota, emitente, serie: 1, numero: 9, emissao: new Date("2026-10-13T15:00:00Z"), codigoNumerico: "12345678", tpAmb: 2 });
  assert.match(xml, /<indTot>1<\/indTot><xPed>4502385803<\/xPed><nItemPed>060<\/nItemPed><\/prod>/);
  assert.match(xml, /<\/imposto><infAdProd>Nº Pedido: 4502385803 Nº Pedido Item: 060<\/infAdProd><\/det>/);
  const longo = notaDoOrcamento({ cliente: CLIENTE, linhas: [{ linha: { ...LINHA, pedido_cliente: "PEDIDO-MUITO-LONGO-123", item_pedido: "A1" }, quantidade: 1, produto: PRODUTO }], ufEmitente: "SP", crt: 3 });
  const x2 = gerarXmlNfe({ nota: longo, emitente, serie: 1, numero: 10, emissao: new Date(), codigoNumerico: "12345679", tpAmb: 2 }).xml;
  assert.doesNotMatch(x2, /<xPed>/, "xPed tem no máximo 15 caracteres: fica só no texto");
  assert.match(x2, /<infAdProd>Nº Pedido: PEDIDO-MUITO-LONGO-123 Nº Pedido Item: A1<\/infAdProd>/);
});

test("migração dos orçamentos: ganho exige pedido e anexos; situação e entrada só pelas funções", () => {
  for (const t of ["product_groups", "products", "sales_quotes", "sales_quote_items", "sales_quote_notes", "sales_quote_attachments", "production_entries"]) {
    assert.match(sqlOrc, new RegExp(`alter table public\\.${t} enable row level security`));
  }
  assert.match(sqlOrc, /o nº do pedido de compra do cliente/);
  assert.match(sqlOrc, /tipo = 'pedido'\) then faltam/);
  assert.match(sqlOrc, /tipo = 'cotacao'\) then faltam/);
  assert.match(sqlOrc, /revoke insert, update, delete on public\.production_entries, public\.sales_quote_numbering from anon, authenticated/);
  assert.match(sqlOrc, /A situação do orçamento muda pelos botões/);
  assert.match(sqlOrc, /Passa do pedido/);
  assert.match(sqlOrc, /is_forecast[\s\S]*'comercial', q\.id, true/, "ganho gera previsão a receber");
  assert.match(sqlOrc, /perform set_config\('pecsil\.orcamento_situacao', 'off', true\)/, "a liberação não vaza para o resto da transação");
});

test("migração do faturamento: teto do pedido e do produzido, linhas travadas, cancelada devolve, só o servidor define", () => {
  assert.match(sqlFat, /n\.situacao <> 'cancelada'/);
  assert.match(sqlFat, /order by id for update/);
  assert.match(sqlFat, /passa do pedido/);
  assert.match(sqlFat, /produzidas e % já faturadas/);
  assert.match(sqlFat, /revoke all on function public\.fiscal_nfe_origens_definir\(uuid, uuid, jsonb\) from public, anon, authenticated/);
  assert.match(sqlFat, /grant execute on function public\.fiscal_nfe_origens_definir\(uuid, uuid, jsonb\) to service_role/);
  assert.match(sqlFat, /revoke insert, update, delete on public\.fiscal_nfe_origens from anon, authenticated/);
  const rota = ler("../app/api/fiscal/faturar/route.ts");
  assert.match(rota, /ambienteLiberado\(ambiente\)/, "faturar só no ambiente liberado (treino)");
  assert.match(rota, /Uma nota é de um cliente só/);
});

const { lerNumeroBr } = await import("../lib/numero-br.ts");
test("número brasileiro: ponto de milhar, vírgula decimal e ponto decimal sozinho", () => {
  assert.equal(lerNumeroBr("1.200"), 1200);
  assert.equal(lerNumeroBr("1.000.000"), 1000000);
  assert.equal(lerNumeroBr("1.234,56"), 1234.56);
  assert.equal(lerNumeroBr("120,5"), 120.5);
  assert.equal(lerNumeroBr("120.5"), 120.5);
  assert.equal(lerNumeroBr("1.65"), 1.65);
  assert.equal(lerNumeroBr("R$ 2.350,00"), 2350);
  assert.equal(lerNumeroBr(""), 0);
  assert.ok(Number.isNaN(lerNumeroBr("abc", NaN)));
});
