import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/202610160003_faturamento_teto_pedido.sql", import.meta.url), "utf8");
const corpo = (nome) => sql.slice(sql.indexOf(`function public.${nome}`), sql.indexOf("$$;", sql.indexOf(`function public.${nome}`)));

test("teto só no pedido: a nota não depende mais da entrada de produção (decisão de 16/10)", () => {
  const origens = corpo("fiscal_nfe_origens_definir");
  assert.ok(origens.includes("passa do pedido. Pedido %, já faturado %, cabem %."));
  assert.ok(!/produzid/.test(origens), "não pode haver trava pelo produzido");
  // Disponível = o que falta do pedido.
  assert.ok(corpo("fiscal_a_faturar").includes("i_qtd, prod, fat, greatest(i_qtd - fat, 0), greatest(i_qtd - fat, 0)"));
  assert.ok(!/já foram faturadas/.test(corpo("producao_entrada_estornar")));
});

test("notas do orçamento trazem preço praticado, valor da nota e DANFE; DANFE pelo orçamento confere a ligação", () => {
  assert.ok(corpo("comercial_orcamento_notas").includes("it ->> 'itemOrcamento' = o.quote_item_id::text"));
  const rota = readFileSync(new URL("../app/api/comercial/orcamentos/[id]/notas-fiscais/[nfe]/danfe/route.ts", import.meta.url), "utf8");
  assert.ok(/rpc\("comercial_orcamento_notas"[\s\S]*some\(\(n\) => n\.nfe_id === nfe\)[\s\S]*createSupabaseAdminClient/.test(rota));
});

test("A faturar: o campo da quantidade abre ao clicar, mostra o saldo e avisa quando passa do pedido", () => {
  const tela = readFileSync(new URL("../modules/fiscal/src/AFaturar.tsx", import.meta.url), "utf8");
  assert.ok(tela.includes("Escolher quantidade") && tela.includes("Saldo depois:") && tela.includes("Passa do pedido: cabem"));
  assert.ok(!tela.includes("sem produção"));
});
