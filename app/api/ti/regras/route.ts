import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { erroDoBanco } from "../../../../lib/ti/servidor";

export const dynamic = "force-dynamic";

/** Categorias e prazos dos chamados (quem aprova chamados — o supervisor de TI). */
export async function PUT(request: Request) {
  const guard = await requireFeature("ti.chamados", "aprovar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as { categorias?: string[]; prazos?: Record<string, number> };
  const { error } = await guard.supabase.rpc("ti_salvar_regras", { p_categorias: Array.isArray(b.categorias) ? b.categorias.map(String) : [], p_prazos: b.prazos ?? {} });
  if (error) return erroDoBanco(error, "Não foi possível salvar as regras.");
  return NextResponse.json({ ok: true });
}
