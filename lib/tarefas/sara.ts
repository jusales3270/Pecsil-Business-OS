import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ferramenta } from "../sara/base.ts";
import { agoraSP } from "../sara/tempo.ts";
import { AREAS_DAS_TAREFAS, conferirItens, dataCurta, linhaDoItem, SITUACOES, type ItemConferido, type Pessoa, type Situacao } from "./regras.ts";

/**
 * A SARA monta o quadro de tarefas (I-28): de um texto (ata, anotações, reunião transcrita) saem as tarefas com
 * responsável e prazo. O modelo lê e propõe; a plataforma confere o nome e a data; a pessoa permite no cartão e
 * completa o que faltar em Fundação › Tarefas. Vale em todas as SARAs (qualquer pessoa cria tarefa para qualquer
 * outra; quem recebe pode devolver).
 */

const AREAS = AREAS_DAS_TAREFAS;

/** Pessoas ativas da empresa de quem pede e quem responde por cada área (lidos pelo servidor; a empresa é a da sessão). */
export async function pessoasEResponsaveis(sb: SupabaseClient): Promise<{ pessoas: Pessoa[]; responsaveisDaArea: Record<string, Pessoa[]> }> {
  const { data: org } = await sb.rpc("current_organization_id");
  if (!org) return { pessoas: [], responsaveisDaArea: {} };
  // Só o servidor lê os perfis dos outros (a pessoa pode não enxergá-los); carregado aqui para os testes não o puxarem.
  const { createSupabaseAdminClient } = await import("../supabase/admin");
  const admin = createSupabaseAdminClient();
  const [{ data: perfis }, { data: resp }] = await Promise.all([
    admin.from("profiles").select("id, full_name, access_expires_at").eq("organization_id", org).eq("status", "active").limit(1000),
    admin.from("sara_responsaveis").select("modulo, profile_id").eq("organization_id", org),
  ]);
  const pessoas = ((perfis ?? []) as { id: string; full_name: string; access_expires_at: string | null }[])
    .filter((p) => !p.access_expires_at || Date.parse(p.access_expires_at) > Date.now()).map((p) => ({ id: p.id, nome: p.full_name }));
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const responsaveisDaArea: Record<string, Pessoa[]> = {};
  for (const r of (resp ?? []) as { modulo: string; profile_id: string }[]) {
    const p = porId.get(r.profile_id);
    if (p) (responsaveisDaArea[r.modulo] ??= []).push(p);
  }
  return { pessoas, responsaveisDaArea };
}

async function conferir(sb: SupabaseClient, e: Record<string, unknown>): Promise<{ titulo: string; itens: ItemConferido[] } | { erro: string }> {
  const titulo = String(e.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (titulo.length < 3) return { erro: "Dê um título ao quadro (ex.: \"Reunião de segunda com a Produção\")." };
  const { pessoas, responsaveisDaArea } = await pessoasEResponsaveis(sb);
  const itens = conferirItens(e.itens, { pessoas, responsaveisDaArea, areas: AREAS, hoje: agoraSP().dia });
  if (!itens.length) return { erro: "Não achei nenhuma tarefa no texto. Cada item precisa dizer o que fazer." };
  return { titulo, itens };
}

export const MONTAR_QUADRO: Ferramenta = {
  nome: "montar_quadro", rotulo: "preparou um quadro de tarefas", exige: [],
  descricao: "PREPARA um quadro de tarefas a partir de um texto (ata, anotações, reunião transcrita, ou o que a pessoa ditou): cada combinado vira uma tarefa com responsável e prazo, avisada no sino e cobrada na véspera e no vencimento. Escreva o responsável e o prazo COMO FORAM FALADOS (\"o Rafa\", \"sexta\", \"dia 20\"): a plataforma acha a pessoa e a data. Não invente responsável nem prazo: se não foi dito, deixe vazio (fica para completar). Use também para uma tarefa só (\"anota uma tarefa para a Ana até sexta\"). A pessoa permite no cartão.",
  esquema: { type: "object", properties: {
    titulo: { type: "string", description: "Título do quadro (ex.: \"Reunião de produção 10/11\")." },
    resumo: { type: "string", description: "Uma ou duas frases do que foi decidido (opcional)." },
    itens: { type: "array", description: "Uma por combinado.", items: { type: "object", properties: {
      tarefa: { type: "string", description: "O que fazer, começando pelo verbo (ex.: \"Ligar para a Cristal Rosario e confirmar o pagamento\")." },
      detalhe: { type: "string" },
      responsavel: { type: "string", description: "Quem faz, como foi falado. Vazio se não foi dito." },
      prazo: { type: "string", description: "Quando, como foi falado (\"sexta\", \"dia 20\", \"amanhã\", \"20/11\"). Vazio se não foi dito." },
      area: { type: "string", enum: AREAS, description: "A área da tarefa, se der para saber." },
    }, required: ["tarefa"] } },
  }, required: ["titulo", "itens"] },
  acao: {
    nivel: "operar", modulos: "todos",
    preparar: async (sb, e) => {
      const c = await conferir(sb, e);
      if ("erro" in c) return c;
      const hoje = agoraSP().dia;
      const faltam = c.itens.filter((i) => !i.responsavel || !i.prazo).length;
      return {
        resumo: `Criar o quadro «${c.titulo}» com ${c.itens.length} ${c.itens.length === 1 ? "tarefa" : "tarefas"}${faltam ? ` (${faltam} para completar depois em Fundação › Tarefas)` : ""}`,
        detalhes: c.itens.slice(0, 25).map((i) => linhaDoItem(i, hoje)),
      };
    },
  },
  rodar: async (sb, e) => {
    const c = await conferir(sb, e);
    if ("erro" in c) throw new Error(c.erro);
    const resumo = String(e.resumo ?? "").trim().slice(0, 4000) || null;
    const origem = e.origem === "reuniao" ? "reuniao" : "sara";
    const { data: quadro, error } = await sb.rpc("quadro_criar", { p_titulo: c.titulo, p_origem: origem, p_resumo: resumo, p_texto: typeof e.texto === "string" ? e.texto.slice(0, 60000) : null });
    if (error || !quadro) throw new Error(error?.message ?? "Não criou o quadro.");
    let criadas = 0;
    for (const i of c.itens) {
      const { error: eT } = await sb.rpc("tarefa_criar", { p_titulo: i.titulo, p_detalhe: i.detalhe, p_responsavel: i.responsavel?.id ?? null, p_prazo: i.prazo, p_modulo: i.modulo, p_quadro: quadro });
      if (eT) throw new Error(`Criou ${criadas} de ${c.itens.length}: ${eT.message}`);
      criadas++;
    }
    const faltam = c.itens.filter((i) => !i.responsavel || !i.prazo).length;
    return { dados: { feito: `Quadro «${c.titulo}» criado com ${criadas} ${criadas === 1 ? "tarefa" : "tarefas"}. Os responsáveis foram avisados no sino.${faltam ? ` ${faltam} sem responsável ou prazo: complete em Fundação › Tarefas.` : ""}`, quadro },
      fontes: [{ rotulo: "Fundação › Tarefas", link: `/?view=Tarefas&quadro=${quadro}` }] };
  },
};

export const MINHAS_TAREFAS: Ferramenta = {
  nome: "minhas_tarefas", rotulo: "tarefas da pessoa", exige: [],
  descricao: "As tarefas em que a pessoa é a responsável: as abertas (com o prazo e quem pediu, as vencidas primeiro) e as concluídas, devolvidas ou canceladas dos últimos 30 dias. Use para \"o que tenho para hoje?\", \"minhas tarefas\", \"o que está vencido?\".",
  esquema: { type: "object", properties: {} },
  rodar: async (sb) => {
    const { data, error } = await sb.rpc("tarefas_minhas");
    if (error) throw new Error(error.message);
    const hoje = agoraSP().dia;
    const lista = (data ?? []) as { id: string; titulo: string; prazo: string | null; situacao: Situacao; criado_por: string | null; quadro: string | null }[];
    const abertas = lista.filter((t) => t.situacao === "aberta" || t.situacao === "em_andamento");
    const vencidas = abertas.filter((t) => t.prazo && t.prazo < hoje);
    return {
      dados: {
        abertas: abertas.map((t) => ({ tarefa: t.titulo, prazo: dataCurta(t.prazo, hoje), vencida: Boolean(t.prazo && t.prazo < hoje), para_hoje: t.prazo === hoje, situacao: SITUACOES[t.situacao], pediu: t.criado_por, quadro: t.quadro })),
        quantidade_abertas: abertas.length, vencidas: vencidas.length,
        ultimas_fechadas: lista.filter((t) => !abertas.includes(t)).slice(0, 10).map((t) => ({ tarefa: t.titulo, situacao: SITUACOES[t.situacao] })),
      },
      fontes: [{ rotulo: "Minhas tarefas", link: "/?tarefas=" }],
    };
  },
};
