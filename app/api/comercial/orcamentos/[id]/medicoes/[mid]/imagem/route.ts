import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../../../../../lib/auth/feature-guard";
import { BUCKET_MEDICOES } from "../../../../../../../../lib/comercial/medidor-3d";
import { createSupabaseAdminClient } from "../../../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string; mid: string }> };

/**
 * Imagem de uma peça (destacada na montagem) ou da montagem inteira (?corpo=montagem). A sessão confere
 * (RLS) que a pessoa vê o orçamento; só então a chave de serviço lê a imagem.
 */
export async function GET(request: Request, context: Contexto) {
  const { id, mid } = await context.params;
  const guard = await requireAnyFeature(["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  const corpo = new URL(request.url).searchParams.get("corpo") ?? "montagem";
  const { data: m, error } = await guard.supabase.from("comercial_medicoes_3d").select("imagens").eq("id", mid).eq("quote_id", id).maybeSingle();
  if (error) return dbError(error);
  const caminho = (m?.imagens as Record<string, string> | undefined)?.[corpo];
  if (!caminho) return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });
  const { data: blob, error: e } = await createSupabaseAdminClient().storage.from(BUCKET_MEDICOES).download(caminho);
  if (e || !blob) return NextResponse.json({ error: "Imagem indisponível agora." }, { status: 503 });
  return new NextResponse(blob, { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
