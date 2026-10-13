import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/** Próximo número de orçamento, para continuar a numeração do GRV (decisão O2). Só o proprietário. */
export async function POST(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const proximo = Number(((await request.json().catch(() => null)) as { proximo?: unknown } | null)?.proximo);
  if (!Number.isInteger(proximo) || proximo < 1) return NextResponse.json({ error: "Informe um número inteiro." }, { status: 400 });
  const { error } = await session.supabase.rpc("comercial_orcamento_definir_proximo", { p_numero: proximo });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
