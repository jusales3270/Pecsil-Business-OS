import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { vigiarConexoes } from "../../../../../lib/whatsapp/conexao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vigia da conexão dos números do WhatsApp (avisa o proprietário no sino se o chip cair). Quem chama é a tarefa agendada de 10 em 10 minutos
 * (scripts/sync-os-cron.mjs, de dentro do contêiner), com o segredo FORJA_SYNC_SECRET.
 * A resposta traz só contagens.
 */
function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FORJA_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!segredoConfere(request.headers.get("x-sync-secret"))) return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  try {
    return NextResponse.json(await vigiarConexoes(createSupabaseAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "Falhou." }, { status: 500 });
  }
}
