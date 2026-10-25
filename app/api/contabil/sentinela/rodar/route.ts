import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { rodarSentinela } from "../../../../../lib/contabil/sentinela/executar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sentinela (N-02). Quem chama é a tarefa agendada do Coolify (scripts/sync-os-cron.mjs, de 10 em 10 minutos),
 * com o segredo FORJA_SYNC_SECRET. Cada fonte só é lida quando passou a cadência dela.
 */
function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FORJA_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!segredoConfere(request.headers.get("x-sync-secret"))) return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  const r = await rodarSentinela(admin);
  return NextResponse.json(r, { status: r.erros.length && !r.itensNovos && !r.automaticos ? 207 : 200 });
}
