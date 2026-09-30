import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../lib/auth/feature-guard";
import { readSettledTitles } from "../../../../lib/data/finance-repository";

export const dynamic = "force-dynamic";

const FEATURE = { payable: "financeiro.pagar", receivable: "financeiro.receber" } as const;

/** Títulos quitados no mês (`mes=AAAA-MM`) de uma direção: o histórico não vem com o módulo. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const direction = url.searchParams.get("direction");
  const month = url.searchParams.get("mes") ?? "";
  if (direction !== "payable" && direction !== "receivable") return NextResponse.json({ error: "Direção inválida." }, { status: 400 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  const guard = await requireAnyFeature([FEATURE[direction], "financeiro.relatorios"]);
  if ("error" in guard) return guard.error;
  try {
    return NextResponse.json({ titles: await readSettledTitles(guard.supabase, direction, month) });
  } catch (error) {
    console.error("Falha ao ler títulos quitados", error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }
}
