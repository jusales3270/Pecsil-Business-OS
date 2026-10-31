import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../../lib/auth/feature-guard";
import { entregarArquivo } from "../../../../../../lib/documentos/entregar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Um anexo do portal. O banco confere que o documento é do portal e registra o acesso na auditoria (quem,
 * quando, qual arquivo) antes de liberar.
 *   sem parâmetro → baixa o arquivo;
 *   ?ver=1        → devolve o conteúdo pela própria plataforma, para a janela de visualização (PDF, XML, imagem).
 *                   XML vai como texto puro (a janela monta o resumo da nota) e nada do arquivo executa.
 *   ?danfe=1      → XML de NF-e: o DANFE em PDF, gerado pelo transmissor (o mesmo das notas emitidas).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireAnyFeature(["fiscal.escritorio", "fiscal.portal"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("fiscal_portal_baixar", { p_document: id });
  const arquivo = (Array.isArray(data) ? data[0] : data) as { storage_path: string; original_name: string } | null;
  if (error || !arquivo) return NextResponse.json({ error: "Arquivo não encontrado no portal." }, { status: error?.code === "42501" ? 403 : 404 });
  const parametros = new URL(request.url).searchParams;
  try {
    return await entregarArquivo(arquivo.storage_path, arquivo.original_name, parametros.get("danfe") === "1" ? "danfe" : parametros.get("ver") === "1" ? "ver" : "baixar");
  } catch {
    return NextResponse.json({ error: "Não foi possível abrir o arquivo agora." }, { status: 503 });
  }
}
