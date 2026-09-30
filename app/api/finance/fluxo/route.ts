import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

/** Fluxo de caixa do ano: por mês e direção, o realizado (baixas), o em aberto e as previsões. */
export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get("ano"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  const guard = await requireAnyFeature(["financeiro.fluxo", "financeiro.relatorios"]);
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("finance_cash_by_month", { p_year: year });
  if (error) {
    console.error("Falha ao calcular o fluxo de caixa", error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
  type Row = { month: number; direction: string; realized: number; open_amount: number; forecast_amount: number };
  return NextResponse.json({
    year,
    months: ((data ?? []) as Row[]).map((row) => ({ month: row.month, direction: row.direction, realized: Number(row.realized), open: Number(row.open_amount), forecast: Number(row.forecast_amount) })),
  });
}
