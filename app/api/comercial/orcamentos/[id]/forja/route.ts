import { NextResponse, after } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";
import { processarEnviosForja } from "../../../../../../lib/forja/envio-os";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

/** "Tentar de novo": os envios com erro deste orçamento voltam para a fila e saem já para a Forja. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("comercial_forja_reenviar", { p_quote: id });
  if (error) return dbError(error);
  after(async () => {
    try { await processarEnviosForja(createSupabaseAdminClient(), { quoteId: id }); } catch (e) { console.error("Reenvio à Forja", e instanceof Error ? e.message : e); }
  });
  return NextResponse.json({ reenviados: data ?? 0 });
}
