import { NextResponse } from "next/server";
import { EMPLOYEE_HISTORY_TABLES, getRhEmployeeHistory } from "../../../../../lib/data/rh-mutations";

export const dynamic = "force-dynamic";

/**
 * Histórico do colaborador que seria apagado junto com o cadastro. A tela de
 * exclusão mostra isto antes de confirmar. Só responde se a sessão enxerga o
 * colaborador (RLS); não devolve dado pessoal, só contagens.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const history = await getRhEmployeeHistory(id);
    const items = Object.entries(EMPLOYEE_HISTORY_TABLES)
      .map(([table, label]) => ({ label, count: history.counts[table] ?? 0 }))
      .filter((item) => item.count > 0);
    const response = NextResponse.json({ name: history.name, hasAccount: history.hasAccount, items });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    if (error instanceof Error && error.message === "RH_MUTATION_DENIED") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    console.error("Falha ao ler o histórico do colaborador", error);
    return NextResponse.json({ error: "RH_UNAVAILABLE" }, { status: 503 });
  }
}
