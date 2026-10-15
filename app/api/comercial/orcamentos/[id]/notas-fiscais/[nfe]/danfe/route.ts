import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../../../../lib/auth/feature-guard";
import { respostaDoErro } from "../../../../../../../../lib/fiscal/rotas";
import { obterTransmissor } from "../../../../../../../../lib/fiscal/transmissor";
import { createSupabaseAdminClient } from "../../../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DANFE de uma nota deste orçamento, para quem vê o orçamento (o Rafael confere o que foi faturado sem
 * acesso ao Fiscal). A ligação nota × orçamento é conferida pela função do banco com a permissão de
 * quem chama; só depois a chave de serviço lê o XML autorizado.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; nfe: string }> }) {
  const { id, nfe } = await context.params;
  const guard = await requireAnyFeature(["comercial.orcamentos", "producao.entrada", "fiscal.nfe"], "ver");
  if ("error" in guard) return guard.error;
  if (!/^[0-9a-f-]{36}$/i.test(nfe)) return NextResponse.json({ error: "Nota inválida." }, { status: 400 });
  const { data: notas, error } = await guard.supabase.rpc("comercial_orcamento_notas", { p_quote: id });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  if (!(notas as { nfe_id: string }[] | null)?.some((n) => n.nfe_id === nfe)) return NextResponse.json({ error: "Esta nota não é deste orçamento." }, { status: 404 });
  const { data: n } = await createSupabaseAdminClient().from("fiscal_nfe").select("ambiente, chave, xml_autorizado").eq("id", nfe).maybeSingle();
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
