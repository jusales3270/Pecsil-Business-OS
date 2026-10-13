import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const SITUACOES = new Set(["enviado", "ganho", "perdido", "cancelado", "rascunho"]);

/**
 * Mudar a situação: enviado, ganho (exige pedido do cliente e os anexos do pedido e da cotação;
 * gera a previsão a receber), perdido (com motivo), cancelado ou reabrir (rascunho). As regras
 * ficam no banco (comercial_orcamento_situacao).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { situacao?: string; motivo?: string } | null;
  if (!corpo?.situacao || !SITUACOES.has(corpo.situacao)) return NextResponse.json({ error: "Situação desconhecida." }, { status: 400 });
  const { error } = await guard.supabase.rpc("comercial_orcamento_situacao", { p_quote: id, p_situacao: corpo.situacao, p_motivo: corpo.motivo ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  return NextResponse.json({ ok: true });
}
