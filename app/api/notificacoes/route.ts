import { NextResponse } from "next/server";
import { requireUserSession } from "../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Avisos da pessoa logada (public.notifications). A regra do banco só deixa ler
 * e marcar os próprios, então não há filtro de destinatário aqui.
 */
export async function GET() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const [list, unread] = await Promise.all([
    session.supabase
      .from("notifications")
      .select("id, module_code, severity, title, body, action_url, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(60),
    session.supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (list.error) {
    console.error("Falha ao ler avisos", list.error);
    return NextResponse.json({ error: "NOTIFICATIONS_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    unread: unread.count ?? 0,
    items: (list.data ?? []).map((row) => ({
      id: row.id,
      module: row.module_code,
      severity: row.severity,
      title: row.title,
      body: row.body,
      actionUrl: row.action_url,
      read: Boolean(row.read_at),
      createdAt: row.created_at,
    })),
  });
}

/** Marca como lido: `{ ids: [...] }` ou `{ all: true }`. */
export async function PATCH(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  if (!ids.length && body.all !== true) return NextResponse.json({ error: "Informe os avisos." }, { status: 400 });
  let query = session.supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (ids.length) query = query.in("id", ids);
  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
