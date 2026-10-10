import { NextResponse } from "next/server";
import { requireFeature } from "../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const SITUACOES = ["pendente", "aceita", "recusada", "corrigida", "ignorada", "bloqueada", "erro"] as const;

/**
 * Fila de conferência das sugestões da IA (Fundação › Sugestões da IA). O banco (RLS) só
 * entrega as sugestões dos usos cujo módulo a pessoa pode ver. Junto, a taxa de acerto
 * de cada uso nos últimos 90 dias: aceitas / (aceitas + recusadas + corrigidas).
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fundacao.sugestoes", "ver");
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  const uso = url.searchParams.get("uso") ?? "";
  const situacao = url.searchParams.get("situacao") ?? "pendente";

  let consulta = guard.supabase
    .from("ai_judgments")
    .select("id, use_code, feature_code, entity_type, entity_id, state_summary, questions, answers, confidence, band, model, latency_ms, outcome, error_detail, decided_by_name, decided_at, decision_note, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (uso) consulta = consulta.eq("use_code", uso);
  if (situacao !== "todas" && (SITUACOES as readonly string[]).includes(situacao)) consulta = consulta.eq("outcome", situacao);
  const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data, error }, { data: historico }] = await Promise.all([
    consulta,
    guard.supabase.from("ai_judgments").select("use_code, outcome").gte("created_at", desde).limit(5000),
  ]);
  if (error) {
    console.error("Falha ao ler sugestões da IA", error);
    return NextResponse.json({ error: "SUGESTOES_UNAVAILABLE" }, { status: 503 });
  }

  const porUso: Record<string, { aceitas: number; recusadas: number; corrigidas: number; pendentes: number }> = {};
  for (const linha of historico ?? []) {
    const c = (porUso[linha.use_code] ??= { aceitas: 0, recusadas: 0, corrigidas: 0, pendentes: 0 });
    if (linha.outcome === "aceita") c.aceitas++;
    else if (linha.outcome === "recusada") c.recusadas++;
    else if (linha.outcome === "corrigida") c.corrigidas++;
    else if (linha.outcome === "pendente") c.pendentes++;
  }
  const acerto = Object.fromEntries(Object.entries(porUso).map(([codigo, c]) => {
    const decididas = c.aceitas + c.recusadas + c.corrigidas;
    return [codigo, { ...c, taxa: decididas ? c.aceitas / decididas : null }];
  }));

  return NextResponse.json({
    canDecide: guard.access.can("fundacao.sugestoes", "operar"),
    isOwner: guard.access.isOwner,
    items: data ?? [],
    acerto,
  });
}
