import { NextResponse } from "next/server";
import { BUCKET_DOCUMENTOS } from "../../../../../../lib/sara/central/documentos";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;
const TIPO: Record<string, { mime: string; ext: string }> = { mensagem_voz: { mime: "audio/mpeg", ext: "mp3" }, relatorio: { mime: "application/pdf", ext: "pdf" }, carta: { mime: "application/pdf", ext: "pdf" } };

/**
 * O arquivo de um documento da SARA central (o PDF ou o áudio da mensagem de voz). Quem pode abrir é decidido
 * pelo banco (RLS); o arquivo sai do bucket privado pelo servidor. `?baixar=1` baixa em vez de abrir.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const { data: doc } = await session.supabase.from("sara_documentos").select("id, numero, titulo, tipo, caminho").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Documento não encontrado ou sem permissão." }, { status: 404 });
  if (!doc.caminho) return NextResponse.json({ error: "O arquivo deste documento ainda não foi gerado." }, { status: 409 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  const { data: arquivo, error } = await admin.storage.from(BUCKET_DOCUMENTOS).download(doc.caminho);
  if (error || !arquivo) return NextResponse.json({ error: "Não foi possível abrir o arquivo." }, { status: 500 });
  await session.supabase.rpc("sara_documento_aberto", { p_documento: id });
  const t = TIPO[doc.tipo] ?? TIPO.relatorio;
  const nome = `${doc.numero} ${doc.titulo}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + `.${t.ext}`;
  const modo = new URL(request.url).searchParams.get("baixar") === "1" ? "attachment" : "inline";
  return new NextResponse(await arquivo.arrayBuffer(), { headers: {
    "content-type": t.mime, "cache-control": "private, no-store",
    "content-disposition": `${modo}; filename="${nome.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
  } });
}
