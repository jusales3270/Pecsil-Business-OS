import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** RH › Férias e ausências › Mapa por setor (R-03): setores, férias na janela de 12 meses e concessivos. */
export async function GET() {
  const guard = await requireFeature("rh.ferias");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("rh_ferias_mapa");
  if (error) return NextResponse.json({ error: error.code === "42501" ? "Sem permissão para o mapa de férias." : "Não foi possível montar o mapa." }, { status: error.code === "42501" ? 403 : 500 });
  return NextResponse.json(data);
}
