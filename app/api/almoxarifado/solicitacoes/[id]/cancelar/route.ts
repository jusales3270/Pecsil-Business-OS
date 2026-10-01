import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Cancela o pedido antes da compra; se já estava em cotação, o Compras é avisado. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("almoxarifado.solicitacoes", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { motivo?: string };
  const { error } = await guard.supabase.rpc("almoxarifado_cancelar_solicitacao", { p_request: id, p_motivo: body.motivo ?? "" });
  if (error) return NextResponse.json({ error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível cancelar." }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
