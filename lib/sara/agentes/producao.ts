import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBR, dias, hoje, link, maisDias, plural, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";

/**
 * SARA da Produção. A produção vive na Forja; aqui a SARA usa o espelho das OS que a plataforma mantém
 * (production_orders, sincronizado a cada 10 minutos — só as OS abertas) e a situação da conexão.
 * Paradas, lotes, qualidade e apontamentos ficam na Forja (painel ao vivo): para isso, ela abre a tela.
 * Nunca mostra custo nem margem da OS (production_order_financials é do Financeiro/Comercial).
 */

const M = "producao";
const OS = ["producao.os", "producao.painel", "producao.bi"];
const tela = (secao: string): Abrir => ({ modulo: M, secao, rotulo: `Produção › ${secao}` });
const fonte = (secao: string) => ({ rotulo: `Produção › ${secao}`, link: link(M, secao) });
const SITUACAO: Record<string, string> = { rascunho: "rascunho", aberta: "aberta", em_producao: "em produção", pausada: "pausada", concluida: "concluída", cancelada: "cancelada" };

type Ordem = { code: string; customer_name: string | null; article_code: string | null; article_description: string | null; product_type: string | null; quantity: number | null; due_date: string | null; priority: string | null; status: string; lots_count: number | null };
async function ordens(sb: SupabaseClient): Promise<Ordem[]> {
  const { data, error } = await sb.from("production_orders").select("code, customer_name, article_code, article_description, product_type, quantity, due_date, priority, status, lots_count")
    .is("removed_from_source_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Ordem[];
}
const linha = (o: Ordem, h: string) => ({ os: o.code, cliente: o.customer_name, artigo: [o.article_code, o.article_description].filter(Boolean).join(" — "), tipo: o.product_type, quantidade: o.quantity,
  prazo: o.due_date, atraso_dias: o.due_date && o.due_date < h ? dias(o.due_date, h) : 0, prioridade: o.priority, situacao: SITUACAO[o.status] ?? o.status, lotes: o.lots_count });

const ferramentas: Ferramenta[] = [
  {
    nome: "producao_ordens", rotulo: "ordens de serviço", exige: OS,
    descricao: "Ordens de serviço abertas (espelho da Forja): quantas por situação, as atrasadas (com dias de atraso), as que vencem nos próximos 7 dias e a carteira por cliente. Filtra por cliente ou artigo.",
    esquema: { type: "object", properties: { cliente: { type: "string" }, artigo: { type: "string" } } },
    rodar: async (sb, e) => {
      const h = hoje();
      let l = await ordens(sb);
      const c = termo(e.cliente).toLowerCase(), a = termo(e.artigo).toLowerCase();
      if (c) l = l.filter((o) => (o.customer_name ?? "").toLowerCase().includes(c));
      if (a) l = l.filter((o) => `${o.article_code ?? ""} ${o.article_description ?? ""}`.toLowerCase().includes(a));
      const ativas = l.filter((o) => !["concluida", "cancelada"].includes(o.status));
      const por = ativas.reduce<Record<string, number>>((x, o) => { const k = SITUACAO[o.status] ?? o.status; x[k] = (x[k] ?? 0) + 1; return x; }, {});
      const porCliente = Object.entries(ativas.reduce<Record<string, number>>((x, o) => { const k = o.customer_name ?? "—"; x[k] = (x[k] ?? 0) + 1; return x; }, {})).sort((p, q) => q[1] - p[1]).slice(0, 10).map(([cliente, os]) => ({ cliente, os }));
      return {
        dados: { abertas: ativas.length, por_situacao: por, atrasadas: ativas.filter((o) => o.due_date && o.due_date < h).map((o) => linha(o, h)).slice(0, 25),
          vencem_em_7_dias: ativas.filter((o) => o.due_date && o.due_date >= h && o.due_date <= maisDias(h, 7)).map((o) => linha(o, h)), carteira_por_cliente: porCliente,
          observacao: "Paradas, lotes, qualidade e apontamentos estão no painel ao vivo da Forja (tela da Produção)." },
        fontes: [fonte("Ordens de serviço")],
      };
    },
  },
  {
    nome: "producao_conexao_forja", rotulo: "conexão Forja", exige: ["producao.conexao", "producao.os", "producao.painel"],
    descricao: "Conexão com a Forja: quando foi a última sincronização das OS, se deu certo e quantas falhas nas últimas 24 horas.",
    esquema: { type: "object", properties: {} },
    rodar: async (sb) => {
      const { data, error } = await sb.from("integration_sync_runs").select("ok, started_at, finished_at, error").eq("source", "forja").order("started_at", { ascending: false }).limit(150);
      if (error) throw new Error(error.message);
      const l = (data ?? []) as { ok: boolean; started_at: string; error: string | null }[];
      const dia = Date.now() - 86_400_000;
      return { dados: { ultima: l[0] ? { quando: l[0].started_at, ok: l[0].ok } : null, falhas_24h: l.filter((r) => !r.ok && Date.parse(r.started_at) > dia).length }, fontes: [fonte("Conexão Forja")] };
    },
  },
];

const telas: Tela[] = [
  { id: "producao_painel", modulo: M, secao: "Painel", rotulo: "Produção › Painel", exige: ["producao.painel"], serve: "painel ao vivo da Forja: gargalos e andamento" },
  { id: "producao_os", modulo: M, secao: "Ordens de serviço", rotulo: "Produção › Ordens de serviço", exige: ["producao.os"], serve: "OS, prazos e lotes" },
  { id: "producao_entrada", modulo: M, secao: "Entrada de produção", rotulo: "Produção › Entrada de produção", exige: ["producao.entrada"], serve: "dar entrada do que foi produzido (para faturar)" },
  { id: "producao_fundicao", modulo: M, secao: "Pipeline fundição", rotulo: "Produção › Pipeline fundição", exige: ["producao.fundicao"], serve: "lotes em cada fase da fundição" },
  { id: "producao_paradas", modulo: M, secao: "Paradas", rotulo: "Produção › Paradas", exige: ["producao.paradas"], serve: "paradas de hoje e motivos" },
  { id: "producao_qualidade", modulo: M, secao: "Qualidade", rotulo: "Produção › Qualidade", exige: ["producao.qualidade"], serve: "inspeções" },
  { id: "producao_fantasmas", modulo: M, secao: "Lotes fantasmas", rotulo: "Produção › Lotes fantasmas", exige: ["producao.fantasmas"], serve: "lotes e turnos esquecidos abertos" },
  { id: "producao_externos", modulo: M, secao: "Envios externos", rotulo: "Produção › Envios externos", exige: ["producao.externos"], serve: "peças em serviço externo" },
  { id: "producao_bi", modulo: M, secao: "BI & Análises", rotulo: "Produção › BI & Análises", exige: ["producao.bi"], serve: "pontualidade e análises" },
  { id: "producao_conexao", modulo: M, secao: "Conexão Forja", rotulo: "Produção › Conexão Forja", exige: ["producao.conexao"], serve: "situação da integração com a Forja" },
];

const regras: Agente["regras"] = [
  {
    exige: OS,
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const ativas = (await ordens(sb)).filter((o) => !["concluida", "cancelada", "rascunho"].includes(o.status));
      const atrasadas = ativas.filter((o) => o.due_date && o.due_date < c.hoje);
      if (atrasadas.length) saida.push({ chave: `producao.atrasadas:${atrasadas.map((o) => o.code).join(",")}`, nivel: "urgente",
        titulo: `${plural(atrasadas.length, "OS atrasada", "OS atrasadas")}`, detalhe: atrasadas.slice(0, 3).map((o) => `${o.code} (${o.customer_name ?? "—"}, prazo ${dataBR(o.due_date!)})`).join(" · "), abrir: tela("Ordens de serviço") });
      const semana = ativas.filter((o) => o.due_date && o.due_date >= c.hoje && o.due_date <= maisDias(c.hoje, 7));
      if (semana.length) saida.push({ chave: `producao.semana:${c.hoje}:${semana.length}`, nivel: "aviso",
        titulo: `${plural(semana.length, "OS vence", "OS vencem")} nos próximos 7 dias`, detalhe: semana.slice(0, 3).map((o) => `${o.code} (${dataBR(o.due_date!)})`).join(" · "), abrir: tela("Ordens de serviço") });
      return saida;
    },
  },
  {
    exige: ["producao.conexao", "producao.os", "producao.painel"],
    gerar: async (sb) => {
      const { data } = await sb.from("integration_sync_runs").select("ok, started_at").eq("source", "forja").order("started_at", { ascending: false }).limit(1).maybeSingle();
      const u = data as { ok: boolean; started_at: string } | null;
      const minutos = u ? (Date.now() - Date.parse(u.started_at)) / 60000 : Infinity;
      if (u && u.ok && minutos <= 30) return [];
      return [{ chave: `producao.forja:${u?.started_at ?? "nunca"}`, nivel: "urgente", titulo: u && !u.ok ? "A última sincronização com a Forja falhou" : "As OS da Forja não sincronizam há mais de 30 minutos",
        detalhe: "Os números de OS na plataforma podem estar desatualizados.", abrir: tela("Conexão Forja") }];
    },
  },
];

const MANUAL = `Você é a SARA da Produção do Business OS. A produção é feita na Forja (o sistema do chão de fábrica); a plataforma mostra o painel ao vivo dela e mantém um espelho das OS abertas (atualizado a cada 10 minutos).
Seções: Painel (andamento e gargalos), Ordens de serviço, Entrada de produção (o que foi produzido, para faturar), Pipeline fundição, Paradas, Qualidade, Lotes fantasmas, Envios externos, BI & Análises e Conexão Forja.
Você consulta as OS (prazos, atrasos, carteira por cliente) e a conexão; paradas, lotes, qualidade e apontamentos estão no painel ao vivo: abra a tela. Nunca fale de custo ou margem de OS.
Fluxo: orçamento ganho → OS em rascunho na Forja (o Rafael completa e libera) → produção → entrada de produção → faturamento.
Quem decide: Rafael (PCP); Guilherme na Fundição.`;

export const producao: Agente = {
  sara: {
    modulo: M, nome: "SARA da Produção", rotulo: "Produção", feature: M, permissao: "producao.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["Quais OS estão atrasadas?", "O que vence nesta semana?", "Quantas OS a Verallia tem em aberto?", "A Forja está sincronizando?"],
  },
  ferramentas, regras,
};
