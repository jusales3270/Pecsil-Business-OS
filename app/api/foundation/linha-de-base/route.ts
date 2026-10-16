import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import type { AccessLevel } from "../../../../modules/access-catalog";

export const dynamic = "force-dynamic";

const NIVEL: Record<AccessLevel, number> = { ver: 1, operar: 2, aprovar: 3 };

/**
 * Fundação › Linha de base (K-08): os números de antes da virada e as medições seguintes. Cada
 * indicador é revisado pela área que responde por ele (Financeiro, Compras, Produção): quem decide
 * a área corrige o valor (com motivo; o calculado fica guardado). Registrar uma medição ou
 * recalcular é de quem responde por alguma área. O banco confere de novo em cada função.
 */
export async function GET() {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const access = await readSessionAccess(session.supabase);
  const { data: podeMedir } = await session.supabase.rpc("indicadores_pode_medir");
  const { data, error } = await session.supabase
    .from("indicadores_medicoes")
    .select("id, tipo, chave, rotulo, valor, valor_calculado, unidade, periodo_inicio, periodo_fim, fonte, como, detalhes, medido_em, editado_em, motivo_edicao, editado_por, area, responsavel_feature, responsavel_nivel")
    .order("medido_em", { ascending: true });
  if (error) return NextResponse.json({ error: "Não foi possível carregar os indicadores." }, { status: 500 });
  if (!data?.length && podeMedir !== true) return NextResponse.json({ error: "A linha de base é revisada pelas áreas (Financeiro, Compras e Produção)." }, { status: 403 });
  const ids = [...new Set((data ?? []).map((m) => m.editado_por).filter(Boolean))] as string[];
  const { data: perfis } = ids.length ? await session.supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] as { id: string; full_name: string | null }[] };
  const nome = (id: string | null) => (id ? (perfis ?? []).find((p) => p.id === id)?.full_name ?? "—" : null);
  return NextResponse.json({
    medicoes: (data ?? []).map((m) => ({
      ...m, valor: m.valor == null ? null : Number(m.valor), valor_calculado: m.valor_calculado == null ? null : Number(m.valor_calculado), editado_por_nome: nome(m.editado_por),
      // Quem decide a área do indicador corrige (o proprietário não entra: decisão é da área).
      podeCorrigir: Boolean(m.responsavel_feature && access.grants[m.responsavel_feature] && NIVEL[access.grants[m.responsavel_feature]] >= NIVEL[m.responsavel_nivel as AccessLevel]),
    })),
    podeMedir: podeMedir === true,
  });
}

type Acao =
  | { acao: "editar"; id: string; valor: number | null; motivo: string }
  | { acao: "desfazer"; id: string }
  | { acao: "recalcular" }
  | { acao: "medir" };

export async function POST(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const corpo = (await request.json().catch(() => null)) as Acao | null;
  if (!corpo) return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });
  let resultado;
  if (corpo.acao === "editar") {
    if (corpo.valor !== null && !Number.isFinite(Number(corpo.valor))) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    resultado = await session.supabase.rpc("indicadores_editar", { p_id: corpo.id, p_valor: corpo.valor, p_motivo: corpo.motivo ?? "" });
  } else if (corpo.acao === "desfazer") {
    resultado = await session.supabase.rpc("indicadores_desfazer_edicao", { p_id: corpo.id });
  } else if (corpo.acao === "recalcular") {
    // Mesma data de corte da linha de base; o que foi corrigido à mão fica como está.
    const { data: base } = await session.supabase.from("indicadores_medicoes").select("periodo_fim").eq("tipo", "linha_de_base").limit(1).maybeSingle();
    if (!base) return NextResponse.json({ error: "Ainda não há linha de base." }, { status: 400 });
    resultado = await session.supabase.rpc("indicadores_registrar", { p_tipo: "linha_de_base", p_fim: base.periodo_fim, p_substituir: true });
  } else if (corpo.acao === "medir") {
    resultado = await session.supabase.rpc("indicadores_registrar", { p_tipo: "medicao" });
  } else {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  if (resultado.error) return NextResponse.json({ error: resultado.error.message }, { status: resultado.error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
