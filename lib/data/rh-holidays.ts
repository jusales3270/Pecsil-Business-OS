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
};

export type RhHolidayCalendar = {
  year: number;
  holidays: RhHoliday[];
};

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
