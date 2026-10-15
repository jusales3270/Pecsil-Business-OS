import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { montarRascunhoOS, prazoParaForja, proximaTentativa } from "../lib/forja/envio-os-core.ts";

const FORJA_ARTIGO = "2b1e5f4a-9c1d-4e7a-8b2c-1d2e3f4a5b6c";
const envio = (x = {}) => ({
  id: "e1", organization_id: "o", ref: "11111111-2222-3333-4444-555555555555", status: "pendente", tentativas: 0, forja_os_id: null, quote_item_id: "11111111-2222-3333-4444-555555555555",
  quote: { numero: 212, situacao: "ganho", treino: false, pedido_cliente: " 4502385803 ", prazo_entrega: "2026-11-30", observacoes: "Entrega parcial aceita", customer_id: "c1", cliente: { name: "OI-SP" } },
  item: { ordem: 2, descricao: "FORMA GFA. SKOL 330ML", desenho: "DES-1 rev. B", quantidade: "50", preco_unitario: "1550.00", prazo_entrega: null, item_pedido: "010", observacao: null,
    produto: { codigo: "5-01-00789", descricao: "FORMA GFA. SKOL 330ML ART. 504010", tipo_peca: "forma", material: "FOFO", forja_artigo_id: FORJA_ARTIGO } },
  ...x,
});

test("rascunho de OS: tudo o que o Rafael montou no orçamento vai para a Forja", () => {
  const r = montarRascunhoOS(envio(), "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
  assert.ok("payload" in r);
  const p = r.payload;
  assert.equal(p.refExterna, "11111111-2222-3333-4444-555555555555");
  assert.equal(p.codigoProvisorio, "ORC-212/2");
  assert.equal(p.cliente.forjaId, "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d");
  assert.equal(p.artigo.forjaId, FORJA_ARTIGO);
  assert.equal(p.artigo.tipoProduto, "forma");
  assert.equal(p.quantidadeTotal, 50);
  assert.equal(p.prazoEntrega, "2026-11-30T17:00:00-03:00");
  assert.equal(p.valorTotal, 77500);
  assert.equal(p.poCliente, "4502385803");
  assert.equal(p.pedidoClienteItem, "Pedido 4502385803 · item 010");
  assert.equal(p.desenhoInformado, "DES-1 rev. B");
  assert.match(p.observacoes, /^Orçamento nº 212 · item 2 · Entrega parcial aceita$/);
});

test("rascunho: treino vai marcado; recusas claras (item apagado, quantidade fracionada) e ids inválidos não vão", () => {
  const treino = montarRascunhoOS(envio({ quote: { ...envio().quote, treino: true } }), null).payload;
  assert.equal(treino.treino, true);
  assert.equal(treino.codigoProvisorio, "TREINO-T-212/2");
  assert.match(treino.observacoes, /^TREINO \(não vai para produção\)/);
  assert.match(montarRascunhoOS(envio({ item: null }), null).erro, /apagado/);
  assert.match(montarRascunhoOS(envio({ item: { ...envio().item, quantidade: "2.5" } }), null).erro, /inteira.*2,5/);
  const semVinculo = montarRascunhoOS(envio({ item: { ...envio().item, produto: { ...envio().item.produto, forja_artigo_id: "abc" } } }), "x");
  assert.equal(semVinculo.payload.artigo.forjaId, null);
  assert.equal(semVinculo.payload.cliente.forjaId, null);
  assert.equal(prazoParaForja(null), null);
});

test("nova tentativa: rede dobra até 6 h; recusa de dado de hora em hora", () => {
  const t0 = new Date("2026-10-16T12:00:00Z");
  const min = (d) => (d.getTime() - t0.getTime()) / 60000;
  assert.equal(min(proximaTentativa(1, false, t0)), 5);
  assert.equal(min(proximaTentativa(3, false, t0)), 20);
  assert.equal(min(proximaTentativa(20, false, t0)), 360);
  assert.equal(min(proximaTentativa(1, true, t0)), 60);
});

test("migração: ganho enfileira, reabrir cancela ou recusa se a OS já foi liberada; fila só pelo servidor", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610160002_forja_os_envios.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("já foi liberada para produção na Forja: cancele lá primeiro"));
  assert.ok(/revoke insert, update, delete on public\.forja_os_envios, public\.integration_cursors from anon, authenticated/.test(sql));
  assert.ok(/create trigger sales_quotes_forja_os after update of situacao on public\.sales_quotes/.test(sql));
  // Espelho: rascunho chegando não anuncia "OS aberta"; a liberação anuncia.
  assert.ok(/if new\.status = 'rascunho' then return new; end if;/.test(sql));
  assert.ok(sql.includes("aberta (liberada do orçamento)"));
});

test("plataforma: ganho dispara o envio sem prender a resposta; sync de 10 min envia antes do espelho", () => {
  const rota = readFileSync(new URL("../app/api/comercial/orcamentos/[id]/situacao/route.ts", import.meta.url), "utf8");
  assert.ok(rota.includes("after(async () =>") && rota.includes("processarEnviosForja"));
  const sync = readFileSync(new URL("../app/api/producao/sync-os/route.ts", import.meta.url), "utf8");
  assert.ok(sync.indexOf("processarEnviosForja(admin)") < sync.indexOf("sincronizarOrdens(admin"));
});

test("treino também vai à Forja (16/10): gatilho sem exceção de treino; apagar o treino cancela os rascunhos", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202610160004_forja_os_treino.sql", import.meta.url), "utf8");
  const gatilho = sql.slice(sql.indexOf("function public.forja_os_envios_do_orcamento"), sql.indexOf("function public.comercial_treino_apagar"));
  assert.ok(!gatilho.includes("new.treino"));
  assert.ok(/comercial_treino_apagar[\s\S]*update public\.forja_os_envios set status = case when forja_os_id is null then 'cancelado' else 'cancelar' end/.test(sql));
});
