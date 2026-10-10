import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Decide uma sugestão: aceita, recusa, corrige (com a resposta certa) ou ignora. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fundacao.sugestoes", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { decisao?: string; nota?: string };
  const { error } = await guard.supabase.rpc("ai_judgment_decide", { p_id: id, p_outcome: body.decisao ?? "", p_note: body.nota ?? null });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar a decisão." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
