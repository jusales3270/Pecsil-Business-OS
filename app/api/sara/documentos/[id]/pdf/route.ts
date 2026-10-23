import { NextResponse } from "next/server";
import { BUCKET_DOCUMENTOS } from "../../../../../../lib/sara/central/documentos";
import { nomeDoArquivo } from "../../../../../../lib/sara/documentos/documento";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * O PDF de um documento da SARA central. Quem pode ver é decidido pelo banco (RLS: quem criou, quem recebeu,
 * o proprietário e a auditoria); o arquivo sai do bucket privado pelo servidor. Quem recebeu, ao abrir, fica
 * marcado como "aberto".
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const { data: doc } = await session.supabase.from("sara_documentos").select("id, numero, titulo, caminho").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Documento não encontrado ou sem permissão." }, { status: 404 });
  if (!doc.caminho) return NextResponse.json({ error: "O PDF deste documento ainda não foi gerado." }, { status: 409 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  const { data: arquivo, error } = await admin.storage.from(BUCKET_DOCUMENTOS).download(doc.caminho);
  if (error || !arquivo) return NextResponse.json({ error: "Não foi possível abrir o PDF." }, { status: 500 });
  await session.supabase.rpc("sara_documento_aberto", { p_documento: id });
  const nome = nomeDoArquivo(doc.numero, doc.titulo);
  return new NextResponse(await arquivo.arrayBuffer(), { headers: {
    "content-type": "application/pdf", "cache-control": "private, no-store",
    "content-disposition": `inline; filename="${nome.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
  } });
}
