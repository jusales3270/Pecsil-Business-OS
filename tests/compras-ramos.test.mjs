import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estadoDosItens, numeroBr, podeEncaminhar } from "../lib/compras/ramos.ts";

const sql = readFileSync(new URL("../supabase/migrations/202610200004_compras_ramos_compra_imediata.sql", import.meta.url), "utf8");
const store = readFileSync(new URL("../modules/compras/src/store/index.ts", import.meta.url), "utf8");
const modal = readFileSync(new URL("../modules/compras/src/components/PedidoModal.tsx", import.meta.url), "utf8");

test("ramos: cada item segue o que aconteceu com ele, como no banco", () => {
  const itens = ["a", "b", "c", "d"];
  const cotacoes = [
    { id: 1, status: "COMPRADO", produtos: [{ produto: "A", status: "APROVADO", pedidoItemId: "a" }] },
    { id: 2, status: "APROVADO", produtos: [{ produto: "B", status: "APROVADO", pedidoItemId: "b" }, { produto: "C", status: "REJEITADO", pedidoItemId: "c" }] },
  ];
  const e = estadoDosItens(itens, cotacoes, [], []);
  assert.deepEqual(e, { a: "comprado", b: "aprovado", c: "rejeitado", d: "aberto" });
  // Aguardando preço com outro fornecedor: o item volta a estar em cotação.
  assert.equal(estadoDosItens(itens, cotacoes, [], [{ id: "r", situacao: "aguardando", cotacaoId: null, itens: ["c", "d"] }]).d, "em_cotacao");
  // Cotação do ramo recém-criada, ainda sem itens gravados: segue em cotação (sem piscar "aberto").
  assert.equal(estadoDosItens(["d"], [{ id: 3, status: "PENDENTE", produtos: [] }], [], [{ id: "r", situacao: "cotado", cotacaoId: 3, itens: ["d"] }]).d, "em_cotacao");
  // Compra registrada de um item aprovado, antes de a OC inteira virar "comprada".
  assert.equal(estadoDosItens(["b"], cotacoes, [{ cotacaoId: 2, produto: "B" }], []).b, "comprado");
  // Cotação apagada não conta.
  assert.equal(estadoDosItens(["a"], [{ ...cotacoes[0], deletedAt: "2026-10-20" }], [], []).a, "aberto");
  assert.equal(podeEncaminhar("comprado"), false);
  assert.equal(podeEncaminhar("rejeitado"), true);
});

test("ramos: número digitado em português", () => {
  assert.equal(numeroBr("1.234,50"), 1234.5);
  assert.equal(numeroBr("80"), 80);
  assert.ok(Number.isNaN(numeroBr("")));
  assert.ok(Number.isNaN(numeroBr("abc")));
});

test("ramos no banco: só pelas funções, item só do próprio pedido, sem avisos de passagem", () => {
  assert.match(sql, /revoke insert, update, delete on public\.compras_ramos, public\.compras_ramo_itens from anon, authenticated/);
  assert.match(sql, /raise exception 'O item não é do pedido desta cotação\.'/);
  assert.match(sql, /Escolha o fornecedor no cadastro/);
  assert.match(sql, /current_setting\('pecsil\.adiar_pedido', true\) = 'on'/, "a compra imediata recalcula o pedido uma vez só");
  assert.match(sql, /create trigger cotacoes_ramo after insert/, "o ramo aponta para a cotação depois que ela existe");
  assert.match(sql, /before update of status on public\.material_requests/, "receber uma OC não fecha o pedido com item faltando");
});

test("compra imediata: autorizador da lista de quem aprova, registrado e avisado", () => {
  assert.match(sql, /g\.feature_code = 'compras\.aprovacoes' and g\.level >= 'aprovar'/);
  assert.match(sql, /Escolha quem autorizou a compra imediata\./);
  assert.match(sql, /autorizado_por_id', new\.autorizado_por_id/, "o evento leva quem autorizou pelo id");
  assert.match(sql, /Compra autorizada por você · OC nº %s/);
  assert.match(sql, /'id', p\.id, 'nome', p\.full_name/, "a lista de autorizadores só traz id e nome");
  assert.match(modal, /compras\/autorizadores/);
  assert.doesNotMatch(modal, /Domingo|Ricardo/, "os nomes vêm do cadastro de permissões, não do código");
});

test("ramos na tela: o item cotado leva o vínculo com o item do pedido", () => {
  assert.match(store, /material_request_item_id: p\.pedidoItemId \?\? null/);
  assert.match(store, /ramo_id: data\.ramoId \?\? null/);
});
