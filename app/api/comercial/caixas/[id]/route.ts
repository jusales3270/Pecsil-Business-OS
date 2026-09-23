import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/**
 * Ligar/desligar a caixa, ou reler do começo. "Reler" apaga o marcador da
 * leitura incremental: a próxima rodada varre a Entrada inteira outra vez.
 * Mensagem já registrada não duplica (a chave é o internetMessageId).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("comercial.conexao");
  if ("error" in guard) return guard.error;
  if (!guard.access.isOwner) return NextResponse.json({ error: "Só o proprietário altera caixas." }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const changes: { active?: boolean; delta_link?: null; last_error?: null; last_error_at?: null } = {};
  if (typeof body.active === "boolean") changes.active = body.active;
  if (body.relerDoComeco === true) {
    changes.delta_link = null;
    changes.last_error = null;
    changes.last_error_at = null;
  }
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });

  const { data, error } = await guard.supabase.from("mail_accounts").update(changes).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Caixa não encontrada." }, { status: 404 });
  return NextResponse.json({ id });
}

/** Remove a caixa monitorada (as mensagens dela vão junto, por cascata). */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("comercial.conexao");
  if ("error" in guard) return guard.error;
  if (!guard.access.isOwner) return NextResponse.json({ error: "Só o proprietário remove caixas." }, { status: 403 });
  const { id } = await context.params;
  const { data, error } = await guard.supabase.from("mail_accounts").delete().eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Caixa não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
