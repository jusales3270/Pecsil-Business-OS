import { NextResponse } from "next/server";
import type { RhHoliday, RhHolidayCalendar, RhHolidayScope } from "../../../../lib/data/rh-holidays";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getSupabaseConfigStatus } from "../../../../lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Calendário de feriados de um ano (`?year=2026`).
 *
 * Lido com o cliente de sessão: o RLS de `rh_holidays` libera a leitura para
 * qualquer pessoa autenticada da organização e restringe a escrita ao RH.
 */
export async function GET(request: Request) {
  if (!getSupabaseConfigStatus().publicConnectionReady) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  const requested = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : new Date().getFullYear();

  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const { data, error } = await supabase
    .from("rh_holidays")
    .select("id, holiday_date, name, scope, location, day_off")
    .gte("holiday_date", `${year}-01-01`)
    .lte("holiday_date", `${year}-12-31`)
    .order("holiday_date");

  if (error) {
    console.error("[rh/holidays] Falha ao ler feriados:", error.message);
    return NextResponse.json({ error: "HOLIDAYS_UNAVAILABLE" }, { status: 503 });
  }

  const holidays: RhHoliday[] = (data ?? []).map(row => ({
    id: row.id as string,
    date: row.holiday_date as string,
    name: row.name as string,
    scope: row.scope as RhHolidayScope,
    location: (row.location as string | null) ?? null,
    dayOff: Boolean(row.day_off),
  }));

  return NextResponse.json({ year, holidays } satisfies RhHolidayCalendar);
}
