import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { rodarSentinela } from "../../../../lib/contabil/sentinela/executar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Fiscal › Parâmetros › Sentinela (N-02): propostas, fontes e rodadas. Leem os mesmos dos Parâmetros legais.
 * Aprovar, recusar e "coletar agora": a curadoria (o banco confere). Configuração: o proprietário.
 */
const LEITURA = ["fiscal.parametros", "fiscal.config", "fiscal.escritorio", "fiscal.portal"] as const;

export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const [propostas, fontes, rodadas, config, curar, dono] = await Promise.all([
    guard.supabase.from("contabil_propostas").select("*").order("created_at", { ascending: false }).limit(200),
    guard.supabase.from("contabil_fontes").select("id, nome, url, formato, nivel, tribunal, cadencia_min, silencio_horas, ativa, nota, ultima_coleta_em, ultimo_item_em, ultimo_erro, ultimo_erro_em, coletas, itens").order("nivel").order("nome"),
    guard.supabase.from("contabil_sentinela_rodadas").select("*").order("iniciada_em", { ascending: false }).limit(20),
    guard.supabase.from("contabil_sentinela_config").select("enviar_decisoes, janela_dias, max_extracoes_dia, updated_at, updated_by_name").maybeSingle(),
    guard.supabase.rpc("contabil_pode_curar"),
    guard.supabase.rpc("is_owner"),
  ]);
  if (propostas.error) return dbError(propostas.error);
  if (fontes.error) return dbError(fontes.error);
  return NextResponse.json({
    propostas: propostas.data ?? [], fontes: fontes.data ?? [], rodadas: rodadas.data ?? [], config: config.data ?? null,
    podeCurar: curar.data === true, podeConfigurar: dono.data === true,
  }, { headers: { "Cache-Control": "no-store" } });
}

type Corpo = { acao?: string; id?: string; nota?: string; valor?: unknown; config?: Record<string, unknown> };
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as Corpo | null;
  if (!corpo?.acao) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  if (corpo.acao === "config") {
    const guard = await requireAnyFeature(LEITURA);
    if ("error" in guard) return guard.error;
    const c = corpo.config ?? {};
    const { error } = await guard.supabase.rpc("contabil_sentinela_config_salvar", { p: {
      ...(typeof c.enviar_decisoes === "boolean" ? { enviar_decisoes: c.enviar_decisoes } : {}),
    } });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }
  const guard = await requireFeature("fiscal.parametros", "operar");
  if ("error" in guard) return guard.error;
  if (corpo.acao === "rodar") {
    const { data: pode } = await guard.supabase.rpc("contabil_pode_curar");
    if (pode !== true) return NextResponse.json({ error: "Só a curadoria coleta agora." }, { status: 403 });
    let admin;
    try { admin = createSupabaseAdminClient(); } catch { return NextResponse.json({ error: "Configuração do banco ausente." }, { status: 503 }); }
    return NextResponse.json(await rodarSentinela(admin, { forcar: true }));
  }
  const id = typeof corpo.id === "string" && UUID.test(corpo.id) ? corpo.id : null;
  if (!id) return NextResponse.json({ error: "Proposta inválida." }, { status: 400 });
  if (corpo.acao === "aprovar") {
    const valor = corpo.valor && typeof corpo.valor === "object" && !Array.isArray(corpo.valor) ? corpo.valor : null;
    const { error } = await guard.supabase.rpc("contabil_proposta_aprovar", { p_id: id, p_valor: valor });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }
  if (corpo.acao === "recusar") {
    const { error } = await guard.supabase.rpc("contabil_proposta_recusar", { p_id: id, p_nota: String(corpo.nota ?? "").slice(0, 1000) });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
