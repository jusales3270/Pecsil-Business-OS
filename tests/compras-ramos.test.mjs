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

test("preço lançado na plataforma cancela o link de cotação aberto do mesmo fornecedor no pedido", () => {
  const m = readFileSync(new URL("../supabase/migrations/202610200005_compras_convite_cancela_manual.sql", import.meta.url), "utf8");
  assert.match(m, /create trigger cotacoes_cancela_convites after insert on public\.cotacoes/);
  assert.match(m, /new\.ramo_id is not null and cv\.ramo_id = new\.ramo_id/, "o link do próprio ramo");
  assert.match(m, /cv\.ramo_id is null and \(\(new\.supplier_id is not null and cv\.supplier_id = new\.supplier_id\)/, "o link do pedido inteiro com o mesmo fornecedor");
  assert.match(m, /cv\.situacao = 'aberto'/, "só o que ainda está aberto (o respondido fica)");
});

test("resposta pelo link: sem aviso no sino, aparece no card do pedido", () => {
  const m = readFileSync(new URL("../supabase/migrations/202610200006_compras_resposta_sem_sino.sql", import.meta.url), "utf8");
  assert.match(m, /create or replace function public\.compras_convite_responder\(/);
  assert.doesNotMatch(m, /notify_feature|notify_profile/, "a resposta não vai para o sino");
  assert.match(m, /grant execute on function public\.compras_convite_responder\([^)]*\) to service_role;/);
  const pagina = readFileSync(new URL("../modules/compras/src/pages/SolicitacoesPage.tsx", import.meta.url), "utf8");
  assert.match(pagina, /respondeu pelo link<\/b>/);
});

test("metro cúbico (gás) nas unidades do pedido, do recebimento e da cotação", () => {
  const almox = readFileSync(new URL("../modules/almoxarifado/src/tipos.tsx", import.meta.url), "utf8");
  const cot = readFileSync(new URL("../modules/compras/src/components/CotacaoModal.tsx", import.meta.url), "utf8");
  assert.match(almox, /export const UNIDADES = \[[^\]]*"M³"/);
  assert.match(cot, /const UNIDADES = \[[^\]]*'m³'/);
});
