import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import { icmsColunas } from "../../../../../../lib/fiscal/icms-campos";
import { fornecedorDaNota, lerNotaDoArquivo, type FornecedorCadastro } from "../../../../../../lib/fiscal/nota-carga";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MES = /^\d{4}-\d{2}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Lançar no Painel do ICMS" a partir de uma nota recebida da SEFAZ: lê o XML completo que já está
 * em Documentos e lança como o "Enviar notas" do painel faria (mesmas regras e mesmo formato).
 * Centro e tipo ficam para a pessoa completar no painel. O XML se liga à linha nova sozinho (a
 * rodada das ligações roda de novo para ele).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => ({}))) as { mes?: string; recebida?: string };
  const mes = String(corpo.mes ?? new Date().toISOString().slice(0, 7));
  const recebida = String(corpo.recebida ?? new Date().toISOString().slice(0, 10));
  if (!MES.test(mes) || !DIA.test(recebida)) return NextResponse.json({ error: "Mês ou data de recebimento inválidos." }, { status: 400 });

  const { data: nota } = await guard.supabase.from("fiscal_dfe").select("id, chave, document_id, situacao, organization_id").eq("id", id).maybeSingle();
  if (!nota) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  if (nota.situacao !== "autorizada") return NextResponse.json({ error: `Esta nota está ${nota.situacao} na SEFAZ: não entra no painel.` }, { status: 409 });
  if (!nota.document_id) return NextResponse.json({ error: "O XML completo ainda não chegou. Dê ciência na nota e aguarde a próxima busca." }, { status: 409 });
  const { data: ja } = await guard.supabase.from("fiscal_icms_entries").select("id").eq("chave", nota.chave).maybeSingle();
  if (ja) return NextResponse.json({ error: "Esta nota já está no Painel do ICMS." }, { status: 409 });

  const admin = createSupabaseAdminClient();
  const { data: doc } = await admin.from("company_documents").select("storage_path").eq("id", nota.document_id).eq("organization_id", nota.organization_id).maybeSingle();
  const baixado = doc ? await admin.storage.from("empresa-documentos").download(doc.storage_path) : null;
  if (!baixado?.data) return NextResponse.json({ error: "Não foi possível abrir o XML guardado." }, { status: 503 });
  let lida;
  try {
    lida = await lerNotaDoArquivo(new Uint8Array(await baixado.data.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "Não consegui ler o XML desta nota." }, { status: 422 });
  }
  const n = lida.nfe;
  const { data: cadastro } = await guard.supabase.from("suppliers").select("id, name, tax_id").is("merged_into", null).limit(5000);
  const fornecedor = fornecedorDaNota(n, (cadastro ?? []) as FornecedorCadastro[]);
  const resultado = icmsColunas({
    competencia: mes, emitida: n.emissao || null, recebida, fornecedor: n.emitente.nome || "Fornecedor", fantasia: fornecedor?.nome ?? null,
    cnpj: n.emitente.cnpj || null, nfe: n.numero || null, serie: n.serie || null, chave: n.chave,
    valor: n.valorNota, vlrCobrado: n.valorNota, baseIcms: n.baseIcms, icms: n.icms, ipi: n.ipi, xmlOk: true,
    obs: "Veio da SEFAZ (Notas recebidas).",
  });
  if ("erro" in resultado) return NextResponse.json({ error: resultado.erro }, { status: 400 });
  const { data: criada, error } = await guard.supabase.from("fiscal_icms_entries")
    .insert({ ...resultado.colunas, origem: "manual", supplier_id: fornecedor?.id ?? null }).select("id").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Esta nota já está no Painel do ICMS." : "Não foi possível lançar." }, { status: 400 });
  if (fornecedor?.gravarCnpj && n.emitente.cnpj) {
    await guard.supabase.rpc("supplier_set_tax_id_from_nfe", { p_supplier: fornecedor.id, p_cnpj: n.emitente.cnpj });
  }
  await admin.from("company_document_texts").update({ linked_at: null }).eq("document_id", nota.document_id);
  return NextResponse.json({ id: criada.id, mensagem: `NF ${n.numero} de ${n.emitente.nome} lançada no Painel do ICMS (${mes.slice(5)}/${mes.slice(0, 4)}). Complete centro e tipo no painel.` });
}
