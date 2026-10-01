import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { NfeInvalida, lerNfe } from "../../../../lib/almoxarifado/nfe-xml";

export const dynamic = "force-dynamic";

const LIMITE = 2_000_000;

/**
 * Lê o XML da NF-e no servidor e devolve os dados para a conferência. Nada é
 * gravado aqui: a gravação acontece quando o almoxarife confirma o recebimento.
 * Usado também pelo Painel do ICMS (nota lançada à mão por Jeferson ou Rosana).
 */
export async function POST(request: Request) {
  const guard = await requireAnyFeature(["almoxarifado.recebimento", "fiscal.icms"], "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { xml?: unknown };
  if (typeof body.xml !== "string" || !body.xml.trim()) return NextResponse.json({ error: "Envie o arquivo XML da nota." }, { status: 400 });
  if (body.xml.length > LIMITE) return NextResponse.json({ error: "Arquivo grande demais para ser o XML de uma nota." }, { status: 413 });
  try {
    const nfe = lerNfe(body.xml);
    // Já lançada? Pela chave, no recebimento ou no Painel do ICMS.
    const [recebida, noIcms] = await Promise.all([
      guard.supabase.from("receipts").select("numero, recebido_em").eq("nf_chave", nfe.chave).maybeSingle(),
      guard.supabase.from("fiscal_icms_entries").select("id, recebida").eq("chave", nfe.chave).maybeSingle(),
    ]);
    return NextResponse.json({
      nfe,
      jaRecebida: recebida.data ? { numero: Number(recebida.data.numero), em: recebida.data.recebido_em } : null,
      jaNoIcms: Boolean(noIcms.data),
    });
  } catch (error) {
    if (error instanceof NfeInvalida) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("Falha ao ler XML de NF-e", error);
    return NextResponse.json({ error: "Não foi possível ler o XML." }, { status: 422 });
  }
}
