import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { rodarCrescimento, type OpcoesCrescimento } from "../../../../../lib/sara/central/crescimento-executar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Crescimento da SARA central (J4). Quem chama é a tarefa agendada do Coolify (scripts/sync-os-cron.mjs, de
 * 10 em 10 minutos), com o segredo FORJA_SYNC_SECRET. Fora da janela (segunda-feira, 8h às 12h) ou se já saiu
 * nesta semana, não faz nada. Fora de produção, o teste pode passar a hora (`agora`) e quem recebe o aviso
 * (`destinatarios`, ids de perfil), para nunca avisar a gente de verdade.
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
  let opcoes: OpcoesCrescimento = {};
  if (process.env.NODE_ENV !== "production") {
    const corpo = (await request.json().catch(() => null)) as { agora?: string; destinatarios?: string[] } | null;
    const agora = corpo?.agora ? new Date(corpo.agora) : null;
    opcoes = { ...(agora && !Number.isNaN(agora.getTime()) ? { agora } : {}), ...(Array.isArray(corpo?.destinatarios) ? { destinatarios: corpo.destinatarios.filter((x) => UUID.test(String(x))) } : {}) };
  }
  const r = await rodarCrescimento(admin, opcoes);
  const c = r.relatorio;
  return NextResponse.json({ id: r.id ?? null, jaRodou: Boolean(r.jaRodou), buscas: r.buscas, pesquisa: r.achadosDaPesquisa,
    itens: c ? { ideias: c.ideias.length, recursos: c.recursos.length, concorrencia: c.concorrencia.length, investimentos: c.investimentos.length, descartados: c.descartados.length } : null, erro: r.erro ?? null },
    { status: r.erro ? 500 : 200 });
}
