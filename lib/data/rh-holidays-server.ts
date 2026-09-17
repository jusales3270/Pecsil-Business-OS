import "server-only";

import { NextResponse } from "next/server";
import type { RhHoliday, RhHolidayScope } from "./rh-holidays";
import { createSupabaseServerClient } from "../supabase/server";
import { getSupabaseConfigStatus } from "../supabase/config";

type Row = Record<string, unknown>;

export const HOLIDAY_COLUMNS = "id, holiday_date, name, scope, location, day_off, source";

export function toHoliday(row: Row): RhHoliday {
  return {
    id: row.id as string,
    date: row.holiday_date as string,
    name: row.name as string,
    scope: row.scope as RhHolidayScope,
    location: (row.location as string | null) ?? null,
    dayOff: Boolean(row.day_off),
    pendingReview: typeof row.source === "string" && row.source.startsWith("derivado-"),
  };
}

/** Cliente de sessão do usuário, ou a resposta de erro pronta (sem configuração / sem sessão). */
export async function holidaySession() {
  if (!getSupabaseConfigStatus().publicConnectionReady) {
    return { error: NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 }) } as const;
  }
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) } as const;
  }
  return { supabase } as const;
}

/** Traduz erros do PostgREST/Postgres em respostas claras para o formulário. */
export function holidayWriteError(error: { code?: string; message: string }) {
  if (error.code === "23505") return NextResponse.json({ error: "Já existe um feriado cadastrado nessa data." }, { status: 409 });
  if (error.code === "42501") return NextResponse.json({ error: "Seu perfil não tem permissão para alterar o calendário." }, { status: 403 });
  console.error("[rh/holidays] Falha ao gravar feriado:", error.message);
  return NextResponse.json({ error: "Não foi possível salvar o feriado." }, { status: 500 });
}
