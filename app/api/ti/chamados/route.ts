import { NextResponse } from "next/server";
import { readSessionAccess } from "../../../../lib/auth/session-access";
import { requireUserSession } from "../../../../lib/supabase/session";
import { erroDoBanco } from "../../../../lib/ti/servidor";
import { COLUNAS_CHAMADO } from "../../../../lib/ti/colunas";

export const dynamic = "force-dynamic";

/**
 * Chamados de TI. `escopo=meus` (qualquer pessoa): os que a pessoa abriu. `escopo=todos`: a fila
 * da TI (ti.chamados). Junto vêm as categorias e os prazos (do supervisor de TI).
 */
export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const supabase = session.supabase;
  let access;
  try { access = await readSessionAccess(supabase); } catch { return NextResponse.json({ error: "ACCESS_UNAVAILABLE" }, { status: 503 }); }
  const todos = new URL(request.url).searchParams.get("escopo") === "todos";
  if (todos && !access.can("ti.chamados")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: eu } = await supabase.rpc("current_profile_id");
  let consulta = supabase.from("ti_chamados").select(COLUNAS_CHAMADO).order("created_at", { ascending: false }).limit(500);
  if (!todos) consulta = consulta.eq("solicitante_id", eu as string);
  const [chamados, regras] = await Promise.all([consulta, supabase.from("ti_regras").select("categorias, prazos_h, revisado_por_nome, revisado_em").maybeSingle()]);
  if (chamados.error || regras.error) {
    console.error("TI: falha ao ler chamados", chamados.error ?? regras.error);
    return NextResponse.json({ error: "TI_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({
    chamados: chamados.data ?? [],
    regras: regras.data,
    eu,
    podeAtender: access.can("ti.chamados", "operar"),
    podeRegras: access.can("ti.chamados", "aprovar"),
  });
}

/** Abre um chamado (qualquer pessoa da empresa). */
export async function POST(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const b = (await request.json().catch(() => ({}))) as { titulo?: string; descricao?: string; categoria?: string; prioridade?: string; local?: string; ativoId?: string | null };
  const { data, error } = await session.supabase.rpc("ti_abrir_chamado", {
    p_titulo: b.titulo ?? "", p_descricao: b.descricao ?? "", p_categoria: b.categoria ?? "", p_prioridade: b.prioridade ?? "normal",
    p_local: b.local ?? "", p_ativo: b.ativoId || null,
  });
  if (error) return erroDoBanco(error, "Não foi possível abrir o chamado.");
  return NextResponse.json(data, { status: 201 });
}
