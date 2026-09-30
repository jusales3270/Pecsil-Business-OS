import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const BASES = ["vencimento", "lancamento", "pagamento"] as const;

/** Gasto por conta do plano no ano, mês a mês, pelo rateio dos títulos a pagar. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const year = Number(params.get("ano"));
  const basis = params.get("base") ?? "vencimento";
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  if (!(BASES as readonly string[]).includes(basis)) return NextResponse.json({ error: "Base inválida." }, { status: 400 });
  const guard = await requireFeature("financeiro.relatorios");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.rpc("finance_expense_by_account", { p_year: year, p_basis: basis });
  if (error) {
    console.error("Falha ao calcular o gasto por conta", error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
  type Row = { month: number; code: string | null; name: string; management_type: string; total: number; titles: number };
  return NextResponse.json({
    year,
    basis,
    rows: ((data ?? []) as Row[]).map((row) => ({ month: row.month, code: row.code, name: row.name, type: row.management_type, total: Number(row.total), titles: Number(row.titles) })),
  });
}
