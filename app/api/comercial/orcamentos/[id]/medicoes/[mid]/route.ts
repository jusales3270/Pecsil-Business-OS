import { NextResponse, after } from "next/server";
import { dbError, requireFeature } from "../../../../../../../lib/auth/feature-guard";
import { processarMedicao } from "../../../../../../../lib/comercial/medidor-3d";
import { TIPOS_PECA } from "../../../../../../../lib/comercial/peso-3d";
import { createSupabaseAdminClient } from "../../../../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string; mid: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Ajustar a medição: o tipo de um corpo ("este é o fundo", "isto é a garrafa") e a liga do corpo ou da
 * medição inteira. O peso é recalculado na tela; nada do medidor muda.
 *   { corpo, tipo?, liga_id? }  → ajuste do corpo (tipo vazio volta à sugestão)
 *   { liga_id }                 → liga da medição
 */
export async function PATCH(request: Request, context: Contexto) {
  const { id, mid } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const b = (await request.json().catch(() => ({}))) as { corpo?: unknown; tipo?: unknown; liga_id?: unknown };
  const { data: m, error } = await guard.supabase.from("comercial_medicoes_3d").select("id, corpos, ajustes").eq("id", mid).eq("quote_id", id).maybeSingle();
  if (error) return dbError(error);
  if (!m) return NextResponse.json({ error: "Medição não encontrada." }, { status: 404 });
  const liga = b.liga_id === null || b.liga_id === "" ? null : typeof b.liga_id === "string" && UUID.test(b.liga_id) ? b.liga_id : undefined;

  if (typeof b.corpo !== "string") {
    if (liga === undefined) return NextResponse.json({ error: "Informe a liga." }, { status: 400 });
    const { error: e } = await guard.supabase.from("comercial_medicoes_3d").update({ liga_id: liga, updated_at: new Date().toISOString() }).eq("id", mid);
    return e ? dbError(e) : NextResponse.json({ ok: true });
  }
  const corpo = b.corpo;
  if (!(m.corpos as { nome: string }[]).some((c) => c.nome === corpo)) return NextResponse.json({ error: "Corpo não encontrado nesta medição." }, { status: 400 });
  const ajustes = { ...(m.ajustes as Record<string, { tipo?: string; liga_id?: string | null }>) };
  const atual = { ...(ajustes[corpo] ?? {}) };
  if (b.tipo !== undefined) {
    if (b.tipo === "" || b.tipo === null) delete atual.tipo;
    else if (typeof b.tipo === "string" && (TIPOS_PECA as readonly string[]).includes(b.tipo)) atual.tipo = b.tipo;
    else return NextResponse.json({ error: "Tipo de peça desconhecido." }, { status: 400 });
  }
  if (liga !== undefined) { if (liga) atual.liga_id = liga; else delete atual.liga_id; }
  if (Object.keys(atual).length) ajustes[corpo] = atual; else delete ajustes[corpo];
  const { error: e } = await guard.supabase.from("comercial_medicoes_3d").update({ ajustes, updated_at: new Date().toISOString() }).eq("id", mid);
  return e ? dbError(e) : NextResponse.json({ ok: true });
}

/** "Medir de novo": a medição com erro (ou travada) volta para o medidor. */
export async function POST(_request: Request, context: Contexto) {
  const { id, mid } = await context.params;
  const guard = await requireFeature("comercial.orcamentos", "operar");
  if ("error" in guard) return guard.error;
  const { data: m, error } = await guard.supabase.from("comercial_medicoes_3d").select("id, situacao").eq("id", mid).eq("quote_id", id).maybeSingle();
  if (error) return dbError(error);
  if (!m) return NextResponse.json({ error: "Medição não encontrada." }, { status: 404 });
  if (m.situacao === "pronto") return NextResponse.json({ error: "Esta medição já está pronta." }, { status: 409 });
  after(async () => {
    try { await processarMedicao(createSupabaseAdminClient(), mid); } catch (e) { console.error("Medir de novo", e instanceof Error ? e.message : e); }
  });
  return NextResponse.json({ ok: true });
}
