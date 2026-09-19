import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

export type ModuleEvent = {
  id: number;
  module: string;
  type: string;
  summary: string;
  actor: string | null;
  occurredAt: string;
};

/**
 * Linha do tempo da trilha de eventos. Filtros: ?module=compras&type=...&days=30.
 * O RLS de module_events só entrega a quem tem Fundação › Eventos.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("fundacao.eventos");
  if ("error" in guard) return guard.error;
  const params = new URL(request.url).searchParams;
  const days = Math.min(Math.max(Number(params.get("days")) || 30, 1), 365);

  let query = guard.supabase
    .from("module_events")
    .select("id, module_code, event_type, summary, actor_name, occurred_at")
    .gte("occurred_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(300);
  const moduleCode = params.get("module");
  const type = params.get("type");
  if (moduleCode) query = query.eq("module_code", moduleCode);
  if (type) query = query.eq("event_type", type);

  const { data, error } = await query;
  if (error) return dbError(error);
  return NextResponse.json({
    events: (data ?? []).map((row) => ({
      id: row.id, module: row.module_code, type: row.event_type, summary: row.summary,
      actor: row.actor_name, occurredAt: row.occurred_at,
    })) satisfies ModuleEvent[],
  });
}
