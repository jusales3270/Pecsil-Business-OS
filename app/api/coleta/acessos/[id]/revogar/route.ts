import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Revoga o aceite: encerra o registro (a permissão do navegador some ao fechar a página). */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fundacao.coleta", "ver");
  if ("error" in guard) return guard.error;
  const { error } = await guard.supabase.rpc("file_collection_revoke", { p_id: id });
  if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "Não foi possível revogar." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
