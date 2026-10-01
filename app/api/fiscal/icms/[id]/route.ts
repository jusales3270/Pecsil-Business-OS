import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";
import { ICMS_COLUNAS, icmsColunas, type IcmsEntradaBody } from "../../../../../lib/fiscal/icms-campos";

export const dynamic = "force-dynamic";

/** Altera uma nota do painel (marcações XML/LACTO/AUT, centro, tipo, valores). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as IcmsEntradaBody;
  const resultado = icmsColunas(body);
  if ("erro" in resultado) return NextResponse.json({ error: resultado.erro }, { status: 400 });
  if (!Object.keys(resultado.colunas).length) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });
  const { data, error } = await guard.supabase.from("fiscal_icms_entries").update(resultado.colunas).eq("id", id).select(ICMS_COLUNAS);
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  return NextResponse.json(data[0]);
}

/** Exclui uma nota lançada à mão. A que veio do recebimento só sai com o recebimento. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await requireFeature("fiscal.icms", "operar");
  if ("error" in guard) return guard.error;
  const { data: atual } = await guard.supabase.from("fiscal_icms_entries").select("origem").eq("id", id).maybeSingle();
  if (!atual) return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  if (atual.origem === "almoxarifado") return NextResponse.json({ error: "Esta nota veio do recebimento do Almoxarifado e gerou conta a pagar; não é excluída por aqui." }, { status: 409 });
  const { error } = await guard.supabase.from("fiscal_icms_entries").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
