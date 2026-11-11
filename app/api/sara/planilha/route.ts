import { NextResponse } from "next/server";
import { abaDoVisual, visualDaTela } from "../../../../lib/sara/documentos/planilha";
import { gerarXlsx } from "../../../../lib/sara/documentos/xlsx";
import { MIME_XLSX } from "../../../../lib/sara/documentos/documento";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Baixar em Excel" numa tabela ou gráfico da SARA (I-27): a planilha do visual que a pessoa está vendo, sem criar
 * documento. Só para quem está na plataforma; o visual é o que a tela já mostra para ela.
 */
export async function POST(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const corpo = (await request.json().catch(() => null)) as { visual?: unknown } | null;
  const v = visualDaTela(corpo?.visual);
  if (!v) return NextResponse.json({ error: "Este visual não vira planilha." }, { status: 400 });
  const bytes = gerarXlsx([abaDoVisual(v)], v.titulo);
  const nome = `${v.titulo}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) + ".xlsx";
  return new NextResponse(Buffer.from(bytes), { headers: {
    "content-type": MIME_XLSX, "cache-control": "private, no-store",
    "content-disposition": `attachment; filename="${nome.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
  } });
}
