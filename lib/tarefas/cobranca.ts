import type { SupabaseClient } from "@supabase/supabase-js";
import { agoraSP } from "../sara/tempo";
import { dataCurta, oQueAvisar, type TarefaCobravel } from "./regras";

/**
 * Cobrança das tarefas (I-28), na tarefa agendada de 10 em 10 minutos, em horário comercial (8h às 18h):
 *   lembrete na véspera do prazo (ou no próprio dia, se a tarefa foi criada em cima da hora);
 *   tarefa vencida: cobrança a cada 2 dias, até 3 vezes; na primeira, quem pediu também fica sabendo.
 * Aviso no sino e, para quem está na lista do WhatsApp, também por lá (o envio agendado respeita o horário
 * silencioso). A atualização é condicionada: duas rodadas ao mesmo tempo não avisam duas vezes.
 */

type Linha = TarefaCobravel & { id: string; organization_id: string; titulo: string; modulo: string | null; criado_por: string | null; criado_por_nome: string | null; responsavel_nome: string | null };
export type RelatorioCobranca = { lembretes: number; cobrancas: number; whatsapp: number; foraDoHorario: boolean };

export async function cobrarTarefas(admin: SupabaseClient, agora: Date = new Date()): Promise<RelatorioCobranca> {
  const rel: RelatorioCobranca = { lembretes: 0, cobrancas: 0, whatsapp: 0, foraDoHorario: false };
  const sp = agoraSP(agora);
  if (sp.hora24 < 8 || sp.hora24 >= 18) return { ...rel, foraDoHorario: true };
  const hoje = sp.dia;
  const amanha = new Date(`${hoje}T12:00:00Z`); amanha.setUTCDate(amanha.getUTCDate() + 1);
  const { data, error } = await admin.from("tarefas")
    .select("id, organization_id, titulo, modulo, prazo, situacao, lembrete_em, cobrancas, cobrado_em, responsavel_id, responsavel_nome, criado_por, criado_por_nome")
    .in("situacao", ["aberta", "em_andamento"]).not("responsavel_id", "is", null).not("prazo", "is", null)
    .lte("prazo", amanha.toISOString().slice(0, 10)).limit(1000);
  if (error) throw new Error(`Não li as tarefas: ${error.message}`);
  const base = (process.env.PLATAFORMA_URL?.trim() || "https://home.pecsil.com.br").replace(/\/+$/, "");

  for (const t of (data ?? []) as Linha[]) {
    const o = oQueAvisar(t, hoje, agora);
    if (!o) continue;
    const agoraIso = agora.toISOString();
    // Só uma rodada ganha: o update só passa se o estado ainda é o que foi lido.
    const ganhou = o === "lembrete"
      ? await admin.from("tarefas").update({ lembrete_em: agoraIso }).eq("id", t.id).is("lembrete_em", null).select("id").maybeSingle()
      : await admin.from("tarefas").update({ cobrancas: t.cobrancas + 1, cobrado_em: agoraIso }).eq("id", t.id).eq("cobrancas", t.cobrancas).select("id").maybeSingle();
    if (!ganhou.data) continue;
    const dias = o === "cobranca" ? Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${t.prazo}T12:00:00Z`)) / 86_400_000) : 0;
    const titulo = o === "lembrete"
      ? `Tarefa vence ${t.prazo === hoje ? "hoje" : "amanhã"}: ${t.titulo}`
      : `Tarefa vencida há ${dias} ${dias === 1 ? "dia" : "dias"}: ${t.titulo}`;
    const corpo = `${t.criado_por_nome ? `Pedida por ${t.criado_por_nome}. ` : ""}Prazo: ${dataCurta(t.prazo, hoje)}. Conclua, marque o andamento ou devolva dizendo o motivo.`;
    await admin.from("notifications").insert({ organization_id: t.organization_id, recipient_profile_id: t.responsavel_id, module_code: t.modulo ?? "fundacao",
      severity: o === "lembrete" ? "attention" : "critical", title: titulo.slice(0, 200), body: corpo, action_url: `/?tarefas=${t.id}` });
    await admin.from("tarefa_andamentos").insert({ organization_id: t.organization_id, tarefa_id: t.id, tipo: "cobranca",
      texto: o === "lembrete" ? `Lembrete: vence ${t.prazo === hoje ? "hoje" : "amanhã"}.` : `Cobrança ${t.cobrancas + 1} de 3: vencida há ${dias} ${dias === 1 ? "dia" : "dias"}.`, autor_nome: "Plataforma" });
    // Na primeira cobrança, quem pediu também fica sabendo (se não for o próprio responsável).
    if (o === "cobranca" && t.cobrancas === 0 && t.criado_por && t.criado_por !== t.responsavel_id)
      await admin.from("notifications").insert({ organization_id: t.organization_id, recipient_profile_id: t.criado_por, module_code: t.modulo ?? "fundacao", severity: "attention",
        title: `Venceu a tarefa de ${t.responsavel_nome ?? "alguém"}: ${t.titulo}`.slice(0, 200), body: `Prazo: ${dataCurta(t.prazo, hoje)}. ${t.responsavel_nome ?? "O responsável"} já foi cobrado.`, action_url: `/?tarefas=${t.id}` });
    if (o === "lembrete") rel.lembretes++; else rel.cobrancas++;

    // WhatsApp para quem está na lista interna de um número ativo.
    const { data: contato } = await admin.from("whatsapp_contatos").select("id, canal_id, nome, profiles:profiles!whatsapp_contatos_profile_id_fkey!inner(status), whatsapp_canais!inner(ativo, conexao)")
      .eq("profile_id", t.responsavel_id).eq("lista", "interna").eq("ativo", true).eq("profiles.status", "active").eq("whatsapp_canais.ativo", true).eq("whatsapp_canais.conexao", "whatsapp_web")
      .limit(1).maybeSingle<{ id: string; canal_id: string; nome: string | null }>();
    if (contato) {
      const nome = (contato.nome || t.responsavel_nome || "").split(" ")[0];
      const texto = `${nome ? `${nome}, ` : ""}${o === "lembrete" ? `lembrete: a tarefa "${t.titulo}" vence ${t.prazo === hoje ? "hoje" : "amanhã"}` : `a tarefa "${t.titulo}" venceu há ${dias} ${dias === 1 ? "dia" : "dias"}`}${t.criado_por_nome ? ` (pedida por ${t.criado_por_nome})` : ""}. Para concluir ou devolver: ${base}/?tarefas=${t.id}`;
      const { error: eW } = await admin.from("whatsapp_agendados").insert({ organization_id: t.organization_id, canal_id: contato.canal_id, contato_id: contato.id,
        para_nome: (contato.nome || t.responsavel_nome || "Tarefa").slice(0, 120), quando: agoraIso, texto, criado_por_nome: "SARA (Tarefas)" });
      if (eW) console.error("[tarefas] não agendou o WhatsApp", eW.message); else rel.whatsapp++;
    }
  }
  return rel;
}
