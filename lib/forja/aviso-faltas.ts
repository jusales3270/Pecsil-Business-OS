import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getForjaSession } from "./client";
import { chaveAviso, parseFaltas, quaisAvisar, textoAviso } from "./faltas-core";

/**
 * Falta de peças na chegada ao Desbaste (Forja) → chefe, no sino e no WhatsApp.
 *
 * Roda junto da sincronização das OS (a cada 10 min). Lê as faltas da Forja, decide o que avisar
 * (abriu / resolveu) e manda para quem decide a área "faltas" em sara_responsaveis (o Domingo; o
 * proprietário pode trocar). Cada aviso é reservado antes em producao_faltas_avisos: duas rodadas ao
 * mesmo tempo não avisam duas vezes. O WhatsApp vai pela fila de agendados (respeita o horário
 * silencioso), para quem está na lista interna de um número ativo.
 */

export type RelatorioFaltas = {
  noForja: number;
  abertas: number;
  rejeitados: number;
  avisos: number;
  whatsapp: number;
  semResponsavel: boolean;
};

export async function avisarFaltas(admin: SupabaseClient, org: string, { simular }: { simular: boolean }): Promise<RelatorioFaltas> {
  const { faltas, rejeitados } = parseFaltas(await getForjaSession().getData("/api/integracao/faltas-chegada"));
  const rel: RelatorioFaltas = {
    noForja: faltas.length, abertas: faltas.filter((f) => f.situacao === "aberta").length,
    rejeitados, avisos: 0, whatsapp: 0, semResponsavel: false,
  };
  if (faltas.length === 0) return rel;

  const { data: feitosRows, error: eFeitos } = await admin.from("producao_faltas_avisos")
    .select("forja_falta_id, tipo").eq("organization_id", org).in("forja_falta_id", faltas.map((f) => f.id));
  if (eFeitos) throw new Error(`avisos de falta já feitos: ${eFeitos.message}`);
  const feitos = new Set((feitosRows ?? []).map((r) => chaveAviso(String(r.forja_falta_id), r.tipo as "aberta" | "resolvida")));
  const avisos = quaisAvisar(faltas, feitos, new Date());
  if (simular || avisos.length === 0) return { ...rel, avisos: avisos.length };

  const { data: resp, error: eResp } = await admin.from("sara_responsaveis")
    .select("profile_id, profiles!inner(full_name, status)").eq("organization_id", org).eq("modulo", "faltas").eq("profiles.status", "active");
  if (eResp) throw new Error(`quem recebe as faltas: ${eResp.message}`);
  const destinos = ((resp ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null } }[])
    .map((r) => ({ id: r.profile_id, nome: r.profiles?.full_name ?? null }));
  if (destinos.length === 0) return { ...rel, semResponsavel: true };

  for (const aviso of avisos) {
    // Reserva: só a rodada que gravar a linha avisa.
    const resumo = textoAviso(aviso).titulo.slice(0, 200);
    const { data: reservou, error: eRes } = await admin.from("producao_faltas_avisos")
      .upsert({ organization_id: org, forja_falta_id: aviso.falta.id, tipo: aviso.tipo, resumo }, { onConflict: "organization_id,forja_falta_id,tipo", ignoreDuplicates: true })
      .select("forja_falta_id");
    if (eRes) throw new Error(`reservar aviso de falta: ${eRes.message}`);
    if (!reservou?.length) continue;
    rel.avisos++;

    for (const d of destinos) {
      const primeiro = (d.nome ?? "").split(" ")[0] || null;
      const t = textoAviso(aviso, primeiro);
      await admin.from("notifications").insert({
        organization_id: org, recipient_profile_id: d.id, module_code: "producao",
        severity: aviso.tipo === "aberta" ? "critical" : "info",
        title: t.titulo.slice(0, 200), body: t.corpo.slice(0, 600), action_url: "/?module=producao&secao=Painel",
      });
      const { data: contato } = await admin.from("whatsapp_contatos")
        .select("id, canal_id, nome, profiles:profiles!whatsapp_contatos_profile_id_fkey!inner(status), whatsapp_canais!inner(ativo, conexao)")
        .eq("profile_id", d.id).eq("lista", "interna").eq("ativo", true).eq("profiles.status", "active")
        .eq("whatsapp_canais.ativo", true).eq("whatsapp_canais.conexao", "whatsapp_web")
        .limit(1).maybeSingle<{ id: string; canal_id: string; nome: string | null }>();
      if (!contato) continue;
      const { error: eW } = await admin.from("whatsapp_agendados").insert({
        organization_id: org, canal_id: contato.canal_id, contato_id: contato.id,
        para_nome: (contato.nome || d.nome || "Chefe").slice(0, 120), quando: new Date().toISOString(),
        texto: t.whatsapp, criado_por_nome: "SARA (Produção)",
      });
      if (eW) console.error("[faltas] não agendou o WhatsApp", eW.message); else rel.whatsapp++;
    }
  }
  return rel;
}
