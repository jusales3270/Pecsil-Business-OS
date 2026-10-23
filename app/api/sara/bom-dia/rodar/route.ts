import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { rodarBomDia } from "../../../../../lib/sara/central/bom-dia-executar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Bom dia da SARA (J2). Quem chama é a tarefa agendada do Coolify (scripts/sync-os-cron.mjs, de 10 em 10
 * minutos), com o segredo FORJA_SYNC_SECRET. Fora da janela (7h às 11h, segunda a sábado), não faz nada.
 * Fora de produção, o teste pode passar a hora (`agora`) e limitar quem recebe (`somente`, ids de perfil),
 * para nunca mandar Bom dia de teste a quem trabalha. A resposta traz só contagens e situações.
 */
function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.FORJA_SYNC_SECRET?.trim();
  if (!esperado || esperado.length < 16 || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  if (!segredoConfere(request.headers.get("x-sync-secret"))) return NextResponse.json({ error: "NAO_AUTORIZADO" }, { status: 401 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  let opcoes: { agora?: Date; somente?: string[] } = {};
  if (process.env.NODE_ENV !== "production") {
    const corpo = (await request.json().catch(() => null)) as { agora?: string; somente?: string[] } | null;
    const agora = corpo?.agora ? new Date(corpo.agora) : null;
    opcoes = { ...(agora && !Number.isNaN(agora.getTime()) ? { agora } : {}), ...(Array.isArray(corpo?.somente) ? { somente: corpo.somente.filter((x) => UUID.test(String(x))) } : {}) };
  }
  const r = await rodarBomDia(admin, opcoes);
  return NextResponse.json({ enfileirados: r.enfileirados, rodados: r.rodados, erro: r.erro ?? null }, { status: r.erro ? 500 : 200 });
}
