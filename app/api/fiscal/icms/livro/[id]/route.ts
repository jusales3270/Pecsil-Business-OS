import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Remove uma linha do livro de apuração. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("fiscal_icms_ledger").delete().eq("id", id).select("id");
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "Linha não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
