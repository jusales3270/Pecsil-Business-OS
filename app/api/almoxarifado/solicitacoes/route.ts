import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { COLUNAS_PEDIDO, itensDoPedido, pedidoParaTela, type PedidoLinha } from "../../../../lib/almoxarifado/pedidos";

export const dynamic = "force-dynamic";

const LEITURA = ["almoxarifado.solicitacoes", "almoxarifado.recebimento"];

/** Pedidos de material, com itens, dos últimos meses (mais recentes primeiro). O Almoxarifado vê também os da Fundição: recebe tudo. */
export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase
    .from("material_requests")
    .select(COLUNAS_PEDIDO)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) {
    console.error("Falha ao ler pedidos de material", error);
    return NextResponse.json({ error: "ALMOXARIFADO_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    canRequest: guard.access.can("almoxarifado.solicitacoes", "operar"),
    canReceive: guard.access.can("almoxarifado.recebimento", "operar"),
    requests: ((data ?? []) as PedidoLinha[]).map(pedidoParaTela),
  });
}

/** Novo pedido de material: avisa quem cota no Compras. */
export async function POST(request: Request) {
  const guard = await requireFeature("almoxarifado.solicitacoes", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { divisao?: string; urgencia?: string; observacao?: string; precisaAte?: string | null; itens?: Parameters<typeof itensDoPedido>[0] };
  const precisaAte = typeof body.precisaAte === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.precisaAte) ? body.precisaAte : null;

  const lidos = itensDoPedido(body.itens);
  if ("erro" in lidos) return NextResponse.json({ error: lidos.erro }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("almoxarifado_criar_solicitacao", {
    p_divisao: body.divisao === "FUNDICAO" ? "FUNDICAO" : "USINAGEM",
    p_urgencia: body.urgencia === "urgente" ? "urgente" : "normal",
    p_observacao: body.observacao ?? "",
    p_itens: lidos.itens,
    p_precisa_ate: precisaAte,
  });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar o pedido." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data, { status: 201 });
}
