import { NextResponse, after } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import { processarEnviosForja } from "../../../../../../lib/forja/envio-os";
import { createSupabaseAdminClient } from "../../../../../../lib/supabase/admin";

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
  // Ganho/reaberto/cancelado: a OS em rascunho na Forja é criada ou cancelada já, sem esperar a
  // sincronização de 10 minutos (e sem prender a resposta; se a Forja falhar, a sincronização tenta de novo).
  if (corpo.situacao === "ganho" || corpo.situacao === "rascunho" || corpo.situacao === "cancelado") {
    after(async () => {
      try { await processarEnviosForja(createSupabaseAdminClient(), { quoteId: id }); } catch (e) { console.error("Envio à Forja depois da situação", e instanceof Error ? e.message : e); }
    });
  }
  return NextResponse.json({ ok: true });
}
