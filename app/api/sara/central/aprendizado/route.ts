import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../lib/auth/session-access";
import { aprendizadoDaVigia } from "../../../../../lib/sara/central/aprendizado";
import { historicoDaVigia } from "../../../../../lib/sara/central/licoes";
import { SARAS } from "../../../../../lib/sara/modulos";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * War Room › Conselho › Aprendizado (J5). GET: as lições (propostas, valendo, recusadas, desativadas) e o que a
 * vigia aprendeu por tipo de achado, calculado pela plataforma. POST: desativar uma lição (o proprietário ou
 * quem responde pela área; a função do banco confere). Só para quem tem a SARA central (`warroom.sara`).
 */
async function acesso() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  if (!access.canModule("warroom") || !access.can("warroom.sara", "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { sb: session.supabase as unknown as SupabaseClient } as const;
}

const ORDEM: Record<string, number> = { proposta: 0, ativa: 1, recusada: 2, desativada: 3 };

export async function GET() {
  const a = await acesso();
  if ("erro" in a) return a.erro;
  const desde = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const [{ data: licoes, error }, historico] = await Promise.all([
    a.sb.from("sara_licoes").select("id, modulo, origem, efeito, texto, tipo_achado, ensinada_por_nome, situacao, pedida_a, decidida_por_nome, decidida_em, nota, created_at")
      .gte("created_at", desde).order("created_at", { ascending: false }).limit(200),
    historicoDaVigia(a.sb),
  ]);
  const lista = ((licoes ?? []) as { modulo: string; situacao: string; created_at: string; tipo_achado: string | null; efeito: string }[])
    .map((l) => ({ ...l, area: SARAS[l.modulo]?.rotulo ?? l.modulo }))
    .sort((x, y) => (ORDEM[x.situacao] ?? 9) - (ORDEM[y.situacao] ?? 9) || y.created_at.localeCompare(x.created_at));
  const silenciados = new Set(lista.filter((l) => l.efeito === "silenciar" && l.situacao === "ativa").map((l) => l.tipo_achado));
  const tipos = aprendizadoDaVigia(historico).map((t) => ({ ...t, silenciado: silenciados.has(t.tipo) }));
  return NextResponse.json({ licoes: lista, tipos, semTabela: Boolean(error) });
}

export async function POST(request: Request) {
  const a = await acesso();
  if ("erro" in a) return a.erro;
  const corpo = (await request.json().catch(() => null)) as { id?: string; nota?: string } | null;
  if (!corpo?.id || !/^[0-9a-f-]{36}$/i.test(corpo.id)) return NextResponse.json({ error: "Lição inválida." }, { status: 400 });
  const { error } = await a.sb.rpc("sara_licao_desativar", { p_id: corpo.id, p_nota: String(corpo.nota ?? "").slice(0, 1000) || null });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
