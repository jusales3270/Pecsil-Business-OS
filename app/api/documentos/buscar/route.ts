import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Documentos para a Busca Corporativa (Etapa 5): os mais relevantes, com o trecho achado. Roda com
 * a sessão de quem pesquisa (o banco só entrega o que ela pode abrir). Quem não vê documento
 * nenhum recebe lista vazia, não erro: a Busca Corporativa é de todos.
 */
export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ documentos: [] });
  const { data, error } = await session.supabase.rpc("company_document_search", { p_q: q, p_setor: null, p_limite: 8 });
  if (error) {
    console.error("Falha na busca corporativa de documentos", error);
    return NextResponse.json({ documentos: [], error: "BUSCA_INDISPONIVEL" }, { status: 503 });
  }
  return NextResponse.json({ documentos: data ?? [] });
}
