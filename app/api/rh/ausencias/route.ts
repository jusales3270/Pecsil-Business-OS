import { NextResponse } from "next/server";
import { getSupabaseConfigStatus } from "../../../../lib/supabase/config";
import { searchRhAbsences, type RhAbsenceFilters } from "../../../../lib/data/rh-repository";

export const dynamic = "force-dynamic";

const TYPES = new Set(["vacation", "time_bank", "medical_certificate", "leave", "attendance_statement", "family_care", "occupational_exam", "legal_leave", "justified_absence", "inss_leave", "work_accident", "maternity_leave"]);
const STATUSES = new Set(["pending", "under_review", "approved", "rejected", "registered"]);

/**
 * Filtros do cabeçalho de RH › Férias e ausências: ?nome= (a partir de 3 letras) &tipo= &situacao=, no
 * histórico inteiro. Sem conexão configurada, 409 (a tela filtra só o que tem carregado).
 */
export async function GET(request: Request) {
  if (!getSupabaseConfigStatus().publicConnectionReady) return NextResponse.json({ error: "DEMO_MODE" }, { status: 409 });
  const params = new URL(request.url).searchParams;
  const name = params.get("nome")?.trim() ?? "";
  const type = params.get("tipo") ?? "";
  const status = params.get("situacao") ?? "";
  if ((name && name.length < 3) || name.length > 120 || (type && !TYPES.has(type)) || (status && !STATUSES.has(status)) || (!name && !type && !status)) {
    return NextResponse.json({ error: "INVALID_FILTER" }, { status: 400 });
  }
  try {
    const filters: RhAbsenceFilters = { name: name || undefined, type: (type || undefined) as RhAbsenceFilters["type"], status: (status || undefined) as RhAbsenceFilters["status"] };
    return NextResponse.json(await searchRhAbsences(filters));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    console.error("Falha ao filtrar as ausências", error);
    return NextResponse.json({ error: "RH_UNAVAILABLE" }, { status: 503 });
  }
}
