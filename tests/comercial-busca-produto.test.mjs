import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buscarProdutos, pareceCodigo } from "../lib/comercial/busca-produto.ts";

const P = [
  { id: "a", codigo: "5-01-00339", descricao: "FORMA GFA. CERVEJA 600ML ART. 25TT009 FOFO CI-882", customer_id: "c1" },
  { id: "b", codigo: "5-02-00802", descricao: "FUNDO DE FORMA GFA. CERVEJA 600ML", customer_id: "c2" },
  { id: "c", codigo: "5-01-00500", descricao: "FORMA POTE 300G", customer_id: "c2", desenho_codigo: "PT300-01" },
  { id: "d", codigo: "5-16-00019", descricao: "CABEÇA DE SOPRO SAE 1020", customer_id: "c1" },
];
const ids = (l) => l.map((p) => p.id);

test("primeiros dígitos do código abrem as peças do grupo", () => {
  assert.deepEqual(ids(buscarProdutos(P, "5-01")), ["a", "c"]);
  // Sem os traços também acha (o Rafael digita 50100339).
  assert.deepEqual(ids(buscarProdutos(P, "50100339")), ["a"]);
  // Pedaço do meio do código.
  assert.deepEqual(ids(buscarProdutos(P, "00802")), ["b"]);
});

test("descrição por palavras, sem acento e em qualquer ordem", () => {
  assert.deepEqual(ids(buscarProdutos(P, "cerveja forma")), ["a", "b"]);
  assert.deepEqual(ids(buscarProdutos(P, "cabeca")), ["d"]);
  assert.deepEqual(ids(buscarProdutos(P, "pt300")), ["c"]); // pelo desenho
  assert.deepEqual(ids(buscarProdutos(P, "inexistente")), []);
});

test("código que começa com o digitado vem antes; peças do cliente do orçamento sobem", () => {
  // Descrição que começa com "forma" antes de "fundo de forma".
  assert.deepEqual(ids(buscarProdutos(P, "forma")), ["a", "c", "b"]);
  assert.deepEqual(ids(buscarProdutos(P, "forma", { clienteId: "c2" })), ["c", "a", "b"]);
  assert.deepEqual(ids(buscarProdutos(P, "5-01", { clienteId: "c2" })), ["c", "a"]);
  assert.deepEqual(ids(buscarProdutos(P, "", { clienteId: "c1" })), ["a", "d", "c", "b"]);
  assert.equal(buscarProdutos(P, "", { limite: 2 }).length, 2);
});

test("texto com cara de código vai para o campo código do cadastro", () => {
  assert.equal(pareceCodigo("5-01-00339"), true);
  assert.equal(pareceCodigo("5-24-"), true);
  assert.equal(pareceCodigo("ANEL CERVEJA"), false);
  assert.equal(pareceCodigo("ART. 25TT009"), false);
});

test("orçamento usa a busca e o cadastro de produto no lugar da datalist", () => {
  const src = readFileSync(new URL("../modules/comercial/src/vendas/Orcamentos.tsx", import.meta.url), "utf8");
  assert.ok(!src.includes("vnd-lista-produtos"), "a datalist só aceitava o rótulo exato");
  assert.ok(src.includes("<BuscaProduto") && src.includes("<ProdutoModal"));
});

test("sincronização da Forja manda os artigos para o cadastro de produtos", () => {
  const src = readFileSync(new URL("../lib/forja/sync-orders.ts", import.meta.url), "utf8");
  assert.ok(src.includes('"/api/artigos"') && src.includes('"comercial_produtos_do_forja"'));
  const sql = readFileSync(new URL("../supabase/migrations/202610150003_produtos_do_forja.sql", import.meta.url), "utf8");
  // Só cria o que falta: nunca sobrescreve a descrição/NCM editados aqui.
  assert.ok(/revoke all on function public\.comercial_produtos_do_forja\(uuid, jsonb\) from public, anon, authenticated/.test(sql));
  assert.ok(!/update public\.products set (descricao|ncm|unidade)/.test(sql));
});

test("produtos: a API lê o catálogo da Forja em páginas (nada de corte em 1000)", () => {
  const src = readFileSync(new URL("../app/api/comercial/produtos/route.ts", import.meta.url), "utf8");
  assert.ok(!/from\("products"\)[^;]*\.limit\(/.test(src) && src.includes(".range(de, de + POR_PAGINA - 1)"));
});

test("Fiscal abre o orçamento pelo A faturar e baixa os anexos pelo orçamento", () => {
  const af = readFileSync(new URL("../modules/fiscal/src/AFaturar.tsx", import.meta.url), "utf8");
  assert.ok(af.includes("<EditorOrcamento") && af.includes("Abrir orçamento"));
  const anexos = readFileSync(new URL("../app/api/comercial/orcamentos/[id]/anexos/route.ts", import.meta.url), "utf8");
  // Quem vê o orçamento (inclusive fiscal.nfe) baixa; a sessão confere o anexo antes da chave de serviço.
  assert.ok(/export async function GET[\s\S]*requireAnyFeature\(\["comercial\.orcamentos", "producao\.entrada", "fiscal\.nfe"\], "ver"\)[\s\S]*\.eq\("quote_id", id\)[\s\S]*createSupabaseAdminClient/.test(anexos));
  // Anexar e tirar continuam só para quem opera orçamentos.
  assert.equal((anexos.match(/requireFeature\("comercial\.orcamentos", "operar"\)/g) ?? []).length, 2);
});
