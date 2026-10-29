import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../../lib/auth/feature-guard";
import { linkDeDownload } from "../../../../../../lib/documentos/guardar";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIPOS: Record<string, string> = { pdf: "application/pdf", xml: "text/plain; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8" };

/**
 * Um anexo do portal. O banco confere que o documento é do portal e registra o acesso na auditoria (quem,
 * quando, qual arquivo) antes de liberar.
 *   sem parâmetro → baixa o arquivo (link de 60 segundos);
 *   ?ver=1        → devolve o conteúdo pela própria plataforma, para a janela de visualização (PDF, XML, imagem).
 *                   XML vai como texto puro (a janela monta o resumo da nota) e nada do arquivo executa.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("fiscal_portal_baixar", { p_document: id });
  const arquivo = (Array.isArray(data) ? data[0] : data) as { storage_path: string; original_name: string } | null;
  if (error || !arquivo) return NextResponse.json({ error: "Arquivo não encontrado no portal." }, { status: error?.code === "42501" ? 403 : 404 });
  try {
    if (new URL(request.url).searchParams.get("ver") !== "1") return NextResponse.redirect(await linkDeDownload(arquivo.storage_path, arquivo.original_name), 302);
    const { data: blob, error: eArq } = await createSupabaseAdminClient().storage.from("empresa-documentos").download(arquivo.storage_path);
    if (eArq || !blob) throw eArq ?? new Error("sem arquivo");
    const extensao = arquivo.original_name.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(blob, {
      headers: {
        "content-type": TIPOS[extensao] ?? "application/octet-stream",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(arquivo.original_name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        // O arquivo é de quem enviou: fora o PDF (o leitor do navegador não roda em caixa fechada), nada dele executa aqui.
        ...(extensao === "pdf" ? {} : { "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:" }),
      },
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível abrir o arquivo agora." }, { status: 503 });
  }
}
