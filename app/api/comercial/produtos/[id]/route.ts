import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { normalizarProduto } from "../../../../../lib/comercial/vendas";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.produtos", "operar");
  if ("error" in guard) return guard.error;
  const { produto, erros } = normalizarProduto(await request.json().catch(() => null));
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  if (!produto.codigo) return NextResponse.json({ error: "O código interno não pode ficar vazio." }, { status: 400 });
  const { cloned_from: _origem, ...mudancas } = produto;
  void _origem;
  const { data, error } = await guard.supabase.from("products").update({ ...mudancas, updated_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle();
  if (error) return error.code === "23505" ? NextResponse.json({ error: `Já existe um produto com o código ${produto.codigo}.` }, { status: 409 }) : dbError(error);
  if (!data) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Excluir só produto nunca usado; usado em orçamento, o caminho é desativar. */
export async function DELETE(_request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireFeature("comercial.produtos", "operar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("products").delete().eq("id", id).select("id").maybeSingle();
  if (error?.code === "23503") return NextResponse.json({ error: "Este produto já está em orçamento: desative em vez de excluir." }, { status: 409 });
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
