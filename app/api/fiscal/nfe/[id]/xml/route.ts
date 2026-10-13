import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Baixar o XML: o autorizado (nota + protocolo) ou, antes disso, o gerado na validação. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.nfe", "ver");
  if ("error" in guard) return guard.error;
  const { data: n } = await guard.supabase.from("fiscal_nfe").select("ambiente, chave, xml, xml_autorizado").eq("id", id).maybeSingle();
  if (!n) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  const xml = n.xml_autorizado ?? n.xml;
  if (!xml) return NextResponse.json({ error: "Valide a nota para gerar o XML." }, { status: 404 });
  const nome = `${n.ambiente === "treino" ? "TREINO-" : ""}${n.chave ?? id}${n.xml_autorizado ? "-procNFe" : ""}.xml`;
  return new NextResponse(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store" },
  });
}
