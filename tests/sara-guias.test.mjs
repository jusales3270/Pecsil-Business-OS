import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dentroDoLimite, descreverGatilho, ferramentaCriarGuia, limparLimites, pedidoDaGuia, proximaExecucao, validarGuia } from "../lib/sara/guias.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const sql = ler("supabase/migrations/202610220002_sara_guias.sql");

test("agenda: próxima execução no fuso de São Paulo", () => {
  // Quinta 22/10/2026 10:00 em São Paulo = 13:00 UTC.
  const agora = new Date("2026-10-22T13:00:00Z");
  // Toda segunda às 08:00 → segunda 26/10 08:00 SP = 11:00 UTC.
  assert.equal(proximaExecucao({ dias: [1], hora: "08:00" }, agora)?.toISOString(), "2026-10-26T11:00:00.000Z");
  // Hoje mais tarde (quinta 14:30) → hoje.
  assert.equal(proximaExecucao({ dias: [4], hora: "14:30" }, agora)?.toISOString(), "2026-10-22T17:30:00.000Z");
  // Hoje mais cedo (quinta 07:00) → quinta que vem.
  assert.equal(proximaExecucao({ dias: [4], hora: "07:00" }, agora)?.toISOString(), "2026-10-29T10:00:00.000Z");
  // Quarta → a de 28/10.
  assert.equal(proximaExecucao({ dias: [3], hora: "14:30" }, agora)?.toISOString(), "2026-10-28T17:30:00.000Z");
  // Todo dia às 07:30, perto da meia-noite em SP (23:50 de quinta = 02:50 UTC de sexta) → sexta 07:30.
  assert.equal(proximaExecucao({ dias: [0, 1, 2, 3, 4, 5, 6], hora: "07:30" }, new Date("2026-10-23T02:50:00Z"))?.toISOString(), "2026-10-23T10:30:00.000Z");
  assert.equal(proximaExecucao({ dias: [], hora: "08:00" }, agora), null);
  assert.equal(proximaExecucao({ dias: [1], hora: "25:00" }, agora), null);
});

test("gatilho em português", () => {
  assert.equal(descreverGatilho({ tipo: "agenda", dias: [1], hora: "08:00" }), "toda segunda às 08:00");
  assert.equal(descreverGatilho({ tipo: "agenda", dias: [1, 4], hora: "08:00" }), "toda segunda e quinta às 08:00");
  assert.equal(descreverGatilho({ tipo: "agenda", dias: [1, 2, 3, 4, 5], hora: "07:00" }), "de segunda a sexta às 07:00");
  assert.equal(descreverGatilho({ tipo: "agenda", dias: [0, 1, 2, 3, 4, 5, 6], hora: "07:00" }), "todo dia às 07:00");
  assert.equal(descreverGatilho({ tipo: "agenda", dias: [6], hora: "09:00" }), "todo sábado às 09:00");
  assert.equal(descreverGatilho({ tipo: "evento", evento: "fundicao.pedido.criado" }, () => "Material pedido pela Fundição"), "quando acontecer: Material pedido pela Fundição");
  assert.match(descreverGatilho({ tipo: "atalho" }), /quando você pedir/);
});

test("limite: sem 'sozinha' tudo pede Permitir; com limite, confere vezes, itens e horário", () => {
  const meioDia = new Date("2026-10-22T15:00:00Z"); // 12:00 em SP
  assert.equal(dentroDoLimite(undefined, {}, 0, meioDia).sozinha, false);
  assert.equal(dentroDoLimite({ sozinha: false }, {}, 0, meioDia).sozinha, false);
  assert.equal(dentroDoLimite({ sozinha: true }, {}, 0, meioDia).sozinha, true);
  assert.equal(dentroDoLimite({ sozinha: true, max_por_dia: 2 }, {}, 2, meioDia).sozinha, false);
  assert.equal(dentroDoLimite({ sozinha: true, max_itens: 3 }, { itens: [1, 2, 3, 4] }, 0, meioDia).sozinha, false);
  assert.equal(dentroDoLimite({ sozinha: true, max_itens: 3 }, { itens: [1, 2] }, 0, meioDia).sozinha, true);
  assert.equal(dentroDoLimite({ sozinha: true, horario: { de: "07:00", ate: "11:00" } }, {}, 0, meioDia).sozinha, false);
  assert.equal(dentroDoLimite({ sozinha: true, horario: { de: "07:00", ate: "18:00" } }, {}, 0, meioDia).sozinha, true);
});

test("limites da tela: só ações conhecidas e números válidos", () => {
  const l = limparLimites({ pedir_material: { sozinha: true, max_por_dia: "3", max_itens: -2, horario: { de: "18:00", ate: "07:00" } }, apagar_tudo: { sozinha: true } }, ["pedir_material"]);
  assert.deepEqual(l, { pedir_material: { sozinha: true, max_por_dia: 3 } });
});

test("guia pedida: valida passos, quando e evento", () => {
  const ok = validarGuia({ nome: "Vencimentos da semana", descricao: "O que vence na semana.", quando: { tipo: "agenda", dias: [1, 1, 9], hora: "08:00" },
    passos: [{ ferramenta: "contas_a_pagar", para_que: "a vencer" }, { ferramenta: "inventada", para_que: "x" }] }, ["contas_a_pagar"], []);
  assert.ok(!("erro" in ok));
  assert.deepEqual(ok.gatilho, { tipo: "agenda", dias: [1], hora: "08:00" });
  assert.equal(ok.passos.length, 1);
  assert.ok("erro" in validarGuia({ nome: "Aviso", descricao: "Avisa.", quando: { tipo: "evento", evento: "compras.nao.existe" }, passos: [{ ferramenta: "a", para_que: "b" }] }, ["a"], ["fundicao.pedido.criado"]));
  assert.ok("erro" in validarGuia({ nome: "Sem passo", descricao: "Nada.", quando: { tipo: "atalho" }, passos: [] }, ["a"], []));
  assert.ok("erro" in validarGuia({ nome: "Sem hora", descricao: "Nada.", quando: { tipo: "agenda", dias: [1] }, passos: [{ ferramenta: "a", para_que: "b" }] }, ["a"], []));
  const ev = validarGuia({ nome: "Aviso", descricao: "Avisa.", quando: { tipo: "evento", evento: "fundicao.pedido.criado" }, passos: [{ ferramenta: "a", para_que: "b" }] }, ["a"], ["fundicao.pedido.criado"]);
  assert.deepEqual(ev.gatilho, { tipo: "evento", evento: "fundicao.pedido.criado" });
});

test("ferramenta criar_guia lista só os eventos da pessoa e não grava nada", async () => {
  const f = ferramentaCriarGuia([{ tipo: "fundicao.pedido.criado", rotulo: "Material pedido pela Fundição" }]);
  assert.equal(f.nome, "criar_guia");
  assert.match(f.descricao, /fundicao\.pedido\.criado \(Material pedido pela Fundição\)/);
  assert.equal(f.acao, undefined);
  const r = await f.rodar(null, { nome: "X" });
  assert.match(String(r.dados.situacao), /aprovação/);
});

test("pedido da guia: passos, acontecimento e formato", () => {
  const t = pedidoDaGuia({ nome: "Aviso", descricao: "Avisa o Guilherme.", passos: [{ ferramenta: "pedidos_da_fundicao", para_que: "ver o pedido" }], formato: "uma frase" }, "evento", { resumo: "Pedido #40 aprovado", quem: "Kaylane" });
  assert.match(t, /Rode a guia «Aviso» \(por um acontecimento\)/);
  assert.match(t, /Pedido #40 aprovado \(por Kaylane\)/);
  assert.match(t, /1\) pedidos_da_fundicao — ver o pedido/);
  assert.match(t, /Entregue: uma frase/);
});

test("migração: freios, laço e permissões das guias", () => {
  // A trigger nunca impede o evento e ignora os eventos da própria SARA.
  assert.match(sql, /exception when others then[\s\S]*return new;/);
  assert.match(sql, /if new\.module_code = 'sara' then return new; end if;/);
  // No máximo 20 execuções por guia em 24 h (trigger e Rodar agora).
  assert.equal((sql.match(/interval '24 hours'\) < 20|interval '24 hours'\) >= 20/g) ?? []).length, 2);
  // Quem aprova é a SARA do módulo em "aprovar" (ou o proprietário, pelo has_feature).
  assert.match(sql, /has_feature\(p_modulo \|\| '\.sara', 'aprovar'\)/);
  assert.match(sql, /\('fundicao\.sara', 'fundicao', 'SARA \(assistente do módulo\)', '\{ver,aprovar\}', 95\)/);
  // Ação sozinha só com "sozinha" no limite da guia, e o banco confere vezes no dia e itens.
  assert.match(sql, /Esta ação não está pré-autorizada para a guia/);
  assert.match(sql, /Limite do dia atingido/);
  assert.match(sql, /Mais itens do que o limite da guia/);
  // Cartão da guia: validade até 24 h.
  assert.match(sql, /least\(greatest\(coalesce\(p_validade_min, 15\), 5\), 1440\)/);
  // Guias aparecem como atalho só para quem as criou.
  assert.match(sql, /h\.tipo = 'habilidade' or \(h\.responsavel_id = public\.current_profile_id\(\) and not h\.pausada\)/);
});

test("a tarefa agendada roda a fila das guias e a conversa registra a guia pedida", () => {
  const cron = ler("scripts/sync-os-cron.mjs");
  assert.match(cron, /"\/api\/producao\/sync-os", "\/api\/sara\/guias\/rodar"/);
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /sara_guia_propor/);
  const exec = ler("lib/sara/guias-executar.ts");
  // Roda com a sessão de quem criou e encerra a sessão no fim.
  assert.match(exec, /generateLink\(\{ type: "magiclink"/);
  assert.match(exec, /signOut\(token, "local"\)/);
  assert.match(exec, /finally \{\s*await s\.sair\(\);/);
  // Risco alto nunca é feito sozinho.
  assert.match(exec, /a\.risco !== "alto"/);
});
