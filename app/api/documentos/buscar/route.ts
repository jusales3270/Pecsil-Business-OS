import { NextResponse } from "next/server";
import { buscarPorSentido } from "../../../../lib/significado/servidor";
import { juntarComSentido } from "../../../../lib/significado/trechos";
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
  // E pelo SENTIDO (Etapa 5B), fora os já achados por palavra; título e setor vêm do próprio banco (RLS).
  const porPalavra = (data ?? []) as { id: string; trecho: string | null; como: string }[];
  const ordem = juntarComSentido(porPalavra, await buscarPorSentido(session.supabase, q, null, new Set(), 4)).slice(0, 8);
  const faltam = ordem.filter((o) => !porPalavra.some((p) => p.id === o.id)).map((o) => o.id);
  const { data: docs } = faltam.length ? await session.supabase.from("company_documents").select("id, title, original_name, module_code, created_at").in("id", faltam) : { data: [] };
  const documentos = ordem.flatMap((o) => {
    const doc = porPalavra.find((p) => p.id === o.id) ?? (docs ?? []).find((x) => x.id === o.id);
    return doc ? [{ ...doc, trecho: o.trecho, como: o.como }] : [];
  });
  return NextResponse.json({ documentos });
}
