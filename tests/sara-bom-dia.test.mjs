import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BOM_DIA, escreverBomDia, janelaDoBomDia, moduloDoBomDia, ordenarItens, resumoDoBomDia, textoDaPlataforma } from "../lib/sara/central/bom-dia.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const item = (x) => ({ tipo: "aviso", nivel: "aviso", modulo: "financeiro", area: "Financeiro", titulo: "Aviso", ...x });

test("bom dia: janela de segunda a sábado, das 7h às 11h de São Paulo", () => {
  // 23/10/2026 é sexta-feira.
  assert.deepEqual(janelaDoBomDia(new Date("2026-10-23T07:00:00-03:00")), { dia: "2026-10-23", semana: 5 });
  assert.deepEqual(janelaDoBomDia(new Date("2026-10-24T10:59:00-03:00")), { dia: "2026-10-24", semana: 6 });
  assert.equal(janelaDoBomDia(new Date("2026-10-23T06:59:00-03:00")), null);
  assert.equal(janelaDoBomDia(new Date("2026-10-23T11:00:00-03:00")), null);
  assert.equal(janelaDoBomDia(new Date("2026-10-25T08:00:00-03:00")), null, "domingo não tem");
  // 01h UTC do sábado ainda é sexta à noite em São Paulo.
  assert.equal(janelaDoBomDia(new Date("2026-10-24T01:00:00Z")), null);
  assert.deepEqual(BOM_DIA.dias, [1, 2, 3, 4, 5, 6]);
});

test("bom dia: urgente primeiro, depois decisões e ações, guias, avisos e novidades; corta no máximo", () => {
  const lista = [item({ tipo: "novidade", titulo: "N" }), item({ titulo: "A" }), item({ tipo: "guia", titulo: "G" }), item({ tipo: "acao", titulo: "P" }),
    item({ nivel: "urgente", titulo: "U" }), item({ tipo: "decisao", titulo: "D" })];
  assert.deepEqual(ordenarItens(lista).itens.map((i) => i.titulo), ["U", "P", "D", "A", "G", "N"]);
  const r = ordenarItens(lista, 2);
  assert.deepEqual(r.itens.map((i) => i.titulo), ["U", "P"]);
  assert.equal(r.restantes, 4);
});

test("bom dia: fica na SARA da área com mais urgentes; no empate, a com mais itens; depois, a primeira", () => {
  const itens = [item({ modulo: "compras", nivel: "urgente" }), item({ modulo: "financeiro" }), item({ modulo: "financeiro" }), item({ modulo: "rh", nivel: "urgente" }), item({ modulo: "rh" })];
  assert.equal(moduloDoBomDia(itens, ["financeiro", "compras", "rh"]), "rh");
  assert.equal(moduloDoBomDia([item({ modulo: "compras" })], ["financeiro", "compras"]), "compras");
  assert.equal(moduloDoBomDia([], ["financeiro", "compras"]), "financeiro");
  assert.equal(moduloDoBomDia([], []), null);
});

test("bom dia: resumo do sino conta urgentes, decisões, ações e avisos", () => {
  const itens = [item({ nivel: "urgente" }), item({ nivel: "urgente" }), item({ tipo: "decisao" }), item({ tipo: "acao" }), item({}), item({ tipo: "guia" })];
  assert.equal(resumoDoBomDia(itens), "2 urgentes · 1 decisão para você · 1 ação esperando o Permitir · 2 avisos");
  assert.equal(resumoDoBomDia([item({})]), "1 aviso");
});

test("bom dia: o texto da plataforma separa o urgente e diz quantos ficaram de fora", () => {
  const t = textoDaPlataforma({ nome: "Ana", data: "23/10", semana: "sexta", restantes: 3,
    itens: [item({ nivel: "urgente", titulo: "Extrato do Itaú atrasado", detalhe: "O último extrato vai até 10/10" }), item({ tipo: "decisao", area: "Compras", titulo: "Decisão para você: Compra direta" })] });
  assert.match(t, /^Bom dia, Ana! Hoje é sexta, 23\/10\./);
  assert.match(t, /\*\*Para tratar primeiro:\*\*\n- \*\*Financeiro:\*\* Extrato do Itaú atrasado\. O último extrato vai até 10\/10/);
  assert.match(t, /\*\*Também hoje:\*\*\n- \*\*Compras:\*\* Decisão para você: Compra direta/);
  assert.match(t, /E mais 3 itens/);
});

const resposta = (texto, ok = true) => async () => ({ ok, json: async () => ({ content: [{ type: "text", text: texto }], usage: { input_tokens: 400, output_tokens: 90 } }) });
const base = { chave: "x", nome: "Ana", data: "23/10", semana: "sexta", restantes: 0,
  itens: [item({ nivel: "urgente", titulo: "12 contas a pagar vencidas em aberto", detalhe: "Somam R$ 48.200,00." }), item({ titulo: "3 recebimentos previstos nos próximos 7 dias" })] };

test("bom dia: o texto do modelo vale quando todo número está nos fatos", async () => {
  const e = await escreverBomDia({ ...base, buscar: resposta("Bom dia, Ana! Hoje é sexta, 23/10.\n\n- **Financeiro:** 12 contas vencidas somam R$ 48.200,00; comece por elas.\n\nSe quiser, pergunte aqui sobre qualquer um deles.") });
  assert.equal(e.daPlataforma, false);
  assert.equal(e.modelo, BOM_DIA.modelo);
  assert.equal(e.tokensEntrada, 400);
});

test("bom dia: número inventado, erro ou falta da chave → texto da plataforma", async () => {
  const errado = await escreverBomDia({ ...base, buscar: resposta("Bom dia, Ana! Hoje é sexta, 23/10. As 15 contas vencidas somam R$ 52.000,00 e precisam de atenção.") });
  assert.equal(errado.daPlataforma, true);
  assert.deepEqual(errado.semFonte, ["15", "R$ 52.000,00"]);
  assert.equal(errado.tokensSaida, 90, "o custo da tentativa conta");
  assert.equal((await escreverBomDia({ ...base, buscar: resposta("x", false) })).daPlataforma, true);
  assert.equal((await escreverBomDia({ ...base, buscar: async () => { throw new Error("rede"); } })).daPlataforma, true);
  const sem = await escreverBomDia({ ...base, chave: "", buscar: async () => { throw new Error("não devia chamar"); } });
  assert.equal(sem.daPlataforma, true);
  assert.match(sem.texto, /12 contas a pagar vencidas/);
});

test("bom dia: migração com uma linha por pessoa por dia, leitura própria e gravação só do servidor", () => {
  const sql = ler("supabase/migrations/202610230003_sara_bom_dia.sql");
  assert.match(sql, /unique \(profile_id, dia\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /profile_id = \(select public\.current_profile_id\(\)\) or \(select public\.is_owner\(\)\)/);
  assert.match(sql, /revoke insert, update, delete on public\.sara_bom_dia from anon, authenticated/);
});

test("bom dia: a tarefa agendada chama a rota; o teste só passa hora e pessoas fora de produção", () => {
  assert.match(ler("scripts/sync-os-cron.mjs"), /"\/api\/sara\/bom-dia\/rodar"/);
  const rota = ler("app/api/sara/bom-dia/rodar/route.ts");
  assert.match(rota, /segredoConfere\(request\.headers\.get\("x-sync-secret"\)\)/);
  assert.match(rota, /if \(process\.env\.NODE_ENV !== "production"\)/);
  const exec = ler("lib/sara/central/bom-dia-executar.ts");
  assert.match(exec, /sessaoComo\(admin, l\.profile_id\)/, "monta com a sessão da pessoa");
  assert.match(exec, /if \(!todos\.length\) \{ await terminar\(admin, l\.id, \{ situacao: "vazia" \}\)/, "sem nada, não manda");
  assert.match(exec, /ignoreDuplicates: true/, "não manda duas vezes no dia");
});
