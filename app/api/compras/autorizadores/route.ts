import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Quem pode autorizar uma compra imediata: quem aprova compras (só id e nome, pelo banco). */
export async function GET() {
  const guard = await requireAnyFeature(["compras.cotacoes", "compras.realizadas"], "operar");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("compras_autorizadores");
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("Falha ao listar autorizadores", error);
    return NextResponse.json({ error: "Não foi possível carregar quem autoriza." }, { status: 503 });
  }
  return NextResponse.json({ autorizadores: data ?? [] });
}
