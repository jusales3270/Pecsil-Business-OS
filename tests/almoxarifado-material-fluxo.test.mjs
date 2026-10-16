import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { itensDoPedido, pedidoParaTela } from "../lib/almoxarifado/pedidos.ts";

// A-01 (PLANO-ALMOXARIFADO M2): o material do catálogo corre da solicitação à nota; texto livre
// continua valendo e o recebimento nunca trava por falta de material.
test("solicitação leva o material escolhido e aceita texto livre", () => {
  const r = itensDoPedido([
    { produto: "RESINA COMIL", quantidade: 2, unidade: "KG", material_id: "6a0f8411-1111-4222-8333-444455556666" },
    { produto: "broca qualquer", quantidade: 1, material_id: "não-é-uuid" },
    { produto: "  ", quantidade: 1 },
  ]);
  assert.ok("itens" in r);
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].material_id, "6a0f8411-1111-4222-8333-444455556666");
  assert.equal(r.itens[1].material_id, null, "id inválido vira texto livre");
});

test("pedido mostra o material ligado (objeto ou lista, como o banco devolver)", () => {
  const base = { id: "p", numero: 7, divisao: "USINAGEM", origem: null, urgencia: "normal", observacao: null, status: "aberta", requested_by_name: null, cancel_reason: null, created_at: "", updated_at: "" };
  const tela = pedidoParaTela({ ...base, material_request_items: [
    { produto: "A", quantidade: 1, unidade: "UN", observacao: null, ordem: 2, material_id: null, materials: null },
    { produto: "B", quantidade: 1, unidade: "KG", observacao: null, ordem: 1, material_id: "m1", materials: [{ codigo: "2-06-00005", descricao: "FERRO TITÂNIO", unidade: "KG" }] },
  ] });
  assert.equal(tela.itens[0].material?.codigo, "2-06-00005");
  assert.equal(tela.itens[1].material, null);
});

test("recebimento: de-para aprende e nunca trava por falta de material", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610170001_material_no_fluxo_compra.sql", import.meta.url), "utf8");
  assert.match(sql, /on conflict \(organization_id, cnpj, codigo_fornecedor\) do update/);
  assert.match(sql, /if mat is null and cod is not null and cnpj_nota is not null then/);
  assert.doesNotMatch(sql, /raise exception '[^']*sem material/i, "item sem material não pode travar o recebimento");
  assert.doesNotMatch(sql, /clef|modelo de decis/i, "sugestão do histórico é por regra, sem IA");
});
