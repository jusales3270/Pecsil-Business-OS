import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { copiarQuedas, erroDoBanco } from "../../../../lib/ti/servidor";

export const dynamic = "force-dynamic";

/** Histórico de quedas e falhas (do vigia e registradas pela TI), mais recentes primeiro. */
export async function GET(request: Request) {
  const guard = await requireFeature("ti.saude", "ver");
  if ("error" in guard) return guard.error;
  const dias = Math.min(800, Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 90));
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  await copiarQuedas((org as string | null) ?? null);
  const { data, error } = await guard.supabase
    .from("ti_incidentes")
    .select("id, origem, alvo, alvo_nome, ativo_id, inicio, fim, categoria, causa_vigia, causa, descricao, confirmado_por_nome, confirmado_em, ti_ativos(numero, nome)")
    .gte("inicio", new Date(Date.now() - dias * 86_400_000).toISOString())
    .order("inicio", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("TI: falha ao ler incidentes", error);
    return NextResponse.json({ error: "TI_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ dias, incidentes: data ?? [], podeRegistrar: guard.access.can("ti.saude", "operar") });
}

/** Registra um incidente à mão ou confirma a causa de um do vigia (com `id`). */
export async function POST(request: Request) {
  const guard = await requireFeature("ti.saude", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { data, error } = await guard.supabase.rpc("ti_salvar_incidente", { p: body });
  if (error) return erroDoBanco(error, "Não foi possível salvar o incidente.");
  return NextResponse.json(data, { status: 201 });
}
