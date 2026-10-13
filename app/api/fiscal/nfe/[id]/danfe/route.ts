import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import { respostaDoErro } from "../../../../../../lib/fiscal/rotas";
import { obterTransmissor } from "../../../../../../lib/fiscal/transmissor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DANFE em PDF, gerado pelo transmissor a partir do XML autorizado. No treino (e na homologação)
 * sai com a marca "SEM VALOR FISCAL".
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.nfe", "ver");
  if ("error" in guard) return guard.error;
  const { data: n } = await guard.supabase.from("fiscal_nfe").select("ambiente, chave, xml_autorizado").eq("id", id).maybeSingle();
  if (!n) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  if (!n.xml_autorizado) return NextResponse.json({ error: "O DANFE sai depois de a nota ser autorizada." }, { status: 404 });
  try {
    const pdf = await obterTransmissor().danfe(n.xml_autorizado);
    const nome = `${n.ambiente === "treino" ? "TREINO-" : ""}DANFE-${n.chave}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${nome}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    return respostaDoErro(e, "Falha ao gerar o DANFE");
  }
}
