import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { lerNotaDevolvivel } from "../../../../../lib/fiscal/emissao/devolucao";
import { chaveValida } from "../../../../../lib/fiscal/emissao/regras";
import { autorDaSessao } from "../../../../../lib/fiscal/emissao/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fiscal › Notas emitidas › devolução: os itens da nota devolvida, pela chave de acesso, quando o XML dela está
 * na plataforma (enviado pelo Fiscal ou pelo Almoxarifado, recebido da SEFAZ ou emitido aqui). Só leitura.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fiscal.nfe", "ver");
  if ("error" in guard) return guard.error;
  const chave = (new URL(request.url).searchParams.get("chave") ?? "").replace(/\D/g, "");
  if (!chaveValida(chave)) return NextResponse.json({ error: "Chave de acesso inválida (44 dígitos com o dígito verificador)." }, { status: 400 });
  const autor = await autorDaSessao(guard.supabase);
  if (!autor) return NextResponse.json({ error: "Sessão sem organização." }, { status: 400 });
  const admin = createSupabaseAdminClient();

  let xml: string | null = null;
  const { data: emitida } = await admin.from("fiscal_nfe").select("xml_autorizado").eq("organization_id", autor.org).eq("chave", chave).not("xml_autorizado", "is", null).limit(1).maybeSingle();
  if (emitida?.xml_autorizado) xml = String(emitida.xml_autorizado);
  if (!xml) {
    const [{ data: lida }, { data: dfe }] = await Promise.all([
      admin.from("fiscal_ibscbs_notas").select("document_id").eq("organization_id", autor.org).eq("chave", chave).not("document_id", "is", null).limit(1).maybeSingle(),
      admin.from("fiscal_dfe").select("document_id").eq("organization_id", autor.org).eq("chave", chave).not("document_id", "is", null).limit(1).maybeSingle(),
    ]);
    const documento = lida?.document_id ?? dfe?.document_id;
    if (documento) {
      const { data: doc } = await admin.from("company_documents").select("storage_path").eq("id", documento).eq("organization_id", autor.org).maybeSingle();
      const { data: blob } = doc ? await admin.storage.from("empresa-documentos").download(doc.storage_path) : { data: null };
      if (blob) xml = await blob.text();
    }
  }
  const nota = xml ? lerNotaDevolvivel(xml) : null;
  if (!nota || nota.chave !== chave) return NextResponse.json({ error: "O XML desta nota não está na plataforma. Preencha os itens à mão, com o número de cada item na nota original." }, { status: 404 });
  return NextResponse.json({ nota }, { headers: { "Cache-Control": "no-store" } });
}
