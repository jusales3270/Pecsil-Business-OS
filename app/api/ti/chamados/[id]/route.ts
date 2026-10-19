import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../../lib/supabase/session";
import { erroDoBanco } from "../../../../../lib/ti/servidor";
import { COLUNAS_CHAMADO } from "../../../../../lib/ti/colunas";

export const dynamic = "force-dynamic";

/** O chamado e o histórico (quem abriu ou a TI; o RLS decide). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const [chamado, andamentos] = await Promise.all([
    session.supabase.from("ti_chamados").select(COLUNAS_CHAMADO).eq("id", id).maybeSingle(),
    session.supabase.from("ti_chamado_andamentos").select("id, autor_id, autor_nome, tipo, texto, created_at").eq("chamado_id", id).order("created_at"),
  ]);
  if (chamado.error || andamentos.error) return NextResponse.json({ error: "TI_UNAVAILABLE" }, { status: 503 });
  if (!chamado.data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ chamado: chamado.data, andamentos: andamentos.data ?? [] });
}

/** Andamento: comentar, assumir, aguardar, resolver, reabrir, cancelar, reclassificar. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const b = (await request.json().catch(() => ({}))) as { acao?: string; texto?: string; extra?: Record<string, unknown> };
  const { error } = await session.supabase.rpc("ti_chamado_acao", { p_chamado: id, p_acao: b.acao ?? "", p_texto: b.texto ?? "", p_extra: b.extra ?? {} });
  if (error) return erroDoBanco(error, "Não foi possível registrar o andamento.");
  return NextResponse.json({ ok: true });
}
