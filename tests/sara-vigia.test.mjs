import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  VIGIA, achadosDaPlataforma, analisarSinais, decisaoDoAchado, impressao, mesmoProblema, ordenarPorImpacto, precisaCobrar, sinaisDe,
  situacaoPelasRespostas, tipoDaChave, tipoDoAchado, validarAchados,
} from "../lib/sara/central/vigia.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
const rotulo = (m) => ({ financeiro: "Financeiro", compras: "Compras", almoxarifado: "Almoxarifado", producao: "Produção" })[m] ?? m;
const MODULOS = ["financeiro", "compras", "almoxarifado", "producao", "fundicao"];

const avisos = [
  { modulo: "financeiro", area: "Financeiro", avisos: [
    { chave: "financeiro.vencidas:394", nivel: "urgente", titulo: "394 contas a pagar vencidas em aberto", detalhe: "Somam R$ 1.330.419,47." },
    { chave: "financeiro.novidades:2026-10-24-x", nivel: "aviso", titulo: "Novidade" },
  ] },
  { modulo: "compras", area: "Compras", avisos: [{ chave: "compras.pedidos_parados:21,20", nivel: "urgente", titulo: "2 pedidos de material esperando cotação há mais de 2 dias", detalhe: "nº 21 · nº 20" }] },
];
const parados = [
  { tipo: "compra_atrasada", area: "Almoxarifado", titulo: "OC 0007 · Aço", dias: 9, ref: "a" },
  { tipo: "compra_atrasada", area: "Almoxarifado", titulo: "OC 0009 · Grafite", dias: 3, ref: "b" },
  { tipo: "os_rascunho", area: "Produção", titulo: "OS 120", dias: 4, ref: "c" },
  { tipo: "desconhecido", area: "Marte", titulo: "x", dias: 99, ref: "d" },
];

test("vigia: sinais são os avisos (sem novidades) e os Parados agrupados por tipo", () => {
  const s = sinaisDe(avisos, parados);
  assert.deepEqual(s.map((x) => x.id), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(s.map((x) => x.tipo), ["financeiro.vencidas", "compras.pedidos_parados", "parado.compra_atrasada", "parado.os_rascunho"]);
  const compra = s[2];
  assert.equal(compra.modulo, "almoxarifado");
  assert.equal(compra.nivel, "urgente", "o mais antigo tem 9 dias");
  assert.match(compra.titulo, /^2 itens parados \(compra atrasada\), o mais antigo há 9 dias$/);
  assert.match(compra.detalhe, /^OC 0007 · Aço \(9 dias\) · OC 0009 · Grafite \(3 dias\)$/);
  assert.equal(s[3].nivel, "aviso");
  // A impressão só muda quando os itens mudam.
  const compraDe = (l) => sinaisDe([], l).find((x) => x.tipo === "parado.compra_atrasada").chave;
  assert.equal(compraDe(parados), compraDe([...parados].reverse()));
  assert.notEqual(compraDe(parados), compraDe(parados.slice(1)));
  assert.equal(tipoDaChave("financeiro.vencidas:394"), "financeiro.vencidas");
  assert.match(impressao("abc"), /^[0-9a-z]+$/);
});

test("vigia: o mesmo problema não vira outro achado; tipo estável pelos sinais", () => {
  const s = sinaisDe(avisos, parados);
  assert.equal(tipoDoAchado("almoxarifado", [s[2], s[1]]), "almoxarifado:compras.pedidos_parados+parado.compra_atrasada");
  const aberto = { id: "x", tipo: "almoxarifado:compras.pedidos_parados+parado.compra_atrasada", modulo: "almoxarifado", titulo: "", sinais: [], situacao: "enviado" };
  assert.equal(mesmoProblema({ modulo: "almoxarifado", tipos: ["parado.compra_atrasada"] }, aberto), true);
  assert.equal(mesmoProblema({ modulo: "compras", tipos: ["parado.compra_atrasada"] }, aberto), false, "outra área");
  assert.equal(mesmoProblema({ modulo: "almoxarifado", tipos: ["parado.nota_sem_lancamento"] }, aberto), false, "outro sinal");
});

test("vigia: sem o modelo, cada urgente vira um achado da própria área", () => {
  const s = sinaisDe(avisos, parados);
  const a = achadosDaPlataforma(s);
  assert.deepEqual(a.map((x) => x.modulo), ["financeiro", "compras", "almoxarifado"]);
  assert.ok(a.every((x) => x.origem === "plataforma" && x.impacto === "alto"));
});

test("vigia: valida o que o modelo devolveu — sinal existe, módulo válido, até 3 contenções, número com fonte", () => {
  const s = sinaisDe(avisos, parados);
  const bruto = { achados: [
    { modulo: "almoxarifado", titulo: "Compra atrasada trava a produção", por_que: "A OC 0007 está atrasada há 9 dias e a OS 120 espera há 4 dias.", sinais: ["s3", "s4", "s99"], impacto: "alto",
      ligacoes: ["producao", "almoxarifado", "marte"], contencao: ["Cobrar o fornecedor da OC 0007 hoje", "Ver material substituto", "Avisar o PCP", "quarta"], confianca: "media" },
    { modulo: "inexistente", titulo: "Caixa apertado", por_que: "394 contas vencidas somam R$ 1.330.419,47.", sinais: ["s1"], impacto: "x", contencao: [], confianca: "alta" },
    { modulo: "financeiro", titulo: "Inventado", por_que: "São 500 contas vencidas.", sinais: ["s1"], impacto: "alto", contencao: [], confianca: "alta" },
    { modulo: "financeiro", titulo: "Sem sinal", por_que: "x", sinais: ["s42"], impacto: "alto", contencao: [], confianca: "alta" },
  ] };
  const v = validarAchados(bruto, s, MODULOS, rotulo);
  assert.equal(v.achados.length, 2);
  const [a, b] = v.achados;
  assert.deepEqual(a.sinais, ["s3", "s4"]);
  assert.deepEqual(a.ligacoes, ["producao"], "sem a própria área e sem módulo desconhecido");
  assert.equal(a.contencao.length, 3);
  assert.equal(b.modulo, "financeiro", "módulo inválido cai no do sinal");
  assert.equal(b.impacto, "medio");
  assert.equal(b.area, "Financeiro");
  assert.deepEqual(v.descartados, ["Inventado: número sem fonte (500)", "Sem sinal: sem sinal de origem"]);
});

test("vigia: impacto alto primeiro; depois mais urgentes e mais áreas ligadas", () => {
  const s = sinaisDe(avisos, parados);
  const base = { area: "", por_que: "", contencao: [], confianca: "media", origem: "modelo" };
  const ord = ordenarPorImpacto([
    { ...base, modulo: "producao", titulo: "B", sinais: ["s4"], impacto: "medio", ligacoes: [] },
    { ...base, modulo: "compras", titulo: "C", sinais: ["s2"], impacto: "alto", ligacoes: [] },
    { ...base, modulo: "almoxarifado", titulo: "A", sinais: ["s3", "s2"], impacto: "alto", ligacoes: ["producao"] },
  ], s);
  assert.deepEqual(ord.map((x) => x.titulo), ["A", "C", "B"]);
});

test("vigia: respostas decidem a situação; cobra a cada 2 dias, no máximo 3 vezes", () => {
  const e = (resposta) => ({ profile_id: "p", nome: "Ana", decisao_id: "d", enviado_em: "2026-10-20T10:00:00Z", resposta });
  assert.equal(situacaoPelasRespostas([e(null)]), "enviado");
  assert.equal(situacaoPelasRespostas([e("Vou tratar"), e(null)]), "tratando");
  assert.equal(situacaoPelasRespostas([e("Vou tratar"), e("Preciso de ajuda")]), "ajuda");
  assert.equal(situacaoPelasRespostas([e("Não é problema"), e("Não é problema")]), "nao_e_problema");
  assert.equal(situacaoPelasRespostas([e("Não é problema"), e(null)]), "enviado");
  const agora = new Date("2026-10-23T10:00:00Z");
  assert.equal(precisaCobrar(e(null), agora), true, "3 dias sem resposta");
  assert.equal(precisaCobrar(e(null), new Date("2026-10-21T10:00:00Z")), false, "1 dia");
  assert.equal(precisaCobrar({ ...e(null), cobrancas: 1, cobrado_em: "2026-10-22T10:00:00Z" }, agora), false, "lembrou ontem");
  assert.equal(precisaCobrar({ ...e(null), cobrancas: 3, cobrado_em: "2026-10-10T10:00:00Z" }, agora), false, "já lembrou 3 vezes");
  assert.equal(precisaCobrar(e("Vou tratar"), agora), false);
});

test("vigia: a decisão leva evidência, contenção, áreas afetadas e a marca de análise da IA", () => {
  const s = sinaisDe(avisos, parados);
  const d = decisaoDoAchado({ modulo: "almoxarifado", area: "Almoxarifado", titulo: "Compra atrasada trava a produção", por_que: "A OC 0007 atrasou.", sinais: ["s3"], impacto: "alto",
    ligacoes: ["producao"], contencao: ["Cobrar o fornecedor", "Ver substituto"], confianca: "media", origem: "modelo" }, s, rotulo);
  assert.equal(d.assunto, "Vigia da SARA: Compra atrasada trava a produção");
  assert.match(d.pergunta, /A decisão é sua\. O que você vai fazer\?$/);
  assert.deepEqual(d.detalhes, [
    "Evidência (Almoxarifado): 2 itens parados (compra atrasada), o mais antigo há 9 dias. OC 0007 · Aço (9 dias) · OC 0009 · Grafite (3 dias)",
    "Para conter (1): Cobrar o fornecedor", "Para conter (2): Ver substituto", "Afeta também: Produção",
    "Impacto alto · análise da SARA (IA), confiança média",
  ]);
  assert.deepEqual(VIGIA.opcoes, ["Vou tratar", "Não é problema", "Preciso de ajuda"]);
});

test("vigia: a análise usa o Sonnet com a ferramenta de achados; falha → null (vale a plataforma)", async () => {
  const s = sinaisDe(avisos, parados);
  let corpo = null;
  const ok = await analisarSinais({ chave: "x", hoje: "23/10/2026", sinais: s, abertos: [], buscar: async (_u, o) => { corpo = JSON.parse(o.body);
    return { ok: true, json: async () => ({ content: [{ type: "tool_use", input: { achados: [], resumo: "A empresa amanheceu com o caixa apertado." } }], usage: { input_tokens: 3000, output_tokens: 500 } }) }; } });
  assert.equal(corpo.model, "claude-sonnet-5-5");
  assert.deepEqual(corpo.tool_choice, { type: "tool", name: "registrar_achados" });
  assert.match(corpo.messages[0].content, /s3 \[URGENTE\] Almoxarifado \(almoxarifado\)/);
  assert.equal(ok.resumo, "A empresa amanheceu com o caixa apertado.");
  assert.equal(ok.tokensEntrada, 3000);
  assert.equal(await analisarSinais({ chave: "x", hoje: "", sinais: s, abertos: [], buscar: async () => ({ ok: false, json: async () => ({}) }) }), null);
  assert.equal(await analisarSinais({ chave: "", hoje: "", sinais: s, abertos: [] }), null);
});

test("vigia: migração, rota agendada, entrega só a quem enxerga e custo no teto da central", () => {
  const sql = ler("supabase/migrations/202610230004_sara_vigia.sql");
  assert.match(sql, /unique \(organization_id, chave\)/);
  assert.match(sql, /uq_sara_vigia_agenda on public\.sara_vigia_rodadas \(organization_id, dia\) where disparo = 'agenda'/);
  assert.match(sql, /revoke insert, update, delete on public\.sara_vigia_rodadas, public\.sara_achados from anon, authenticated/);
  assert.match(sql, /when p_modulo = 'warroom' then coalesce\(\(select sum\(r\.tokens_entrada \+ r\.tokens_saida\) from public\.sara_vigia_rodadas/);
  assert.match(sql, /\('financeiro', 'Ana Claudia'\)/);
  const cron = ler("scripts/sync-os-cron.mjs");
  assert.ok(cron.indexOf("/api/sara/vigia/rodar") < cron.indexOf("/api/sara/bom-dia/rodar"), "a vigia roda antes do Bom dia");
  const exec = ler("lib/sara/central/vigia-executar.ts");
  assert.match(exec, /if \(!p\.sinais\.every\(\(c\) => dela\.has\(tipoDaChave\(c\)\)\)\) continue;/, "só vai a quem enxerga os sinais");
  assert.match(exec, /VIGIA\.maxPorPessoaDia/);
  assert.match(ler("app/api/sara/vigia/rodar/route.ts"), /if \(process\.env\.NODE_ENV !== "production"\)/);
  assert.match(ler("app/api/sara/central/vigia/route.ts"), /access\.can\("warroom\.sara", "ver"\)/);
});
