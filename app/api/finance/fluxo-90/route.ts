import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Dados de partida do fluxo de caixa dos próximos 90 dias (F-07): saldos, parcelas em aberto e o que fica fora. */
export async function GET() {
  const guard = await requireAnyFeature(["financeiro.fluxo", "financeiro.relatorios"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("finance_fluxo_90");
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    console.error("Falha ao montar o fluxo de 90 dias", error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json(data);
}
