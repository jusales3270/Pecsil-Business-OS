import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { rodarVigia, type OpcoesVigia } from "../../../../../lib/sara/central/vigia-executar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Vigia da SARA central (J3). Quem chama é a tarefa agendada do Coolify (scripts/sync-os-cron.mjs, de 10 em
 * 10 minutos), com o segredo FORJA_SYNC_SECRET. Fora da janela (6h30 às 10h, segunda a sábado) ou se já
 * rodou hoje, não faz nada. Fora de produção, o teste pode passar a hora (`agora`) e quem decide em cada área
 * (`responsaveis`, ids de perfil), para nunca mandar achado de teste a quem trabalha.
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
  let opcoes: OpcoesVigia = {};
  if (process.env.NODE_ENV !== "production") {
    const corpo = (await request.json().catch(() => null)) as { agora?: string; responsaveis?: Record<string, string[]> } | null;
    const agora = corpo?.agora ? new Date(corpo.agora) : null;
    const responsaveis = corpo?.responsaveis && typeof corpo.responsaveis === "object"
      ? Object.fromEntries(Object.entries(corpo.responsaveis).map(([m, ids]) => [m, (Array.isArray(ids) ? ids : []).filter((x) => UUID.test(String(x)))])) : undefined;
    opcoes = { ...(agora && !Number.isNaN(agora.getTime()) ? { agora } : {}), ...(responsaveis ? { responsaveis } : {}) };
  }
  const r = await rodarVigia(admin, opcoes);
  return NextResponse.json({ sinais: r.sinais, novos: r.novos, enviados: r.enviados, resolvidos: r.resolvidos, cobrados: r.cobrados, descartados: r.descartados.length, jaRodou: Boolean(r.jaRodou), erro: r.erro ?? null },
    { status: r.erro ? 500 : 200 });
}
