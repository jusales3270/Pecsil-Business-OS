export type RhHolidayScope = "nacional" | "estadual" | "municipal" | "facultativo";

export type RhHoliday = {
  id: string;
  /** Data no formato ISO (YYYY-MM-DD), sem fuso. */
  date: string;
  name: string;
  scope: RhHolidayScope;
  location: string | null;
  /** A empresa não trabalha na data (entra no cálculo de dias úteis). */
  dayOff: boolean;
  /** Completado por padrão de outro ano; o RH ainda precisa conferir. */
  pendingReview: boolean;
};

export type RhHolidayCalendar = {
  year: number;
  holidays: RhHoliday[];
  /** Calculado no banco (has_scoped_permission): o usuário pode editar o calendário. */
  canEdit: boolean;
};

/** Corpo aceito para criar ou alterar um feriado. */
export type RhHolidayDraft = {
  date: string;
  name: string;
  scope: RhHolidayScope;
  location: string | null;
  dayOff: boolean;
};

export const HOLIDAY_SCOPES: RhHolidayScope[] = ["nacional", "estadual", "municipal", "facultativo"];

/** Validação compartilhada entre formulário e API. Devolve a mensagem do primeiro problema. */
export function validateHolidayDraft(input: unknown): { ok: true; draft: RhHolidayDraft } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Dados do feriado ausentes." };
  const raw = input as Record<string, unknown>;
  const date = typeof raw.date === "string" ? raw.date.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
  const scope = raw.scope as RhHolidayScope;
  const location = typeof raw.location === "string" && raw.location.trim() ? raw.location.trim() : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Informe uma data válida." };
  const { year, month, day } = isoParts(date);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || year < 2000 || year > 2100) {
    return { ok: false, error: "Informe uma data válida." };
  }
  if (name.length < 3 || name.length > 120) return { ok: false, error: "O nome deve ter entre 3 e 120 caracteres." };
  if (!HOLIDAY_SCOPES.includes(scope)) return { ok: false, error: "Escolha a abrangência do feriado." };
  if (location && location.length > 60) return { ok: false, error: "O local deve ter no máximo 60 caracteres." };

  return { ok: true, draft: { date, name, scope, location, dayOff: raw.dayOff !== false } };
}

export const holidayScopeLabel: Record<RhHolidayScope, string> = {
  nacional: "Nacional",
  estadual: "Estadual",
  municipal: "Municipal",
  facultativo: "Ponto facultativo",
};

/** Partes de uma data ISO sem passar por fuso horário. */
export function isoParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/** Dia da semana (0 = domingo) de uma data ISO, calculado em UTC. */
export function isoWeekday(date: string) {
  const { year, month, day } = isoParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Dias úteis do ano: segunda a sexta, menos feriados com folga que caem em dia
 * de semana. Mesma regra da função SQL `rh_business_days`.
 */
export function businessDaysInYear(year: number, holidays: RhHoliday[]) {
  let weekdays = 0;
  for (let day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) weekdays++;
  }
  const holidaysOnWeekdays = holidays.filter(h => h.dayOff && ![0, 6].includes(isoWeekday(h.date))).length;
  return weekdays - holidaysOnWeekdays;
}
