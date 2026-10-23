import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../lib/auth/session-access";
import { rodarCrescimento } from "../../../../../lib/sara/central/crescimento-executar";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Relatório de crescimento na War Room › Conselho (J4). GET: os últimos relatórios (o mais recente completo).
 * POST: gerar agora, com a visão de quem pede (no máximo um a cada 2 horas). Só para quem tem a SARA central.
 */
async function acesso() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  if (!access.canModule("warroom") || !access.can("warroom.sara", "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { sb: session.supabase as unknown as SupabaseClient } as const;
}

export async function GET() {
  const a = await acesso();
  if ("erro" in a) return a.erro;
  const { data } = await a.sb.from("sara_relatorios").select("id, semana, disparo, situacao, conteudo, pesquisa, modelo, buscas, erro, created_at, terminada_em")
    .order("created_at", { ascending: false }).limit(8);
  return NextResponse.json({ relatorios: data ?? [] });
}

export async function POST() {
  const a = await acesso();
  if ("erro" in a) return a.erro;
  const { data: ultimo } = await a.sb.from("sara_relatorios").select("created_at, situacao").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (ultimo && (ultimo.situacao === "rodando" || Date.now() - Date.parse(ultimo.created_at) < 2 * 3600_000))
    return NextResponse.json({ error: "Já saiu um relatório há pouco (no máximo um a cada 2 horas)." }, { status: 429 });
  const eu = (await a.sb.rpc("current_profile_id")).data as string | null;
  if (!eu) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  // Pedido na tela: avisa só quem pediu (o relatório da segunda avisa o conselho).
  const r = await rodarCrescimento(admin, { disparo: "manual", visao: { sb: a.sb, profileId: eu }, destinatarios: [] });
  if (r.erro) return NextResponse.json({ error: `O relatório não terminou: ${r.erro}` }, { status: 500 });
  return NextResponse.json({ id: r.id, buscas: r.buscas });
}
