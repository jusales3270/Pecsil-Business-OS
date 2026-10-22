import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { resolverPeriodo, pascoa, PERIODO } = await import("../lib/sara/periodo.ts");
const { parametrosUsados } = await import("../lib/sara/parametros.ts");
const { conversarCom } = await import("../lib/sara/laco.ts");
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const H = "2026-10-22"; // quinta-feira

test("E5 datas: feriados móveis pela Páscoa e fixos, com o ano da frase", () => {
  assert.equal(pascoa(2025).toISOString().slice(0, 10), "2025-04-20");
  assert.equal(pascoa(2026).toISOString().slice(0, 10), "2026-04-05");
  assert.deepEqual(resolverPeriodo("quarta-feira de cinzas do ano passado", H), { de: "2025-03-05", ate: "2025-03-05", descricao: "quarta-feira de cinzas de 2025: 05/03/2025" });
  assert.equal(resolverPeriodo("Carnaval", H).de, "2026-02-16");
  assert.equal(resolverPeriodo("carnaval de 2025", H).ate, "2025-03-04");
  assert.equal(resolverPeriodo("sexta-feira santa do ano passado", H).de, "2025-04-18");
  assert.equal(resolverPeriodo("corpus christi", H).de, "2026-06-04");
  assert.equal(resolverPeriodo("natal", H).de, "2025-12-25", "sem ano e ainda por vir: o do ano passado");
  assert.equal(resolverPeriodo("natal deste ano", H).de, "2026-12-25");
});

test("E5 datas: períodos relativos (semana de segunda a domingo)", () => {
  const p = (e) => { const r = resolverPeriodo(e, H); return `${r.de}..${r.ate}`; };
  assert.equal(p("mês retrasado"), "2026-08-01..2026-08-31");
  assert.equal(p("mês passado"), "2026-09-01..2026-09-30");
  assert.equal(p("este mês"), "2026-10-01..2026-10-22");
  assert.equal(p("semana passada"), "2026-10-12..2026-10-18");
  assert.equal(p("segunda passada"), "2026-10-19..2026-10-19");
  assert.equal(p("últimos 15 dias"), "2026-10-08..2026-10-22");
  assert.equal(p("trimestre passado"), "2026-07-01..2026-09-30");
  assert.equal(p("março do ano passado"), "2025-03-01..2025-03-31");
  assert.equal(p("dezembro"), "2025-12-01..2025-12-31", "mês que ainda não chegou: o do ano passado");
  assert.equal(p("05/03/2025"), "2025-03-05..2025-03-05");
  assert.ok("erro" in resolverPeriodo("qualquer coisa", H));
  assert.deepEqual(PERIODO.exige, [], "toda SARA tem a ferramenta");
  assert.match(ler("lib/sara/sessao.ts"), /CALCULAR, PERIODO,/);
  assert.match(ler("lib/sara/modulos.ts"), /use a ferramenta periodo ANTES de consultar/);
});

test("E5 parâmetros usados: filtros reais das consultas, datas em BR, sem navegação nem ações", () => {
  const usadas = [
    { nome: "contas_a_pagar", entrada: { situacao: "vencidas", de: "2026-09-01", ate: "2026-09-30", limite: 30 }, ok: true },
    { nome: "contas_a_pagar", entrada: { situacao: "vencidas", de: "2026-09-01", ate: "2026-09-30", limite: 30 }, ok: true },
    { nome: "abrir_tela", entrada: { tela: "x" }, ok: true },
    { nome: "periodo", entrada: { expressao: "mês passado" }, ok: true },
    { nome: "pedir_material", entrada: { itens: [] }, ok: true },
    { nome: "fundicao_pedidos", entrada: {}, ok: true },
    { nome: "falhou", entrada: { a: 1 }, ok: false },
  ];
  assert.deepEqual(parametrosUsados(usadas, { contas_a_pagar: "contas a pagar" }, new Set(["pedir_material"])), [
    { consulta: "contas a pagar", filtros: ["período: 01/09/2026 a 30/09/2026", "situação: vencidas", "limite: 30"] },
    { consulta: "fundicao pedidos", filtros: ["padrão da consulta"] },
  ]);
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /parametros: parametrosUsados\(r\.ferramentas as Usada\[\]/);
  assert.match(ler("app/components/sara-painel.tsx"), /<summary>Parâmetros usados<\/summary>/);
});

test("E5 anexo: lido no servidor pelo leitor do Segundo Cérebro, vai como texto na pergunta e não fica guardado", async () => {
  const pedidos = [];
  const buscar = async (_u, init) => { pedidos.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "ok" }] }) }; };
  await conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: "s", historico: [], pergunta: "bate?", ferramentas: [], anexo: { nome: "lista.csv", texto: "8-04-00184;2" } });
  const blocos = pedidos[0].messages.at(-1).content;
  assert.match(blocos[0].text, /Documento anexado pela pessoa \("lista\.csv"\)[\s\S]*8-04-00184;2/);
  assert.equal(blocos.at(-1).text, "bate?");
  const rota = ler("app/api/sara/[modulo]/anexo/route.ts");
  assert.match(rota, /lerTexto\(new Uint8Array\(await arquivo\.arrayBuffer\(\)\), extratoresServidor\)/);
  assert.match(rota, /await preparar\(modulo\)/);
  assert.doesNotMatch(rota, /storage|insert|upload|createSupabaseAdminClient/i, "o arquivo não é guardado");
  assert.match(rota, /escaneado/i, "PDF escaneado orienta usar a foto");
  const conversa = ler("app/api/sara/[modulo]/route.ts");
  assert.match(conversa, /anexo \? `📎 \$\{anexo\.nome\} · ` : ""/, "a conversa grava só o nome do anexo");
  assert.match(conversa, /texto: corpo\.anexo\.texto\.slice\(0, 40_000\)/);
});

test("E5 parâmetros da consulta direta: nome da tela, período, filtros e agrupamento em português", () => {
  const usadas = [{ nome: "consultar_dados", ok: true, entrada: { tabela: "material_requests", filtros: [{ op: "contem", campo: "origem", valor: "fundi" }], periodo: { de: "2026-08-01", ate: "2026-08-31", campo: "created_at" }, agrupar: ["status"] } }];
  assert.deepEqual(parametrosUsados(usadas, {}, new Set(), { material_requests: "pedidos de material" }), [
    { consulta: "pedidos de material", filtros: ["período: 01/08/2026 a 31/08/2026", 'origem contém "fundi"', "agrupado por situação"] },
  ]);
});
