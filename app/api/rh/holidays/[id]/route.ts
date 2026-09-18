import { NextResponse } from "next/server";
import { validateHolidayDraft } from "../../../../../lib/data/rh-holidays";
import { HOLIDAY_COLUMNS, holidayWriteError, toHoliday } from "../../../../../lib/data/rh-holidays-server";
import { requireUserSession } from "../../../../../lib/supabase/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sem permissão o RLS não devolve erro no UPDATE/DELETE: simplesmente não
 * encontra a linha. Por isso "nenhuma linha afetada" vira 403/404 explícito.
 */
const notChanged = () =>
  NextResponse.json({ error: "Feriado não encontrado ou sem permissão para alterá-lo." }, { status: 404 });

/** Altera um feriado. Salvar pelo formulário também confirma um feriado "a conferir". */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return notChanged();

  const session = await requireUserSession();
  if ("error" in session) return session.error;

  const parsed = validateHolidayDraft(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { draft } = parsed;

  const { data, error } = await session.supabase
    .from("rh_holidays")
    .update({
      holiday_date: draft.date,
      name: draft.name,
      scope: draft.scope,
      location: draft.location,
      day_off: draft.dayOff,
      source: "rh",
    })
    .eq("id", id)
    .select(HOLIDAY_COLUMNS);

  if (error) return holidayWriteError(error);
  if (!data?.length) return notChanged();
  return NextResponse.json({ holiday: toHoliday(data[0]) });
}

/** Remove um feriado. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return notChanged();

  const session = await requireUserSession();
  if ("error" in session) return session.error;

  const { data, error } = await session.supabase.from("rh_holidays").delete().eq("id", id).select("id");
  if (error) return holidayWriteError(error);
  if (!data?.length) return notChanged();
  return NextResponse.json({ ok: true });
}
