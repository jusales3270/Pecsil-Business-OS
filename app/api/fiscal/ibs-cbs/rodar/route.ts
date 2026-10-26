import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sincronizarTodas } from "../../../../../lib/fiscal/ibs-cbs/servidor";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * IBS e CBS (N-03): lê os XMLs de NF-e que ainda faltam, de todas as empresas com o Fiscal configurado. Quem chama
 * é a tarefa agendada do Coolify (scripts/sync-os-cron.mjs, de 10 em 10 minutos), com o segredo FORJA_SYNC_SECRET.
 * Cobre o que o envio não leu na hora (CNPJ ainda não configurado, nota que a SEFAZ distribuiu, falha passageira).
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
  const empresas = await sincronizarTodas(admin);
  return NextResponse.json({ empresas });
}
