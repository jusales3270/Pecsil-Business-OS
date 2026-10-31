import { NextResponse } from "next/server";
import { exigirDocumentos } from "../../../../../lib/documentos/acesso";
import { entregarArquivo } from "../../../../../lib/documentos/entregar";

export const dynamic = "force-dynamic";

/**
 * Baixar (ou, com ?ver=1 e ?danfe=1, ver na janela da plataforma): a sessão confere (RLS) que a pessoa vê o documento,
 * e o arquivo sai pela própria plataforma.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await exigirDocumentos();
  if ("error" in guard) return guard.error;
  const { data } = await guard.supabase.from("company_documents").select("storage_path, original_name").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  try {
    const parametros = new URL(request.url).searchParams;
    return await entregarArquivo(data.storage_path, data.original_name, parametros.get("danfe") === "1" ? "danfe" : parametros.get("ver") === "1" ? "ver" : "baixar");
  } catch (e) {
    console.error("Falha ao abrir documento", e);
    return NextResponse.json({ error: "Não foi possível abrir o arquivo agora." }, { status: 503 });
  }
}
