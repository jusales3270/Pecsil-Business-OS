"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Kpi, KpiGrid, Status } from "../../packages/design-system";
import {
  businessDaysInYear,
  holidayScopeLabel,
  isoParts,
  isoWeekday,
  type RhHoliday,
  type RhHolidayCalendar,
  type RhHolidayScope,
} from "../../lib/data/rh-holidays";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS_SHORT = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAYS_LONG = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

const scopeTone: Record<RhHolidayScope, "info" | "success" | "attention" | "neutral"> = {
  nacional: "info",
  estadual: "success",
  municipal: "attention",
  facultativo: "neutral",
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; calendar: RhHolidayCalendar }
  | { status: "error"; message: string };

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatLong(date: string) {
  const { day, month } = isoParts(date);
  return `${String(day).padStart(2, "0")} de ${MONTHS[month - 1].toLowerCase()}`;
}

export function HolidaysSection() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/rh/holidays?year=${year}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 401) return setState({ status: "error", message: "Sua sessão expirou. Entre novamente para ver o calendário." });
        if (!response.ok) return setState({ status: "error", message: "Não foi possível carregar os feriados agora." });
        setState({ status: "ready", calendar: (await response.json()) as RhHolidayCalendar });
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", message: "Não foi possível carregar os feriados agora." });
      });
    return () => controller.abort();
  }, [year]);

  const changeYear = (next: number) => {
    setState({ status: "loading" });
    setYear(next);
  };

  const holidays = state.status === "ready" ? state.calendar.holidays : [];
  const byDate = useMemo(() => new Map(holidays.map(h => [h.date, h])), [holidays]);
  const today = todayIso();
  const next = holidays.find(h => h.date >= today);
  const onWeekdays = holidays.filter(h => h.dayOff && ![0, 6].includes(isoWeekday(h.date))).length;

  return <>
    <div className="page-head hr-page-head">
      <div>
        <p className="eyebrow">RH · CALENDÁRIO</p>
        <h1>Feriados {year}</h1>
        <p>Base oficial da Pecsil para cálculos de férias, jornada e prazos em dias úteis.</p>
      </div>
      <div className="holiday-year" role="group" aria-label="Ano do calendário">
        <button type="button" onClick={() => changeYear(year - 1)} aria-label="Ano anterior">‹</button>
        <b>{year}</b>
        <button type="button" onClick={() => changeYear(year + 1)} aria-label="Próximo ano">›</button>
      </div>
    </div>

    {state.status === "loading" && <Card className="holiday-empty"><b>Carregando calendário…</b></Card>}

    {state.status === "error" && <Card className="holiday-empty"><b>{state.message}</b></Card>}

    {state.status === "ready" && !holidays.length && (
      <Card className="holiday-empty">
        <b>Nenhum feriado cadastrado para {year}</b>
        <small>O calendário de {year} ainda não foi importado.</small>
      </Card>
    )}

    {state.status === "ready" && holidays.length > 0 && <>
      <KpiGrid>
        <Kpi label="Feriados no ano" value={String(holidays.length)} caption={`${holidays.filter(h => h.scope === "nacional").length} nacionais`} tone="blue"/>
        <Kpi label="Em dias úteis" value={String(onWeekdays)} caption="Folgas de segunda a sexta" tone="amber"/>
        <Kpi label="Dias úteis no ano" value={String(businessDaysInYear(year, holidays))} caption="Seg–sex menos feriados" tone="green"/>
        <Kpi label="Próximo feriado" value={next ? formatLong(next.date) : "—"} caption={next ? next.name : "Sem feriados restantes"} tone="purple"/>
      </KpiGrid>

      <Card className="holiday-calendar-card">
        <div className="card-head">
          <div><p className="eyebrow">CALENDÁRIO ANUAL</p><h2>Visão por mês</h2></div>
          <div className="holiday-legend">
            {(Object.keys(holidayScopeLabel) as RhHolidayScope[]).map(scope => <span key={scope}><i className={`holiday-dot ${scope}`}/>{holidayScopeLabel[scope]}</span>)}
          </div>
        </div>
        <div className="holiday-months">
          {MONTHS.map((monthName, monthIndex) => {
            const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
            const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
            return <section key={monthName} className="holiday-month" aria-label={`${monthName} de ${year}`}>
              <h3>{monthName}</h3>
              <div className="holiday-grid">
                {WEEKDAYS_SHORT.map((label, index) => <span key={`h${index}`} className="holiday-weekday">{label}</span>)}
                {Array.from({ length: firstWeekday }, (_, index) => <span key={`e${index}`}/>)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                  const day = index + 1;
                  const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const holiday = byDate.get(iso);
                  const weekday = (firstWeekday + index) % 7;
                  const classes = ["holiday-day", weekday === 0 || weekday === 6 ? "weekend" : "", iso === today ? "today" : "", holiday ? `is-holiday ${holiday.scope}` : ""].filter(Boolean).join(" ");
                  return <span key={iso} className={classes} title={holiday ? `${holiday.name} · ${holidayScopeLabel[holiday.scope]}` : undefined}>{day}</span>;
                })}
              </div>
            </section>;
          })}
        </div>
      </Card>

      <Card className="holiday-list-card">
        <div className="card-head"><div><p className="eyebrow">LISTA</p><h2>Feriados de {year}</h2></div></div>
        <div className="holiday-list">
          {holidays.map((holiday: RhHoliday) => {
            const { day, month } = isoParts(holiday.date);
            const past = holiday.date < today;
            return <div key={holiday.id} className={past ? "holiday-row past" : "holiday-row"}>
              <span className="holiday-date"><b>{String(day).padStart(2, "0")}</b><small>{MONTHS[month - 1].slice(0, 3)}</small></span>
              <span className="holiday-name"><b>{holiday.name}</b><small>{WEEKDAYS_LONG[isoWeekday(holiday.date)]}{holiday.location ? ` · ${holiday.location}` : ""}{!holiday.dayOff ? " · com expediente" : ""}</small></span>
              <Status tone={scopeTone[holiday.scope]}>{holidayScopeLabel[holiday.scope]}</Status>
            </div>;
          })}
        </div>
      </Card>
    </>}
  </>;
}
