import { NextResponse } from "next/server";
import { requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const LEITURA = ["almoxarifado.solicitacoes", "almoxarifado.recebimento"];

/** Pedidos de material, com itens, dos últimos meses (mais recentes primeiro). */
export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase
    .from("material_requests")
    .select("id, numero, divisao, urgencia, observacao, status, requested_by_name, cancel_reason, created_at, updated_at, material_request_items(produto, quantidade, unidade, observacao, ordem)")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) {
    console.error("Falha ao ler pedidos de material", error);
    return NextResponse.json({ error: "ALMOXARIFADO_UNAVAILABLE" }, { status: 503 });
  }
  type Item = { produto: string; quantidade: number; unidade: string; observacao: string | null; ordem: number };
  return NextResponse.json({
    canRequest: guard.access.can("almoxarifado.solicitacoes", "operar"),
    canReceive: guard.access.can("almoxarifado.recebimento", "operar"),
    requests: (data ?? []).map((row) => ({
      id: row.id,
      numero: Number(row.numero),
      divisao: row.divisao,
      urgencia: row.urgencia,
      observacao: row.observacao,
      status: row.status,
      solicitante: row.requested_by_name,
      motivoCancelamento: row.cancel_reason,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
      itens: [...((row.material_request_items ?? []) as Item[])].sort((a, b) => a.ordem - b.ordem)
        .map((item) => ({ produto: item.produto, quantidade: Number(item.quantidade), unidade: item.unidade, observacao: item.observacao })),
    })),
  });
}

/** Novo pedido de material: avisa quem cota no Compras. */
export async function POST(request: Request) {
  const guard = await requireFeature("almoxarifado.solicitacoes", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as {
    divisao?: string; urgencia?: string; observacao?: string;
    itens?: { produto?: string; quantidade?: number; unidade?: string; observacao?: string }[];
  };
  const itens = (body.itens ?? []).filter((item) => item.produto?.trim());
  if (!itens.length) return NextResponse.json({ error: "Informe ao menos um item." }, { status: 400 });
  if (itens.some((item) => !(Number(item.quantidade) > 0))) return NextResponse.json({ error: "Toda linha precisa de quantidade." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("almoxarifado_criar_solicitacao", {
    p_divisao: body.divisao === "FUNDICAO" ? "FUNDICAO" : "USINAGEM",
    p_urgencia: body.urgencia === "urgente" ? "urgente" : "normal",
    p_observacao: body.observacao ?? "",
    p_itens: itens.map((item) => ({ produto: item.produto!.trim(), quantidade: Number(item.quantidade), unidade: item.unidade ?? "UN", observacao: item.observacao ?? "" })),
  });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível registrar o pedido." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data, { status: 201 });
}
