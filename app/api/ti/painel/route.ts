import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { copiarQuedas, painelDoVigia } from "../../../../lib/ti/servidor";
import { resumoSaude } from "../../../../lib/ti/vigia.mjs";

export const dynamic = "force-dynamic";

/**
 * Painel de saúde da TI: o estado do servidor, do backup e dos testes de fora, lido agora do
 * vigia na nuvem, e o resumo das quedas dos últimos 30 dias (já copiadas para a plataforma).
 */
export async function GET() {
  const guard = await requireFeature("ti.saude", "ver");
  if ("error" in guard) return guard.error;
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  await copiarQuedas((org as string | null) ?? null);
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [lido, quedas, ativos] = await Promise.all([
    painelDoVigia(),
    guard.supabase.from("ti_incidentes").select("id, origem, alvo, alvo_nome, inicio, fim, categoria, causa_vigia, causa, confirmado_em").gte("inicio", desde).order("inicio", { ascending: false }).limit(500),
    guard.supabase.from("ti_ativos").select("id, tipo, critico, situacao"),
  ]);
  if (quedas.error || ativos.error) {
    console.error("TI: falha ao ler o painel", quedas.error ?? ativos.error);
    return NextResponse.json({ error: "TI_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    vigia: lido.ok ? { ok: true, saude: resumoSaude(lido.painel) } : { ok: false, erro: lido.erro },
    quedas30: quedas.data ?? [],
    ativos: {
      total: (ativos.data ?? []).filter((a) => a.situacao !== "baixado").length,
      criticos: (ativos.data ?? []).filter((a) => a.critico && a.situacao !== "baixado").length,
      manutencao: (ativos.data ?? []).filter((a) => a.situacao === "manutencao").length,
    },
    podeRegistrar: guard.access.can("ti.saude", "operar"),
  });
}
