import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../../lib/auth/session-access";
import { rodarVigia } from "../../../../../lib/sara/central/vigia-executar";
import { SARAS } from "../../../../../lib/sara/modulos";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Quadro da vigia na War Room › Conselho (J3). GET: as últimas rodadas, os achados (abertos primeiro) e quem
 * decide em cada área. POST: rodar a vigia agora, com a visão de quem pede (no máximo uma vez a cada 20
 * minutos). Só para quem tem a SARA central (`warroom.sara`); o proprietário sempre tem.
 */
async function acesso() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return { erro: session.error } as const;
  const access = await readSessionAccess(session.supabase).catch(() => null);
  if (!access) return { erro: NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }) } as const;
  if (!access.canModule("warroom") || !access.can("warroom.sara", "ver")) return { erro: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) } as const;
  return { sb: session.supabase as unknown as SupabaseClient } as const;
}

const ORDEM: Record<string, number> = { ajuda: 0, enviado: 1, tratando: 2, aberto: 3, sem_responsavel: 4, silenciado: 5, nao_e_problema: 6, resolvido: 7 };
const PESO: Record<string, number> = { alto: 0, medio: 1, baixo: 2 };

export async function GET() {
  const a = await acesso();
  if ("erro" in a) return a.erro;
  const desde = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const [{ data: rodadas }, { data: achados }, { data: resp }] = await Promise.all([
    a.sb.from("sara_vigia_rodadas").select("id, dia, disparo, situacao, sinais, achados_novos, enviados, modelo, resumo, erro, created_at, terminada_em").order("created_at", { ascending: false }).limit(5),
    a.sb.from("sara_achados").select("id, modulo, area, titulo, por_que, evidencias, impacto, ligacoes, contencao, confianca, origem, situacao, envios, efeito, created_at, updated_at, resolvido_em")
      .gte("updated_at", desde).order("created_at", { ascending: false }).limit(100),
    a.sb.from("sara_responsaveis").select("modulo, profiles(full_name)"),
  ]);
  const lista = ((achados ?? []) as { situacao: string; impacto: string; created_at: string }[])
    .sort((x, y) => (ORDEM[x.situacao] ?? 9) - (ORDEM[y.situacao] ?? 9) || (PESO[x.impacto] ?? 9) - (PESO[y.impacto] ?? 9) || y.created_at.localeCompare(x.created_at));
  const nomes = new Map<string, string[]>();
  for (const r of (resp ?? []) as unknown as { modulo: string; profiles: { full_name: string } | null }[]) nomes.set(r.modulo, [...(nomes.get(r.modulo) ?? []), r.profiles?.full_name ?? "?"]);
  const responsaveis = Object.values(SARAS).filter((s) => !s.central).map((s) => ({ modulo: s.modulo, area: s.rotulo, pessoas: nomes.get(s.modulo) ?? [] }));
  return NextResponse.json({ rodadas: rodadas ?? [], achados: lista, responsaveis });
}

export async function POST() {
  const a = await acesso();
  if ("erro" in a) return a.erro;
  const { data: ultima } = await a.sb.from("sara_vigia_rodadas").select("created_at, situacao").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (ultima && (ultima.situacao === "rodando" || Date.now() - Date.parse(ultima.created_at) < 20 * 60_000))
    return NextResponse.json({ error: "A vigia rodou há pouco. Espere uns minutos para rodar de novo." }, { status: 429 });
  const eu = (await a.sb.rpc("current_profile_id")).data as string | null;
  if (!eu) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  let admin;
  try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
  const r = await rodarVigia(admin, { disparo: "manual", visao: { sb: a.sb, profileId: eu } });
  if (r.erro) return NextResponse.json({ error: `A vigia não terminou: ${r.erro}` }, { status: 500 });
  return NextResponse.json({ sinais: r.sinais, novos: r.novos, enviados: r.enviados, resolvidos: r.resolvidos, cobrados: r.cobrados });
}
