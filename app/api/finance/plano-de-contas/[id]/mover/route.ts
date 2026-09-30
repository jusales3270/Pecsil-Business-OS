import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import { chartError } from "../../../../../../lib/finance/plano-contas-db";

export const dynamic = "force-dynamic";

/** Move a conta (com as subcontas) para outro grupo; ela assume o próximo código do destino. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("financeiro.plano", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { parentId?: string | null };
  const { data, error } = await guard.supabase.rpc("finance_move_account", { p_account: id, p_parent: body.parentId || null });
  if (error) { const e = chartError(error); return NextResponse.json({ error: e.error }, { status: e.status }); }
  return NextResponse.json({ code: data });
}
