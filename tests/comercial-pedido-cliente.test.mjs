import assert from "node:assert/strict";
import test from "node:test";
import { candidatos, lerPedido, pecaDoCodigo } from "../lib/comercial/pedido-cliente.ts";

// Linhas como o leitor de PDF entrega um pedido de compra real (O-I), só a parte dos itens.
const PEDIDO = `Pedido Compra / Purchase Order
Nr. 4511633686
Condição de Pagamento / Terms and Method of payment:
LÍQUIDO 120 DIAS/
Item | Código do | Descrição / | Quantidade / | Unid. | Preço Unit. | Data de | Valor do Item
10 | 32036689 | BM.563916.08C30Y.CI882 | 2 | TLT | 478.798,95 | 20.02.2025 | 9.575,98
Sch. Line: 0001 | 2 | 20.02.2025 | 00:00:00
por/Per 100 TLT
ICMS Imposto / ICMS Tax | 18,00 % | 924,02
20 | 32036692 | BP.563916.08C300.CI882 | 4 | CDA | 61.559,87 | 20.02.2025 | 2.462,39
por/Per 100 EA
Pedido Compra / Purchase Order
Nr. 4511633686
20 | 32036692 | BP.563916.08C300.CI882 | 4 | CDA | 61.559,87 | 20.02.2025 | 2.462,39
50 | 32036691 | BF.563916.08C300.NI806 | 4 | CDA | 129.959,72 | 20.02.2025 | 5.198,39
por/Per 100 EA
Valor Total / Total net value excl. VAT | BRL | 25.444,74`.split("\n");

test("pedido do cliente: cabeçalho e itens, com o preço por 100 e sem repetir item de outra página", () => {
  const { cabecalho, itens } = lerPedido(PEDIDO);
  assert.equal(cabecalho.numero, "4511633686");
  assert.equal(cabecalho.condicaoPagamento, "LÍQUIDO 120 DIAS");
  assert.deepEqual(itens.map((i) => i.item), ["10", "20", "50"]);
  const a = itens[0];
  assert.equal(a.codigoMaterial, "32036689");
  assert.equal(a.descricao, "BM.563916.08C30Y.CI882");
  assert.equal(a.quantidade, 2);
  assert.equal(a.unidade, "TLT");
  assert.equal(a.precoPor, 100);
  assert.equal(a.precoUnitario, 4787.9895);
  assert.equal(a.entrega, "2025-02-20");
  assert.deepEqual(a.avisos, [], "2 × 4.787,99 = 9.575,98");
});

test("pedido do cliente: avisa quando o valor do item não bate (por 100 faltando)", () => {
  const { itens } = lerPedido(["10 | BM.563916.08C30Y.CI882 | 2 | TLT | 478.798,95 | 20.02.2025 | 9.575,98"]);
  assert.equal(itens.length, 1, "sem a coluna de código de material também lê");
  assert.equal(itens[0].precoPor, 1);
  assert.equal(itens[0].avisos.length, 1);
});

const produtos = [
  { id: "f", codigo: "5-01-00643", descricao: "FORMA POTE PASSATA STD 446ML DC ART. 563916 CI-882", unidade: "PC", tipo_peca: "forma", nome_cliente: null, desenho_codigo: null },
  { id: "ff", codigo: "5-02-00653", descricao: "FUNDO DE FORMA POTE PASSATA STD 446ML DC ART. 563916 CI-882", unidade: "PC", tipo_peca: "fundo_forma", nome_cliente: null, desenho_codigo: null },
  { id: "fb", codigo: "5-04-00588", descricao: "FUNDO DE BLOCO POTE PASSATA STD 446ML DC ART. 563916 NI-806", unidade: "PC", tipo_peca: "fundo_bloco", nome_cliente: null, desenho_codigo: null },
  { id: "b", codigo: "5-03-00649", descricao: "BLOCO POTE PASSATA STD 446ML DC ART. 563916 CI-882", unidade: "PC", tipo_peca: "bloco", nome_cliente: null, desenho_codigo: null },
  { id: "skol", codigo: "5-01-00789", descricao: "FORMA GFA. SKOL BEATS SAFE 330ML ART. 504010", unidade: "PC", tipo_peca: "forma", nome_cliente: "BM.563422.08C50Y.CI882", desenho_codigo: "504010" },
];

test("pedido do cliente: código da peça e candidatos por de-para, artigo, tipo e material", () => {
  assert.deepEqual(pecaDoCodigo("BF.563916.08C300.NI806"), { prefixo: "BF", artigo: "563916", material: "NI-806" });
  const forma = candidatos({ descricao: "BM.563916.08C30Y.CI882", codigoMaterial: "32036689" }, produtos);
  assert.equal(forma[0].produto.id, "f");
  assert.equal(forma[0].motivo, "artigo");
  assert.match(forma[0].explicacao, /artigo 563916, tipo forma \(BM\), material CI-882/);
  assert.equal(candidatos({ descricao: "BF.563916.08C300.NI806", codigoMaterial: null }, produtos)[0].produto.id, "fb");
  // De-para exato vence, mesmo com o artigo do cliente diferente do da Pecsil (563422 → 504010).
  const dp = candidatos({ descricao: "BM.563422.08C50Y.CI882", codigoMaterial: null }, produtos);
  assert.equal(dp.length, 1);
  assert.equal(dp[0].produto.id, "skol");
  assert.equal(dp[0].motivo, "de_para");
  // Sem artigo: pela descrição.
  assert.equal(candidatos({ descricao: "FUNDO DE BLOCO PASSATA", codigoMaterial: null }, produtos)[0].produto.id, "fb");
});

test("pedido do cliente: uso do Clef registrado desligado, só descrição vai ao modelo, de-para não sobrescreve", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../supabase/migrations/202610170011_comercial_pedido_cliente.sql", import.meta.url), "utf8");
  assert.match(sql, /insert into public\.ai_uses \(organization_id, code, label, module_code, feature_code, limit_high, limit_low\)/);
  assert.doesNotMatch(sql, /enabled/, "nasce desligado (o padrão da tabela)");
  assert.match(sql, /return case when upper\(btrim\(atual\)\) = upper\(v_codigo\) then 'ja_ligado' else 'outro_codigo' end;/);
  const rota = readFileSync(new URL("../app/api/comercial/pedido-cliente/route.ts", import.meta.url), "utf8");
  assert.match(rota, /estado: `Peça pedida pelo cliente: \$\{linha\.descricao\}`/, "só a descrição da linha");
  assert.doesNotMatch(rota.slice(rota.indexOf("perguntar("), rota.indexOf("if (r.status")), /precoUnitario|quantidade|cabecalho\.numero\}`[^,]*estado/);
  assert.match(rota, /lista\[0\]\.motivo !== "de_para"/, "com de-para exato o Clef nem é consultado");
});

test("pedido do cliente: cliente pelo CNPJ do cadastro, senão pelo nome escrito no pedido, sem a própria empresa", async () => {
  const { clienteDoPedido } = await import("../lib/comercial/pedido-cliente.ts");
  const linhas = ["OWENS-ILLINOIS DO BRASIL INDÚSTRIA E COMÉRCIO LTDA.", "CNPJ: 08.910.541/0003-20", "PECSIL METALURGICA E FUNDICAO LTDA", "46839106000184"];
  const clientes = [
    { id: "oi-curto", name: "OWENS-ILLINOIS DO BRASIL IND. E COM. LTDA.", tax_id: null },
    { id: "oi", name: "OWENS-ILLINOIS DO BRASIL INDÚSTRIA E COMÉRCIO LTDA.", tax_id: null },
    { id: "pecsil", name: "PECSIL METALURGICA E FUNDICAO LTDA", tax_id: "46839106000184" },
  ];
  assert.deepEqual(clienteDoPedido(linhas, clientes, "46.839.106/0001-84")?.cliente.id, "oi");
  assert.equal(clienteDoPedido(linhas, clientes, "46839106000184")?.motivo, "nome");
  assert.equal(clienteDoPedido(linhas, [...clientes, { id: "oi-cnpj", name: "O-I", tax_id: "08910541000320" }], "46839106000184")?.cliente.id, "oi-cnpj", "CNPJ do cadastro vence o nome");
});
