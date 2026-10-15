import { NextResponse } from "next/server";
import { dbError, requireAnyFeature } from "../../../../../lib/auth/feature-guard";
import { LEITORES_MATERIAIS, normalizarMaterial, pendenciasDepois } from "../../../../../lib/almoxarifado/materiais";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

/** Editar o material (o código não muda; inativar é ativo=false — material não se apaga). */
export async function PATCH(request: Request, context: Contexto) {
  const { id } = await context.params;
  const guard = await requireAnyFeature([...LEITORES_MATERIAIS], "ver");
  if ("error" in guard) return guard.error;
  if (!guard.access.can("almoxarifado.materiais", "operar") && !guard.access.can("compras.cotacoes", "operar")) {
    return NextResponse.json({ error: "Sem permissão para alterar materiais." }, { status: 403 });
  }
  const { material, erros } = normalizarMaterial(await request.json().catch(() => null));
  if (erros.length) return NextResponse.json({ error: erros.join(" ") }, { status: 400 });
  const { data: atual } = await guard.supabase.from("materials").select("id, pendencias").eq("id", id).maybeSingle();
  if (!atual) return NextResponse.json({ error: "Material não encontrado." }, { status: 404 });
  const { codigo: _codigo, ...mudancas } = material;
  void _codigo;
  const { error } = await guard.supabase.from("materials").update({ ...mudancas, pendencias: pendenciasDepois(atual.pendencias ?? [], material) }).eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
