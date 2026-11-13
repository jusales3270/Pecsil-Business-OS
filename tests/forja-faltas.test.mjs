import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { parseFaltas, quaisAvisar, textoAviso, chaveAviso } = await import("../lib/forja/faltas-core.ts");
const { pruneDashboard, toDashboardData } = await import("../lib/forja/forja-session.ts");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// Formato de GET /api/integracao/faltas-chegada da Forja.
const daForja = (extra = {}) => ({
  id: "op-1", osId: "os-1", codigoGrv: "12950", cliente: "PARGLASS",
  artigo: { codigo: "5-01-00784", descricao: "BLOW MOULD" }, numeroLote: 1,
  esperado: 70, contado: 65, faltaInicial: 5, enviadas: 0, aguardandoConfirmacao: 0, chegaramDepois: 0, aceitas: 0, faltam: 5,
  situacao: "aberta", resolucao: null, conferidoPor: "Douglas", conferidoEm: "2026-11-13T16:24:00.000Z",
  enviadoPor: null, enviadoEm: null, resolvidoPor: null, resolvidoEm: null,
  estacaoConferencia: "Desbaste", estacaoOrigem: "Fundição",
  ...extra,
});
const agora = new Date("2026-11-13T18:00:00.000Z");

test("faltas da Forja: lidas; sem id, sem OS ou com situação estranha saem", () => {
  const { faltas, rejeitados } = parseFaltas([daForja(), daForja({ id: "" }), daForja({ codigoGrv: null }), daForja({ situacao: "talvez" })]);
  assert.equal(rejeitados, 3);
  assert.equal(faltas.length, 1);
  assert.equal(faltas[0].artigoCodigo, "5-01-00784");
  assert.equal(faltas[0].faltam, 5);
  assert.deepEqual(parseFaltas(null), { faltas: [], rejeitados: 0 });
});

test("aviso: abriu avisa uma vez; resolveu avisa uma vez", () => {
  const [aberta] = parseFaltas([daForja()]).faltas;
  assert.deepEqual(quaisAvisar([aberta], new Set(), agora).map((a) => a.tipo), ["aberta"]);
  assert.deepEqual(quaisAvisar([aberta], new Set([chaveAviso("op-1", "aberta")]), agora), [], "não repete");

  const [resolvida] = parseFaltas([daForja({ situacao: "resolvida", resolucao: "pecas_chegaram", faltam: 0, resolvidoEm: "2020-01-01T00:00:00.000Z" })]).faltas;
  assert.deepEqual(quaisAvisar([resolvida], new Set([chaveAviso("op-1", "aberta")]), agora).map((a) => a.tipo), ["resolvida"], "avisada antes: avisa a solução");
  assert.deepEqual(quaisAvisar([resolvida], new Set([chaveAviso("op-1", "aberta"), chaveAviso("op-1", "resolvida")]), agora), []);
});

test("primeira rodada depois do deploy não manda o histórico de faltas já resolvidas", () => {
  const antiga = parseFaltas([daForja({ situacao: "resolvida", faltam: 0, resolvidoEm: "2026-11-01T10:00:00.000Z" })]).faltas;
  assert.deepEqual(quaisAvisar(antiga, new Set(), agora), []);
  const recente = parseFaltas([daForja({ situacao: "resolvida", faltam: 0, resolvidoEm: "2026-11-13T17:00:00.000Z" })]).faltas;
  assert.deepEqual(quaisAvisar(recente, new Set(), agora).map((a) => a.tipo), ["resolvida"], "resolveu entre duas rodadas: avisa");
});

test("texto do WhatsApp para o chefe: OS, lote, quanto chegou, quanto falta e quem conferiu", () => {
  const [f] = parseFaltas([daForja()]).faltas;
  const t = textoAviso({ falta: f, tipo: "aberta" }, "Domingo");
  assert.match(t.whatsapp, /^⚠ Domingo, falta de peças na OS 12950 · lote 1/);
  assert.match(t.whatsapp, /chegaram 65 de 70 no Desbaste, faltam 5/);
  assert.match(t.whatsapp, /Conferido por Douglas/);
  assert.match(t.whatsapp, /Fundição já foi avisada/);
  assert.match(t.titulo, /chegaram 65 de 70/);

  const [aceita] = parseFaltas([daForja({ situacao: "resolvida", resolucao: "falta_aceita", aceitas: 5, faltam: 0, resolvidoPor: "Rafael", resolvidoEm: "2026-11-13T17:00:00.000Z" })]).faltas;
  assert.match(textoAviso({ falta: aceita, tipo: "resolvida" }, "Domingo").whatsapp, /PCP aceitou a falta de 5 peça\(s\) e o lote seguiu com 65 \(Rafael/);
  const [chegou] = parseFaltas([daForja({ situacao: "resolvida", resolucao: "pecas_chegaram", chegaramDepois: 5, faltam: 0 })]).faltas;
  assert.match(textoAviso({ falta: chegou, tipo: "resolvida" }).whatsapp, /as 5 peça\(s\) que faltavam chegaram ao Desbaste/);
});

test("painel da Forja traz as faltas para a tela da Produção, e só para quem vê o painel", () => {
  const corpo = {
    data: {
      osPorStatus: {}, osPorStatusLista: {}, osAtrasadas: [], kanban: [], pipelines: [], inspecao: {},
      paradas: { ativas: [], porMotivoHoje: {} }, fantasmas: { opsParadas: [], turnosNaoFechados: [] },
      indicadores: { carteira: {}, historico: {} }, gargalos: [], enviosExternos: [], totalOSExternas: 0,
      faltasChegada: [{ opLoteId: "op-1", osId: "os-1", codigoGrv: "12950", numeroLote: 1, cliente: "PARGLASS", artigo: "5-01", descricao: "X",
        estacao: "Desbaste", esperado: 70, contado: 65, faltam: 5, conferidoPor: "Douglas", conferidoEm: "2026-11-13T16:24:00.000Z",
        aguardandoConfirmacao: 2, enviadoEm: "2026-11-13T17:00:00.000Z" }],
    },
  };
  const data = toDashboardData(corpo);
  assert.equal(data.faltasChegada.length, 1);
  assert.equal(data.faltasChegada[0].faltam, 5);
  assert.equal(data.faltasChegada[0].aguardandoConfirmacao, 2);
  const semFaltas = toDashboardData({ data: { ...corpo.data, faltasChegada: undefined } });
  assert.deepEqual(semFaltas.faltasChegada, [], "Forja antiga: vazio");
  const vazio = { ...data, faltasChegada: [] };
  assert.equal(pruneDashboard(data, (f) => f === "producao.painel", vazio).faltasChegada.length, 1);
  assert.equal(pruneDashboard(data, (f) => f === "producao.paradas", vazio).faltasChegada.length, 0);
});

test("integração: sync de 10 em 10 min avisa as faltas; a migração guarda o que já foi avisado e põe o Domingo como responsável", () => {
  const rota = ler("app/api/producao/sync-os/route.ts");
  assert.match(rota, /avisarFaltas\(admin, org, \{ simular \}\)/);
  const aviso = ler("lib/forja/aviso-faltas.ts");
  assert.match(aviso, /\/api\/integracao\/faltas-chegada/);
  assert.match(aviso, /eq\("modulo", "faltas"\)/);
  assert.match(aviso, /whatsapp_agendados/);
  assert.match(aviso, /ignoreDuplicates: true/);
  const migra = ler("supabase/migrations/202611130001_producao_faltas_avisos.sql");
  assert.match(migra, /primary key \(organization_id, forja_falta_id, tipo\)/);
  assert.match(migra, /'faltas'.*\n.*\n.*Domingo Duque/s);
});
