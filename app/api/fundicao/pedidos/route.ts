import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { COLUNAS_PEDIDO, itensDoPedido, pedidoParaTela, type PedidoLinha } from "../../../../lib/almoxarifado/pedidos";

export const dynamic = "force-dynamic";

/** Pedidos de material feitos pela Fundição (só os dela), mais recentes primeiro. */
export async function GET() {
  const guard = await requireFeature("fundicao.pedidos", "ver");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase
    .from("material_requests")
    .select(COLUNAS_PEDIDO)
    .eq("origem", "FUNDICAO")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) {
    console.error("Falha ao ler pedidos da Fundição", error);
    return NextResponse.json({ error: "FUNDICAO_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    canRequest: guard.access.can("fundicao.pedidos", "operar"),
    requests: ((data ?? []) as PedidoLinha[]).map(pedidoParaTela),
  });
}

/** Novo pedido da Fundição: vai para a divisão Fundição do Compras, assinado por quem pediu. */
export async function POST(request: Request) {
  const guard = await requireFeature("fundicao.pedidos", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { urgencia?: string; observacao?: string; itens?: Parameters<typeof itensDoPedido>[0] };
  const lidos = itensDoPedido(body.itens);
  if ("erro" in lidos) return NextResponse.json({ error: lidos.erro }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("fundicao_criar_pedido", {
    p_urgencia: body.urgencia === "urgente" ? "urgente" : "normal",
    p_observacao: body.observacao ?? "",
    p_itens: lidos.itens,
  });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar o pedido." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data, { status: 201 });
}
