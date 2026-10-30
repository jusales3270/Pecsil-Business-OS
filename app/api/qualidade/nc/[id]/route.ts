import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** A não conformidade completa: fotos, leitura da SARA e histórico. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("qualidade.nao_conformidades", "ver");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Não conformidade não encontrada." }, { status: 404 });
  const sb = guard.supabase;
  const [nc, andamentos] = await Promise.all([
    sb.from("qualidade_nao_conformidades").select("*, qualidade_nc_fotos(id, created_at)").eq("id", id).maybeSingle(),
    sb.from("qualidade_nc_andamentos").select("id, autor_nome, tipo, texto, created_at").eq("nc_id", id).order("created_at"),
  ]);
  if (nc.error || andamentos.error) return NextResponse.json({ error: "Não foi possível abrir agora." }, { status: 503 });
  if (!nc.data) return NextResponse.json({ error: "Não conformidade não encontrada." }, { status: 404 });
  return NextResponse.json({ nc: nc.data, andamentos: andamentos.data ?? [] });
}

/** Andamento: comentar, corrigir, encerrar, reabrir, cancelar. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("qualidade.nao_conformidades", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Não conformidade não encontrada." }, { status: 404 });
  const b = (await request.json().catch(() => ({}))) as { acao?: string; texto?: string; extra?: Record<string, unknown> };
  const { error } = await guard.supabase.rpc("qualidade_nc_acao", { p_nc: id, p_acao: b.acao ?? "", p_texto: b.texto ?? "", p_extra: b.extra ?? {} });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
