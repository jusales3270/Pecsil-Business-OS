import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/** Confirmar ou descartar uma ligação de documento. O banco confere quem pode (setor + alvo). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const body = (await request.json().catch(() => ({}))) as { decisao?: string };
  if (body.decisao !== "confirmada" && body.decisao !== "descartada") return NextResponse.json({ error: "Decisão inválida." }, { status: 400 });
  const { error } = await session.supabase.rpc("company_document_link_decide", { p_id: id, p_decisao: body.decisao });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar a decisão." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
