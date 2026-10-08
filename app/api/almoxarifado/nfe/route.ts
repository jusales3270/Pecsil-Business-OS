import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { NfeInvalida, lerNfe } from "../../../../lib/almoxarifado/nfe-xml";
import { PdfInvalido } from "../../../../lib/arquivos/pdf-texto";
import { DanfeInvalido } from "../../../../lib/fiscal/danfe-pdf";
import { NotaNaoReconhecida, fornecedorDaNota, lerNotaDoArquivo, pedidosDaNota, type FornecedorCadastro, type NotaLida, type PedidoACaminho } from "../../../../lib/fiscal/nota-carga";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE = 5_000_000;

/**
 * Lê a nota no servidor e devolve os dados para a conferência. Nada é gravado aqui:
 * a gravação acontece quando o almoxarife confirma o recebimento (ou quando o Fiscal
 * salva no Painel do ICMS).
 * Aceita o XML da NF-e ou o DANFE em PDF — em `multipart` (campo `arquivo`) ou, como
 * antes, JSON `{ xml }`. Devolve também o fornecedor do cadastro e os pedidos a caminho
 * que combinam com a nota.
 */
export async function POST(request: Request) {
  const guard = await requireAnyFeature(["almoxarifado.recebimento", "fiscal.icms"], "operar");
  if ("error" in guard) return guard.error;

  let lida: NotaLida;
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const arquivo = (await request.formData().catch(() => null))?.get("arquivo");
      if (!(arquivo instanceof File)) return NextResponse.json({ error: "Envie o XML ou o PDF da nota." }, { status: 400 });
      if (arquivo.size > LIMITE) return NextResponse.json({ error: "Arquivo grande demais para ser uma nota." }, { status: 413 });
      lida = await lerNotaDoArquivo(new Uint8Array(await arquivo.arrayBuffer()));
    } else {
      const body = (await request.json().catch(() => ({}))) as { xml?: unknown };
      if (typeof body.xml !== "string" || !body.xml.trim()) return NextResponse.json({ error: "Envie o arquivo XML da nota." }, { status: 400 });
      if (body.xml.length > LIMITE) return NextResponse.json({ error: "Arquivo grande demais para ser o XML de uma nota." }, { status: 413 });
      lida = { nfe: lerNfe(body.xml), origem: "xml", xml: body.xml, camposNaoLidos: [] };
    }
  } catch (error) {
    if ([NfeInvalida, NotaNaoReconhecida, DanfeInvalido, PdfInvalido].some((C) => error instanceof C)) return NextResponse.json({ error: (error as Error).message }, { status: 422 });
    console.error("Falha ao ler nota", error);
    return NextResponse.json({ error: "Não foi possível ler a nota." }, { status: 422 });
  }

  const nfe = lida.nfe;
  // Já lançada? Pela chave, no recebimento ou no Painel do ICMS.
  const [recebida, noIcms, cadastro, caminho] = await Promise.all([
    guard.supabase.from("receipts").select("numero, recebido_em").eq("nf_chave", nfe.chave).maybeSingle(),
    guard.supabase.from("fiscal_icms_entries").select("id, recebida").eq("chave", nfe.chave).maybeSingle(),
    guard.supabase.from("suppliers").select("id, name, tax_id").is("merged_into", null).limit(5000),
    guard.access.can("almoxarifado.recebimento", "operar") ? guard.supabase.rpc("almoxarifado_a_caminho") : Promise.resolve({ data: [] }),
  ]);
  const fornecedor = fornecedorDaNota(nfe, (cadastro.data ?? []) as FornecedorCadastro[]);
  const pedidos = pedidosDaNota(nfe, fornecedor, ((caminho as { data: unknown }).data ?? []) as PedidoACaminho[]);
  return NextResponse.json({
    nfe,
    origem: lida.origem,
    xml: lida.xml,
    camposNaoLidos: lida.camposNaoLidos,
    jaRecebida: recebida.data ? { numero: Number(recebida.data.numero), em: recebida.data.recebido_em } : null,
    jaNoIcms: Boolean(noIcms.data),
    fornecedor,
    pedidos,
  });
}
