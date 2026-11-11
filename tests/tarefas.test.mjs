import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { conferirItens, dataCurta, linhaDoItem, oQueAvisar, prazoDoTexto } from "../lib/tarefas/regras.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");
// 10/11/2026 é uma terça-feira.
const HOJE = "2026-11-10";

test("prazo falado vira data (a partir de terça, 10/11/2026)", () => {
  const casos = {
    "hoje": "2026-11-10", "amanhã": "2026-11-11", "depois de amanhã": "2026-11-12", "até amanhã": "2026-11-11",
    "sexta": "2026-11-13", "sexta-feira": "2026-11-13", "até sexta": "2026-11-13", "na próxima segunda": "2026-11-16", "terça": "2026-11-17",
    "sexta que vem": "2026-11-20", "dia 20": "2026-11-20", "dia 5": "2026-12-05", "20/11": "2026-11-20", "05/01": "2027-01-05",
    "20/11/2026": "2026-11-20", "20/11/26": "2026-11-20", "20 de novembro": "2026-11-20", "2026-12-01": "2026-12-01",
    "em 3 dias": "2026-11-13", "daqui a 2 semanas": "2026-11-24", "semana que vem": "2026-11-16", "fim do mês": "2026-11-30",
    // como as pessoas falam na reunião (QA de 10/11: "amanhã cedo" ficava sem data)
    "amanhã cedo": "2026-11-11", "sexta de manhã": "2026-11-13", "dia 20 sem falta": "2026-11-20", "pra amanhã": "2026-11-11",
    "para sexta": "2026-11-13", "hoje à tarde": "2026-11-10", "até o fim do dia": "2026-11-10", "amanhã até as 10h": "2026-11-11",
  };
  for (const [falado, data] of Object.entries(casos)) assert.equal(prazoDoTexto(falado, HOJE), data, falado);
  for (const nada of ["", null, "logo", "quando der", "31/02", "dia 40", "logo cedo", "assim que puder"]) assert.equal(prazoDoTexto(nada, HOJE), null, String(nada));
});

const pessoas = [{ id: "p1", nome: "Ana Claudia" }, { id: "p2", nome: "RAFAEL ARAUJO DOS SANTOS" }, { id: "p3", nome: "Rosana" }, { id: "p4", nome: "Rafaela Lima" }];

test("itens da reunião: a plataforma acha a pessoa e a data; o que falta vira aviso, nada é inventado", () => {
  const itens = conferirItens([
    { tarefa: "Ligar para a Cristal Rosario", responsavel: "Ana", prazo: "sexta", area: "financeiro" },
    { tarefa: "Rever o roteiro da OS 12676", responsavel: "Rafael Araujo", prazo: "dia 20", area: "producao" },
    { tarefa: "Pedir orçamento de EPI", area: "rh" },
    { tarefa: "Conferir o estoque de grafite", responsavel: "Zé da portaria", prazo: "logo" },
    { tarefa: "ok" },
  ], { pessoas, responsaveisDaArea: { rh: [pessoas[2]] }, areas: ["financeiro", "producao", "rh"], hoje: HOJE });
  assert.equal(itens.length, 4, "item sem o que fazer (curto demais) sai");
  assert.deepEqual([itens[0].responsavel?.id, itens[0].prazo, itens[0].modulo, itens[0].avisos], ["p1", "2026-11-13", "financeiro", []]);
  assert.deepEqual([itens[1].responsavel?.id, itens[1].prazo], ["p2", "2026-11-20"]);
  assert.equal(itens[2].responsavel?.id, "p3", "sem nome: quem responde pela área (uma pessoa só)");
  assert.match(itens[2].avisos.join(" "), /Responsável sugerido.*Rosana/);
  assert.match(itens[2].avisos.join(" "), /Sem prazo/);
  assert.equal(itens[3].responsavel, null);
  assert.match(itens[3].avisos.join(" "), /Não achei "Zé da portaria"/);
  assert.match(itens[3].avisos.join(" "), /Não entendi o prazo "logo"/);
  assert.equal(itens[3].modulo, null, "área fora da lista não vale");
  assert.equal(linhaDoItem(itens[0], HOJE), "Ligar para a Cristal Rosario · Ana Claudia · até 13/11");
  assert.equal(dataCurta("2027-01-05", HOJE), "05/01/2027");
});

test("cobrança: lembrete na véspera (ou no dia), cobrança da vencida a cada 2 dias, até 3 vezes", () => {
  const base = { situacao: "aberta", lembrete_em: null, cobrancas: 0, cobrado_em: null, responsavel_id: "p1" };
  const agora = new Date("2026-11-10T12:00:00-03:00");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-11" }, HOJE, agora), "lembrete");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-10" }, HOJE, agora), "lembrete", "criada em cima da hora: avisa no dia");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-11", lembrete_em: "2026-11-10T10:00:00Z" }, HOJE, agora), null, "uma vez só");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-20" }, HOJE, agora), null, "longe ainda");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-09" }, HOJE, agora), "cobranca");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-05", cobrancas: 1, cobrado_em: "2026-11-09T12:00:00-03:00" }, HOJE, agora), null, "cobrou ontem");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-05", cobrancas: 1, cobrado_em: "2026-11-08T12:00:00-03:00" }, HOJE, agora), "cobranca");
  assert.equal(oQueAvisar({ ...base, prazo: "2026-11-01", cobrancas: 3, cobrado_em: "2026-11-01T12:00:00-03:00" }, HOJE, agora), null, "até 3 vezes");
  for (const situacao of ["feita", "devolvida", "cancelada"]) assert.equal(oQueAvisar({ ...base, situacao, prazo: "2026-11-09" }, HOJE, agora), null, situacao);
  assert.equal(oQueAvisar({ ...base, responsavel_id: null, prazo: "2026-11-09" }, HOJE, agora), null, "sem responsável não cobra");
  assert.equal(oQueAvisar({ ...base, prazo: null }, HOJE, agora), null);
});

test("tarefas: a SARA de toda área monta o quadro (com Permitir) e consulta as tarefas; banco com as regras combinadas", () => {
  assert.match(ler("lib/sara/acoes.ts"), /ABRIR_CHAMADO_TI, ANOTAR_NA_BIBLIOTECA, MONTAR_QUADRO,/);
  assert.match(ler("lib/tarefas/sara.ts"), /nivel: "operar", modulos: "todos"/);
  const sessao = ler("lib/sara/sessao.ts");
  assert.match(sessao, /MONTAR_QUADRO, MINHAS_TAREFAS,/, "na central");
  assert.match(sessao, /DOCUMENTOS_RECEBIDOS, MINHAS_TAREFAS\]/, "nas áreas");
  const sql = ler("supabase/migrations/202611100002_tarefas.sql");
  assert.match(sql, /revoke insert, update, delete on public\.quadros, public\.tarefas, public\.tarefa_andamentos from anon, authenticated/);
  assert.match(sql, /p_responsavel = public\.current_profile_id\(\) or p_criado_por = public\.current_profile_id\(\)/, "o responsável e quem criou veem");
  assert.match(sql, /public\.has_feature\('warroom\.sara'\)/, "a diretoria vê tudo");
  assert.match(sql, /if not sou_resp or not aberta then raise exception 'Só o responsável devolve a tarefa\.'/);
  assert.match(sql, /if texto is null then raise exception 'Diga o motivo da devolução\.'/);
});

test("Bom dia: tarefa vencida é urgente, a de hoje é aviso; as futuras e as fechadas ficam de fora", async () => {
  const { itensDasTarefas, resumoDoBomDia } = await import("../lib/sara/central/bom-dia.ts");
  const rotulo = (m) => (m === "compras" ? "Compras" : "Plataforma");
  const itens = itensDasTarefas([
    { titulo: "Ligar para a Cristal", modulo: "compras", prazo: "2026-11-06", situacao: "aberta", criado_por: "Rafael" },
    { titulo: "Enviar o orçamento", modulo: null, prazo: "2026-11-10", situacao: "em_andamento", criado_por: null },
    { titulo: "Conferir o estoque", modulo: null, prazo: "2026-11-11", situacao: "aberta", criado_por: null },
    { titulo: "Já feita", modulo: null, prazo: "2026-11-01", situacao: "feita", criado_por: null },
    { titulo: "Sem prazo", modulo: null, prazo: null, situacao: "aberta", criado_por: null },
  ], HOJE, rotulo);
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map((i) => [i.nivel, i.area, i.titulo]), [
    ["urgente", "Compras", "Tarefa vencida desde 06/11: Ligar para a Cristal"],
    ["aviso", "Plataforma", "Tarefa para hoje: Enviar o orçamento"],
  ]);
  assert.match(itens[0].detalhe, /Pedida por Rafael/);
  assert.equal(resumoDoBomDia(itens), "1 urgente · 1 tarefa para hoje");
});

test("cobrança: rota com o segredo, na tarefa de 10 minutos, horário comercial e sem aviso duplicado", () => {
  const rota = readFileSync(new URL("../app/api/tarefas/cobrar/route.ts", import.meta.url), "utf8");
  assert.match(rota, /segredoConfere\(request\.headers\.get\("x-sync-secret"\)\)/);
  assert.match(readFileSync(new URL("../scripts/sync-os-cron.mjs", import.meta.url), "utf8"), /"\/api\/tarefas\/cobrar"/);
  const c = readFileSync(new URL("../lib/tarefas/cobranca.ts", import.meta.url), "utf8");
  assert.match(c, /hora24 < 8 \|\| sp\.hora24 >= 18/, "fora do horário comercial não cobra");
  assert.match(c, /\.is\("lembrete_em", null\)/, "o lembrete só sai uma vez, mesmo com duas rodadas juntas");
  assert.match(c, /\.eq\("cobrancas", t\.cobrancas\)/, "a cobrança só conta uma vez por rodada");
  assert.match(c, /whatsapp_agendados/, "WhatsApp pelo envio agendado (horário silencioso)");
  assert.match(readFileSync(new URL("../lib/sara/central/bom-dia-executar.ts", import.meta.url), "utf8"), /sb\.rpc\("tarefas_minhas"\)/, "o Bom dia lê as tarefas com a sessão da pessoa");
});
