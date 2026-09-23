import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Unifica dois cadastros do mesmo cliente: os vínculos passam para o principal. */
export async function POST(request: Request) {
  const guard = await requireFeature("fundacao.cadastros", "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  if (!body.keepId || !body.dropId) return NextResponse.json({ error: "Escolha os dois clientes." }, { status: 400 });
  const { error } = await guard.supabase.rpc("merge_customers", { keep_id: body.keepId, drop_id: body.dropId });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
