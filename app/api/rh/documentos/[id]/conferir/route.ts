import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Conferência de documento do RH (R-01): aprovar ou reprovar (com motivo). O banco confere a permissão. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("rh.documentos", "aprovar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const corpo = (await request.json().catch(() => null)) as { decisao?: string; motivo?: string } | null;
  if (!corpo || (corpo.decisao !== "aprovado" && corpo.decisao !== "reprovado")) return NextResponse.json({ error: "Decisão inválida." }, { status: 400 });
  const { error } = await guard.supabase.rpc("rh_documento_conferir", { p_id: id, p_decisao: corpo.decisao, p_motivo: corpo.motivo ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
