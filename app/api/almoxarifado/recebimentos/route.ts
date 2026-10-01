import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const MES = /^\d{4}-\d{2}$/;

/** Recebimentos do mês (AAAA-MM), mais recentes primeiro. */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["almoxarifado.recebimento", "almoxarifado.solicitacoes"]);
  if ("error" in guard) return guard.error;
  const mes = new URL(request.url).searchParams.get("mes") ?? new Date().toISOString().slice(0, 7);
  if (!MES.test(mes)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  const [ano, numero] = mes.split("-").map(Number);
  const fim = new Date(Date.UTC(ano, numero, 1)).toISOString().slice(0, 10);
  const { data, error } = await guard.supabase
    .from("receipts")
    .select("id, numero, cotacao_id, fornecedor, nf_numero, nf_serie, nf_chave, emissao, recebido_em, valor_total, icms, ipi, com_xml, encerra_pedido, divergencia, divergencia_motivo, observacao, received_by_name, material_requests(numero), receipt_installments(numero, vencimento, valor), receipt_items(descricao, quantidade, unidade, valor_total, ordem)")
    .gte("recebido_em", `${mes}-01`)
    .lt("recebido_em", fim)
    .order("recebido_em", { ascending: false })
    .order("numero", { ascending: false });
  if (error) {
    console.error("Falha ao ler recebimentos", error);
    return NextResponse.json({ error: "ALMOXARIFADO_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ mes, items: data ?? [] });
}

/** Confirma o recebimento: conta a pagar real, Painel do ICMS e avisos (tudo no banco, numa transação). */
export async function POST(request: Request) {
  const guard = await requireFeature("almoxarifado.recebimento", "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Dados do recebimento ausentes." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("almoxarifado_confirmar_recebimento", { p: body });
  if (error) {
    const conhecido = error.code === "P0001" || error.code === "42501";
    if (!conhecido) console.error("Falha ao confirmar recebimento", error);
    return NextResponse.json({ error: conhecido ? error.message : "Não foi possível gravar o recebimento." }, { status: error.code === "42501" ? 403 : 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
