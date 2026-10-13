import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/** Remover um aparelho: a própria pessoa ou o proprietário (o banco confere e registra na auditoria). */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sessao = await requireUserSession();
  if ("error" in sessao && sessao.error) return sessao.error;
  const { error } = await sessao.supabase.rpc("access_passkey_revogar", { p_id: id });
  if (error) return NextResponse.json({ error: error.message || "Não foi possível remover." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
