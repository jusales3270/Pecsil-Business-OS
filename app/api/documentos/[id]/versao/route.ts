import { NextResponse } from "next/server";
import { exigirDocumentos, LIMITE_DOCUMENTO } from "../../../../../lib/documentos/acesso";
import { guardarOriginal } from "../../../../../lib/documentos/guardar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Nova versão de um documento (multipart: arquivo). A anterior fica no histórico. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await exigirDocumentos();
  if ("error" in guard) return guard.error;
  const { data: doc } = await guard.supabase.from("company_documents").select("id, module_code, feature_code, title, category").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  if (!guard.access.can(doc.feature_code, "operar")) return NextResponse.json({ error: "Sem permissão para alterar documentos deste setor." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Escolha o arquivo." }, { status: 400 });
  if (arquivo.size > LIMITE_DOCUMENTO) return NextResponse.json({ error: "O arquivo passa de 9,5 MB." }, { status: 413 });
  try {
    const r = await guardarOriginal(guard.supabase, {
      modulo: doc.module_code, feature: doc.feature_code, origem: "envio", anterior: doc.id, titulo: doc.title, categoria: doc.category,
      arquivo: { nome: arquivo.name, tipo: arquivo.type, dados: new Uint8Array(await arquivo.arrayBuffer()) },
    });
    return NextResponse.json({ ...r, mensagem: `Versão ${r.versao ?? ""} guardada.`.replace("  ", " ") }, { status: 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return NextResponse.json({ error: err.code === "P0001" || err.code === "42501" ? err.message : "Não foi possível guardar a nova versão." }, { status: err.code === "42501" ? 403 : 400 });
  }
}
