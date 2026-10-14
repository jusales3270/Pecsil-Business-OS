import { NextResponse } from "next/server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Registra a tela que a pessoa abriu (módulo e seção) na auditoria. O autor é a sessão; a mesma
 * tela não se repete em 15 minutos (o banco cuida). Nunca derruba a navegação.
 */
export async function POST(request: Request) {
  const session = await requireUserSession();
  if ("error" in session && session.error) return session.error;
  const b = (await request.json().catch(() => null)) as { modulo?: string; secao?: string } | null;
  const modulo = String(b?.modulo ?? "").slice(0, 40);
  if (!modulo) return NextResponse.json({ ok: false }, { status: 400 });
  await session.supabase.rpc("auditoria_registrar_acesso", { p_modulo: modulo, p_secao: String(b?.secao ?? "").slice(0, 80) || null });
  return NextResponse.json({ ok: true });
}
