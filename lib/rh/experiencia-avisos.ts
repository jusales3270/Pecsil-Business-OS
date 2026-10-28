import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { agoraSP } from "../sara/tempo";
import { AVISO_EXPERIENCIA_DIAS, fraseDoAviso } from "./experiencia";

/**
 * Aviso no sino do fim da experiência (proprietário, 28/10/2026). A tarefa de 10 em 10 minutos (a mesma do
 * Bom dia) chama isto todos os dias, a partir das 7h30: quem está a 2 dias (ou menos) do fim do período
 * gera um aviso para quem decide no RH (sara_responsaveis), uma vez só por colaborador e data de fim
 * (rh_experiencia_avisos). O mesmo aviso entra no Bom dia (sino e WhatsApp) pela regra da SARA do RH.
 */

const A_PARTIR_DE = "07:30";
type Linha = { id: string; organization_id: string; full_name: string; experiencia_dias: number; experiencia_fim: string };

export async function avisarFimDeExperiencia(admin: SupabaseClient, agora: Date = new Date(), o: {
  /** Teste: quem recebe no lugar de quem decide no RH, e só estes colaboradores (nunca avisa quem trabalha). */
  para?: string[]; somenteColaboradores?: string[];
} = {}): Promise<{ avisados: number; erro?: string }> {
  const sp = agoraSP(agora);
  if (sp.hora < A_PARTIR_DE) return { avisados: 0 };
  const hoje = sp.dia;
  const ate = new Date(Date.parse(`${hoje}T12:00:00Z`) + AVISO_EXPERIENCIA_DIAS * 86_400_000).toISOString().slice(0, 10);
  let q = admin.from("employees").select("id, organization_id, full_name, experiencia_dias, experiencia_fim")
    .eq("contract_type", "experiencia").eq("active", true).is("termination_date", null).gte("experiencia_fim", hoje).lte("experiencia_fim", ate).limit(200);
  if (o.somenteColaboradores) q = q.in("id", o.somenteColaboradores);
  const { data, error } = await q;
  if (error) return { avisados: 0, erro: error.message };
  let avisados = 0;
  for (const e of (data ?? []) as Linha[]) {
    // Só quem decide no RH; sem responsável cadastrado, não vai a ninguém (nunca ao proprietário por padrão).
    const { data: resp } = await admin.from("sara_responsaveis").select("profile_id, profiles!inner(status)").eq("organization_id", e.organization_id).eq("modulo", "rh").eq("profiles.status", "active");
    const para = o.para ?? ((resp ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
    if (!para.length) continue;
    // Marca antes de avisar: duas rodadas ao mesmo tempo não avisam duas vezes.
    const { data: marcou } = await admin.from("rh_experiencia_avisos").upsert({ employee_id: e.id, vence: e.experiencia_fim }, { onConflict: "employee_id,vence", ignoreDuplicates: true }).select("employee_id");
    if (!marcou?.length) continue;
    const { error: eN } = await admin.from("notifications").insert(para.map((pid) => ({
      organization_id: e.organization_id, recipient_profile_id: pid, module_code: "rh", severity: "attention",
      title: `Experiência vencendo: ${e.full_name}`.slice(0, 200),
      body: fraseDoAviso({ nome: e.full_name, periodo: e.experiencia_dias, fim: e.experiencia_fim, hoje }).slice(0, 600),
      action_url: `/?module=rh&secao=${encodeURIComponent("Colaboradores")}`,
    })));
    if (eN) {
      // Não avisou: desfaz a marca para tentar de novo na próxima rodada.
      await admin.from("rh_experiencia_avisos").delete().eq("employee_id", e.id).eq("vence", e.experiencia_fim);
      console.error("[rh] aviso de experiência não saiu", e.id, eN.message);
      continue;
    }
    avisados++;
  }
  return { avisados };
}
