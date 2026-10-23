import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Documentos da SARA central. GET: os que a pessoa recebeu ("Documentos para você"); com `?todos=1`, os
 * da War Room (o que a central gerou, para quem foi e se abriram), só para quem tem a SARA central.
 */
export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  if (new URL(request.url).searchParams.get("todos") !== "1") {
    const { data, error } = await session.supabase.rpc("sara_documentos_recebidos");
    if (error) return NextResponse.json({ error: "Não foi possível carregar os documentos." }, { status: 500 });
    return NextResponse.json({ documentos: data ?? [] });
  }
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access?.can("warroom.sara", "ver")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data, error } = await session.supabase.from("sara_documentos")
    .select("id, numero, tipo, titulo, paginas, criado_por_nome, created_at, sara_documento_envios(para_nome, canal, enviado_em, aberto_em)")
    .order("created_at", { ascending: false }).limit(60);
  if (error) return NextResponse.json({ error: "Não foi possível carregar os documentos." }, { status: 500 });
  return NextResponse.json({ documentos: data ?? [] });
}
