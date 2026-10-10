import { NextResponse } from "next/server";
import { exigirDocumentos } from "../../../../../lib/documentos/acesso";
import { linkDeDownload } from "../../../../../lib/documentos/guardar";

export const dynamic = "force-dynamic";

/** Baixar: a sessão confere (RLS) que a pessoa vê o documento; o link dura 60 segundos. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await exigirDocumentos();
  if ("error" in guard) return guard.error;
  const { data } = await guard.supabase.from("company_documents").select("storage_path, original_name").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  try {
    return NextResponse.redirect(await linkDeDownload(data.storage_path, data.original_name), 302);
  } catch (e) {
    console.error("Falha ao gerar link de documento", e);
    return NextResponse.json({ error: "Não foi possível abrir o arquivo agora." }, { status: 503 });
  }
}
