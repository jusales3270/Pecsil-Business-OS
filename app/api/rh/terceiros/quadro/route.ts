import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Quadro de terceiros: os prestadores que a Portaria escolhe ao registrar a
 * entrada. O RH vê com `rh.terceiros` e inclui ou exclui com `operar` (pelas
 * funções do banco; a tabela não aceita escrita direta).
 */
export async function GET() {
  const guard = await requireFeature("rh.terceiros");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase
    .from("terceiros_quadro")
    .select("id, nome, incluido_por, incluido_por_nome, incluido_em")
    .eq("ativo", true)
    .order("nome");
  if (error) return dbError(error);
  return NextResponse.json({ quadro: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

const falha = (error: { code?: string; message: string }, padrao: string) => {
  const conhecido = error.code === "P0001" || error.code === "42501";
  if (!conhecido) console.error(padrao, error);
  return NextResponse.json({ error: conhecido ? error.message : padrao }, { status: error.code === "42501" ? 403 : 400 });
};

export async function POST(request: Request) {
  const guard = await requireFeature("rh.terceiros", "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => null);
  const nome = typeof body?.nome === "string" ? body.nome : "";
  const { data, error } = await guard.supabase.rpc("rh_terceiro_incluir", { p_nome: nome });
  if (error) return falha(error, "Não foi possível incluir o terceiro.");
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const guard = await requireFeature("rh.terceiros", "operar");
  if ("error" in guard) return guard.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Terceiro inválido." }, { status: 400 });
  const { data, error } = await guard.supabase.rpc("rh_terceiro_excluir", { p_id: id });
  if (error) return falha(error, "Não foi possível excluir o terceiro.");
  return NextResponse.json(data);
}
