import { NextResponse } from "next/server";
import { exigirDocumentos } from "../../../../../lib/documentos/acesso";

export const dynamic = "force-dynamic";

/** Arquivar: some da lista; o arquivo e o histórico continuam guardados. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await exigirDocumentos();
  if ("error" in guard) return guard.error;
  const { error } = await guard.supabase.rpc("company_document_archive", { p_id: id });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível arquivar." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
