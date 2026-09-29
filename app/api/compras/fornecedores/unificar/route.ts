import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Unifica dois cadastros do mesmo fornecedor pelo Compras (mesma função da Fundação). */
export async function POST(request: Request) {
  const guard = await requireFeature("compras.fornecedores", "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  if (!body.keepId || !body.dropId) return NextResponse.json({ error: "Escolha os dois fornecedores." }, { status: 400 });
  const { error } = await guard.supabase.rpc("merge_suppliers", { keep_id: body.keepId, drop_id: body.dropId });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
