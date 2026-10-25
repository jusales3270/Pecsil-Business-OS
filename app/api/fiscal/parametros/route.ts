import { NextResponse } from "next/server";
import { dbError, requireAnyFeature, requireFeature } from "../../../../lib/auth/feature-guard";
import { problemasDaNovaVigencia } from "../../../../lib/contabil/parametros";

export const dynamic = "force-dynamic";

/**
 * Fiscal › Parâmetros: parâmetros legais com vigência, teses e o perfil fiscal da empresa
 * (PLANO-CONTABIL-FISCAL, N-01). Leem: Parâmetros legais, Configuração fiscal, o lado da empresa no
 * portal e o escritório. Conferir, propor e descartar: Parâmetros legais (operar) na empresa da
 * curadoria (o banco confere). O perfil: Configuração fiscal (operar).
 */
const LEITURA = ["fiscal.parametros", "fiscal.config", "fiscal.escritorio", "fiscal.portal"] as const;
const PERFIL_PADRAO = { modo: "escritorio", regime: "a_definir", cnaes_secundarios: [] as string[], rat: null, fap: null, beneficio_estadual: null, observacao: null, updated_at: null, updated_by_name: null };

export async function GET() {
  const guard = await requireAnyFeature(LEITURA);
  if ("error" in guard) return guard.error;
  const [parametros, teses, perfil, curar, config] = await Promise.all([
    guard.supabase.from("contabil_parametros").select("id, chave, titulo, escopo, uf, codigo_municipio, valor, vigente_de, vigente_ate, fonte, confianca, observacao, situacao, origem, motivo_descarte, conferido_por_nome, conferido_em, criado_por_nome, created_at").order("chave").order("vigente_de", { ascending: false }),
    guard.supabase.from("contabil_teses").select("*").order("tribunal").order("tema"),
    guard.supabase.from("contabil_perfil_empresa").select("modo, regime, cnaes_secundarios, rat, fap, beneficio_estadual, observacao, updated_at, updated_by_name").maybeSingle(),
    guard.supabase.rpc("contabil_pode_curar"),
    guard.supabase.from("fiscal_config").select("cnpj, cnae, crt, uf, municipio, codigo_municipio").maybeSingle(),
  ]);
  if (parametros.error) return dbError(parametros.error);
  if (teses.error) return dbError(teses.error);
  return NextResponse.json({
    parametros: parametros.data ?? [],
    teses: teses.data ?? [],
    perfil: perfil.data ?? PERFIL_PADRAO,
    empresa: config.data ?? null,
    podeCurar: curar.data === true,
    podeEditarPerfil: guard.access.can("fiscal.config", "operar"),
  }, { headers: { "Cache-Control": "no-store" } });
}

type Corpo = { acao?: string; id?: string; motivo?: string; perfil?: Record<string, unknown>; proposta?: Record<string, unknown> };

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as Corpo | null;
  if (!corpo?.acao) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  if (corpo.acao === "perfil") {
    const guard = await requireFeature("fiscal.config", "operar");
    if ("error" in guard) return guard.error;
    const p = corpo.perfil ?? {};
    if (!["interna", "escritorio"].includes(String(p.modo))) return NextResponse.json({ error: "Escolha o modo de operação." }, { status: 400 });
    if (!["presumido", "real", "a_definir"].includes(String(p.regime))) return NextResponse.json({ error: "Regime inválido." }, { status: 400 });
    const fap = p.fap === "" || p.fap === null || p.fap === undefined ? null : Number(String(p.fap).replace(",", "."));
    if (fap !== null && !(fap >= 0.5 && fap <= 2)) return NextResponse.json({ error: "O FAP vai de 0,5 a 2,0." }, { status: 400 });
    const rat = p.rat === "" || p.rat === null || p.rat === undefined ? null : Number(p.rat);
    if (rat !== null && ![1, 2, 3].includes(rat)) return NextResponse.json({ error: "O RAT é 1, 2 ou 3%." }, { status: 400 });
    const { error } = await guard.supabase.rpc("contabil_perfil_salvar", { p: { ...p, fap, rat } });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }

  const guard = await requireFeature("fiscal.parametros", "operar");
  if ("error" in guard) return guard.error;
  const id = typeof corpo.id === "string" && /^[0-9a-f-]{36}$/i.test(corpo.id) ? corpo.id : null;

  if (corpo.acao === "conferir" || corpo.acao === "conferir_tese") {
    if (!id) return NextResponse.json({ error: "Item inválido." }, { status: 400 });
    const { error } = await guard.supabase.rpc(corpo.acao === "conferir" ? "contabil_parametro_conferir" : "contabil_tese_conferir", { p_id: id });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }
  if (corpo.acao === "descartar") {
    if (!id) return NextResponse.json({ error: "Item inválido." }, { status: 400 });
    const motivo = String(corpo.motivo ?? "").trim();
    if (motivo.length < 3) return NextResponse.json({ error: "Diga o motivo do descarte." }, { status: 400 });
    const { error } = await guard.supabase.rpc("contabil_parametro_descartar", { p_id: id, p_motivo: motivo.slice(0, 500) });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }
  if (corpo.acao === "propor") {
    const p = corpo.proposta ?? {};
    const problemas = problemasDaNovaVigencia(p);
    if (problemas.length) return NextResponse.json({ error: `Falta ou está errado: ${problemas.join(", ")}.` }, { status: 400 });
    const { data, error } = await guard.supabase.rpc("contabil_parametro_propor", { p: { ...p, origem: "manual" } });
    if (error) return dbError(error);
    return NextResponse.json({ ok: true, id: data });
  }
  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
