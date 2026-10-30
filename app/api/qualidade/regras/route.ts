import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Tipos de não conformidade e uso da gravidade (quem aprova, na área de Qualidade). */
export async function PUT(request: Request) {
  const guard = await requireFeature("qualidade.nao_conformidades", "aprovar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as { tipos?: string[]; usarGravidade?: boolean; gravidades?: string[] };
  const { error } = await guard.supabase.rpc("qualidade_salvar_regras", {
    p_tipos: Array.isArray(b.tipos) ? b.tipos.map(String) : [], p_usar_gravidade: b.usarGravidade === true, p_gravidades: Array.isArray(b.gravidades) ? b.gravidades.map(String) : [],
  });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
