import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Almoxarifado › Ligar histórico (A-01): textos de compras, cotações, pedidos e recebimentos ainda
 * sem material, com a sugestão por regra (código no texto ou nome mais parecido). Ligar vale para
 * todas as linhas com o mesmo texto; pular tira da lista. Almoxarifado (materiais) ou Compras (cotações).
 */
export async function GET(request: Request) {
  const guard = await requireAnyFeature(["almoxarifado.materiais", "compras.cotacoes"], "operar");
  if ("error" in guard) return guard.error;
  const p = new URL(request.url).searchParams;
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  const { data, error } = await guard.supabase.rpc("material_historico_pendente", { p_limite: 30, p_offset: offset });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  const linhas = (data ?? []) as Record<string, unknown>[];
  return NextResponse.json({
    total: Number(linhas[0]?.total ?? 0),
    itens: linhas.map((l) => ({
      texto: l.texto, ocorrencias: Number(l.ocorrencias), exemplo: l.exemplo,
      sugestao: l.sugestao_id ? { id: l.sugestao_id, codigo: l.sugestao_codigo, descricao: l.sugestao_descricao, unidade: l.sugestao_unidade, nota: Number(l.nota), por: l.por } : null,
    })),
  });
}

export async function POST(request: Request) {
  const guard = await requireAnyFeature(["almoxarifado.materiais", "compras.cotacoes"], "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => null)) as { texto?: string; material_id?: string | null } | null;
  if (!corpo?.texto) return NextResponse.json({ error: "Texto ausente." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("material_historico_decidir", { p_texto: corpo.texto, p_material: corpo.material_id ?? null });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ linhas: Number(data) || 0 });
}
