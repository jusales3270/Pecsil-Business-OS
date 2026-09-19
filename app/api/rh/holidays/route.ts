import { NextResponse } from "next/server";
import { validateHolidayDraft, type RhHolidayCalendar } from "../../../../lib/data/rh-holidays";
import { HOLIDAY_COLUMNS, holidayWriteError, toHoliday } from "../../../../lib/data/rh-holidays-server";
import { requireUserSession } from "../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

/**
 * Calendário de feriados de um ano (`?year=2026`).
 *
 * Tudo usa o cliente de sessão: o RLS de `rh_holidays` libera a leitura para a
 * organização e a escrita só para quem tem Feriados em Operar. `canEdit` vem do
 * mesmo predicado do banco, para a tela não oferecer o que o banco negaria.
 */
export async function GET(request: Request) {
  const session = await requireUserSession();
  if ("error" in session) return session.error;
  const { supabase } = session;

  const requested = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : new Date().getFullYear();

  const [holidaysResult, permissionResult] = await Promise.all([
    supabase
      .from("rh_holidays")
      .select(HOLIDAY_COLUMNS)
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date"),
    supabase.rpc("has_feature", { requested_feature: "rh.feriados", min_level: "operar" }),
  ]);

  if (holidaysResult.error) {
    console.error("[rh/holidays] Falha ao ler feriados:", holidaysResult.error.message);
    return NextResponse.json({ error: "HOLIDAYS_UNAVAILABLE" }, { status: 503 });
  }

  return NextResponse.json({
    year,
    holidays: (holidaysResult.data ?? []).map(toHoliday),
    canEdit: permissionResult.data === true,
  } satisfies RhHolidayCalendar);
}

/** Cria um feriado. */
export async function POST(request: Request) {
  const session = await requireUserSession();
  if ("error" in session) return session.error;

  const parsed = validateHolidayDraft(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { draft } = parsed;

  const { data, error } = await session.supabase
    .from("rh_holidays")
    .insert({
      holiday_date: draft.date,
      name: draft.name,
      scope: draft.scope,
      location: draft.location,
      day_off: draft.dayOff,
      source: "rh",
    })
    .select(HOLIDAY_COLUMNS)
    .single();

  if (error) return holidayWriteError(error);
  return NextResponse.json({ holiday: toHoliday(data) }, { status: 201 });
}
