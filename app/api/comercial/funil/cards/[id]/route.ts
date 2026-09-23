import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const TIPOS = ["pedido", "cobranca", "duvida", "outro"];

/** Editar o card: título, cliente, tipo, valor e prazo. Mover é a outra rota. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("comercial.funil", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));

  const mudancas: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    if (!body.title.trim()) return NextResponse.json({ error: "Escreva do que se trata." }, { status: 400 });
    mudancas.title = body.title.trim();
  }
  if (typeof body.kind === "string" && TIPOS.includes(body.kind)) mudancas.kind = body.kind;
  if (body.customerId !== undefined) mudancas.customer_id = body.customerId || null;
  if (body.dueDate !== undefined) mudancas.due_date = body.dueDate || null;
  if (body.value !== undefined) {
    const texto = String(body.value ?? "").trim();
    if (!texto) {
      mudancas.value_cents = null;
    } else {
      const numero = Number(texto.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(numero) || numero < 0) {
        return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
      }
      mudancas.value_cents = Math.round(numero * 100);
    }
  }
  if (!Object.keys(mudancas).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });

  const { data, error } = await guard.supabase.from("crm_cards").update(mudancas).eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Card não encontrado." }, { status: 404 });
  return NextResponse.json({ id });
}

/** Apaga o card. A linha do tempo dele vai junto, por cascata. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("comercial.funil", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const { data, error } = await guard.supabase.from("crm_cards").delete().eq("id", id).select("id").maybeSingle();
  if (error) return dbError(error);
  if (!data) return NextResponse.json({ error: "Card não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
