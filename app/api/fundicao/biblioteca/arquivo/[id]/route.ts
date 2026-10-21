import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";
import { lerArquivo } from "../../../../../../lib/fundicao/biblioteca-servidor";

export const dynamic = "force-dynamic";

/**
 * Abre (na tela) ou baixa (?baixar=1) um arquivo da Biblioteca. A função do banco confere a
 * permissão com a sessão e, ao baixar, registra no histórico quem baixou.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("fundicao.biblioteca", "ver");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  const baixar = new URL(request.url).searchParams.get("baixar") === "1";
  const { data, error } = await guard.supabase.rpc("fundicao_arquivo_abrir", { p_arquivo: id, p_baixar: baixar });
  if (error) return error.message.includes("não encontrado") ? NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 }) : dbError(error);
  const a = data as { storage_path: string; mime: string | null; nome: string | null };
  try {
    const arquivo = await lerArquivo(a.storage_path);
    const nome = a.nome || "desenho";
    return new Response(arquivo.stream(), {
      headers: {
        "Content-Type": a.mime || "application/octet-stream",
        "Content-Length": String(arquivo.size),
        "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("Falha ao ler arquivo da Biblioteca", e);
    return NextResponse.json({ error: "Não foi possível abrir o arquivo agora." }, { status: 503 });
  }
}
