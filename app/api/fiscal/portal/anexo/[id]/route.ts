import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../../lib/auth/feature-guard";
import { linkDeDownload } from "../../../../../../lib/documentos/guardar";

export const dynamic = "force-dynamic";

/**
 * Baixar um anexo do portal. O banco confere que o documento é do portal e registra o download na
 * auditoria (quem, quando, qual arquivo) antes de liberar; o link dura 60 segundos.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("fiscal_portal_baixar", { p_document: id });
  const arquivo = (Array.isArray(data) ? data[0] : data) as { storage_path: string; original_name: string } | null;
  if (error || !arquivo) return NextResponse.json({ error: "Arquivo não encontrado no portal." }, { status: error?.code === "42501" ? 403 : 404 });
  try {
    return NextResponse.redirect(await linkDeDownload(arquivo.storage_path, arquivo.original_name), 302);
  } catch {
    return NextResponse.json({ error: "Não foi possível abrir o arquivo agora." }, { status: 503 });
  }
}
