import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { cobrarTarefas } from "../../../../lib/tarefas/cobranca";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FORJA_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cobrança das tarefas (I-28): chamada pela tarefa agendada de 10 em 10 minutos (scripts/sync-os-cron.mjs), com o
 * segredo FORJA_SYNC_SECRET. Fora de produção aceita { agora } para testar outro horário.
 */
export async function POST(request: Request) {
  if (!segredoConfere(request.headers.get("x-sync-secret"))) return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  let agora = new Date();
  if (process.env.NODE_ENV !== "production") {
    const corpo = (await request.json().catch(() => null)) as { agora?: string } | null;
    const a = corpo?.agora ? new Date(corpo.agora) : null;
    if (a && !Number.isNaN(a.getTime())) agora = a;
  }
  try {
    return NextResponse.json(await cobrarTarefas(admin, agora));
  } catch (e) {
    console.error("[tarefas] cobrança", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "A cobrança falhou." }, { status: 500 });
  }
}
