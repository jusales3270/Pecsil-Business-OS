"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, DetailRows, Kpi, KpiGrid, Modal, Status, type DetailRow } from "../../packages/design-system";
import {
  businessDaysInYear,
  HOLIDAY_SCOPES,
  holidayScopeLabel,
  isoParts,
  isoWeekday,
  validateHolidayDraft,
  type RhHoliday,
  type RhHolidayCalendar,
  type RhHolidayDraft,
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

/** Feriado em edição: existente, ou novo com a data pré-preenchida. */
type Editing = { holiday: RhHoliday } | { newDate: string };

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatLong(date: string) {
  const { day, month } = isoParts(date);
  return `${String(day).padStart(2, "0")} de ${MONTHS[month - 1].toLowerCase()}`;
}

export function HolidaysSection({ notify }: { notify?: (message: string) => void }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [editing, setEditing] = useState<Editing | null>(null);

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
  }, [year, reload]);

  const changeYear = (next: number) => {
    setState({ status: "loading" });
    setYear(next);
  };

  const holidays = useMemo(() => (state.status === "ready" ? state.calendar.holidays : []), [state]);
  const canEdit = state.status === "ready" && state.calendar.canEdit;
  const byDate = useMemo(() => new Map(holidays.map(h => [h.date, h])), [holidays]);
  const today = todayIso();
  const next = holidays.find(h => h.date >= today);
  const onWeekdays = holidays.filter(h => h.dayOff && ![0, 6].includes(isoWeekday(h.date))).length;
  const pending = holidays.filter(h => h.pendingReview).length;
  const [detail, setDetail] = useState<{ title: string; subtitle: string; rows: DetailRow[]; empty: string } | null>(null);
  const holidayRow = (h: RhHoliday): DetailRow => ({
    key: h.id,
    title: h.name,
    subtitle: `${WEEKDAYS_LONG[isoWeekday(h.date)]}${h.location ? ` · ${h.location}` : ""}${h.dayOff ? "" : " · sem folga"}`,
    status: { tone: scopeTone[h.scope], label: holidayScopeLabel[h.scope] },
    meta: formatLong(h.date),
  });
  const openAll = () => setDetail({ title: `Feriados de ${year}`, subtitle: `${holidays.length} datas no calendário`, rows: holidays.map(holidayRow), empty: "Nenhum feriado cadastrado." });
  const openWeekdays = () => setDetail({
    title: "Feriados em dias úteis", subtitle: "Folgas que caem de segunda a sexta e tiram dia útil do ano",
    rows: holidays.filter(h => h.dayOff && ![0, 6].includes(isoWeekday(h.date))).map(holidayRow), empty: "Nenhum feriado cai em dia útil.",
  });
  const openBusinessDays = () => {
    const rows: DetailRow[] = MONTHS.map((name, index) => {
      let weekdays = 0;
      for (let day = new Date(Date.UTC(year, index, 1)); day.getUTCMonth() === index; day.setUTCDate(day.getUTCDate() + 1)) {
        if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) weekdays++;
      }
      const off = holidays.filter(h => h.dayOff && isoParts(h.date).month === index + 1 && ![0, 6].includes(isoWeekday(h.date))).length;
      return { key: name, title: name, subtitle: off ? `${weekdays} dias de seg–sex, menos ${off} ${off === 1 ? "feriado" : "feriados"}` : `${weekdays} dias de seg–sex`, meta: String(weekdays - off) };
    });
    setDetail({ title: `Dias úteis em ${year}`, subtitle: `${businessDaysInYear(year, holidays)} no ano, mês a mês`, rows, empty: "" });
  };
  const openUpcoming = () => setDetail({
    title: "Próximos feriados", subtitle: "Do mais próximo ao último do ano",
    rows: holidays.filter(h => h.date >= today).map(holidayRow), empty: "Não há mais feriados neste ano.",
  });

  const openDay = (iso: string) => {
    if (!canEdit) return;
    const holiday = byDate.get(iso);
    setEditing(holiday ? { holiday } : { newDate: iso });
  };

  const afterSave = (message: string, savedYear?: number) => {
    setEditing(null);
    notify?.(message);
    if (savedYear && savedYear !== year) changeYear(savedYear);
    else setReload(value => value + 1);
  };

  return <>
    <div className="page-head hr-page-head">
      <div>
        <p className="eyebrow">RH · CALENDÁRIO</p>
        <h1>Feriados {year}</h1>
        <p>Base oficial da Pecsil para cálculos de férias, jornada e prazos em dias úteis.</p>
      </div>
      <div className="holiday-head-actions">
        <div className="holiday-year" role="group" aria-label="Ano do calendário">
          <button type="button" onClick={() => changeYear(year - 1)} aria-label="Ano anterior">‹</button>
          <b>{year}</b>
          <button type="button" onClick={() => changeYear(year + 1)} aria-label="Próximo ano">›</button>
        </div>
        {canEdit && <Button onClick={() => setEditing({ newDate: `${year}-01-01` })}>+ Novo feriado</Button>}
      </div>
    </div>

    {state.status === "loading" && <Card className="holiday-empty"><b>Carregando calendário…</b></Card>}

    {state.status === "error" && <Card className="holiday-empty"><b>{state.message}</b></Card>}

    {state.status === "ready" && !holidays.length && (
      <Card className="holiday-empty">
        <b>Nenhum feriado cadastrado para {year}</b>
        <small>{canEdit ? "Use \"Novo feriado\" para montar o calendário deste ano." : `O calendário de ${year} ainda não foi importado.`}</small>
      </Card>
    )}

    {state.status === "ready" && holidays.length > 0 && <>
      {pending > 0 && (
        <div className="holiday-review" role="status">
          <b>{pending} {pending === 1 ? "feriado aguarda" : "feriados aguardam"} conferência</b>
          <small>
            Completados a partir do calendário do ano anterior, porque o Secullum ainda não publicou {year} completo.
            {canEdit ? " Abra cada um, ajuste se preciso e salve para confirmar." : " O RH fará a conferência."}
          </small>
        </div>
      )}

      <KpiGrid>
        <Kpi label="Feriados no ano" value={String(holidays.length)} caption={`${holidays.filter(h => h.scope === "nacional").length} nacionais`} tone="blue" onOpen={openAll}/>
        <Kpi label="Em dias úteis" value={String(onWeekdays)} caption="Folgas de segunda a sexta" tone="amber" onOpen={openWeekdays}/>
        <Kpi label="Dias úteis no ano" value={String(businessDaysInYear(year, holidays))} caption="Seg–sex menos feriados" tone="green" onOpen={openBusinessDays}/>
        <Kpi label="Próximo feriado" value={next ? formatLong(next.date) : "—"} caption={next ? next.name : "Sem feriados restantes"} tone="purple" onOpen={openUpcoming}/>
      </KpiGrid>
      {detail && <Modal eyebrow="RH · CALENDÁRIO" title={detail.title} subtitle={detail.subtitle} onClose={() => setDetail(null)}><DetailRows rows={detail.rows} empty={detail.empty}/></Modal>}

      <Card className="holiday-calendar-card">
        <div className="card-head">
          <div><p className="eyebrow">CALENDÁRIO ANUAL</p><h2>Visão por mês</h2>{canEdit && <p>Clique em um dia para cadastrar ou editar.</p>}</div>
          <div className="holiday-legend">
            {HOLIDAY_SCOPES.map(scope => <span key={scope}><i className={`holiday-dot ${scope}`}/>{holidayScopeLabel[scope]}</span>)}
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
                  const classes = [
                    "holiday-day",
                    weekday === 0 || weekday === 6 ? "weekend" : "",
                    iso === today ? "today" : "",
                    holiday ? `is-holiday ${holiday.scope}` : "",
                    holiday?.pendingReview ? "pending" : "",
                  ].filter(Boolean).join(" ");
                  const title = holiday ? `${holiday.name} · ${holidayScopeLabel[holiday.scope]}${holiday.pendingReview ? " · a conferir" : ""}` : undefined;
                  return canEdit
                    ? <button key={iso} type="button" className={classes} title={title ?? "Cadastrar feriado"} aria-label={holiday ? `Editar ${holiday.name}, ${formatLong(iso)}` : `Cadastrar feriado em ${formatLong(iso)}`} onClick={() => openDay(iso)}>{day}</button>
                    : <span key={iso} className={classes} title={title}>{day}</span>;
                })}
              </div>
            </section>;
          })}
        </div>
      </Card>

      <Card className="holiday-list-card">
        <div className="card-head"><div><p className="eyebrow">LISTA</p><h2>Feriados de {year}</h2></div></div>
        <div className="holiday-list">
          {holidays.map(holiday => {
            const { day, month } = isoParts(holiday.date);
            const content = <>
              <span className="holiday-date"><b>{String(day).padStart(2, "0")}</b><small>{MONTHS[month - 1].slice(0, 3)}</small></span>
              <span className="holiday-name"><b>{holiday.name}</b><small>{WEEKDAYS_LONG[isoWeekday(holiday.date)]}{holiday.location ? ` · ${holiday.location}` : ""}{!holiday.dayOff ? " · com expediente" : ""}</small></span>
              <span className="holiday-tags">
                {holiday.pendingReview && <Status tone="attention">A conferir</Status>}
                <Status tone={scopeTone[holiday.scope]}>{holidayScopeLabel[holiday.scope]}</Status>
              </span>
            </>;
            const className = holiday.date < today ? "holiday-row past" : "holiday-row";
            return canEdit
              ? <button key={holiday.id} type="button" className={`${className} editable`} onClick={() => setEditing({ holiday })} aria-label={`Editar ${holiday.name}`}>{content}</button>
              : <div key={holiday.id} className={className}>{content}</div>;
          })}
        </div>
      </Card>
    </>}

    {editing && <HolidayForm editing={editing} onClose={() => setEditing(null)} onSaved={afterSave}/>}
  </>;
}

function HolidayForm({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (message: string, year?: number) => void }) {
  const existing = "holiday" in editing ? editing.holiday : null;
  const [draft, setDraft] = useState<RhHolidayDraft>(() => existing
    ? { date: existing.date, name: existing.name, scope: existing.scope, location: existing.location, dayOff: existing.dayOff }
    : { date: "newDate" in editing ? editing.newDate : "", name: "", scope: "nacional", location: null, dayOff: true });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RhHolidayDraft>(key: K, value: RhHolidayDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = validateHolidayDraft(draft);
    if (!parsed.ok) return setError(parsed.error);
    setSaving(true);
    try {
      const response = await fetch(existing ? `/api/rh/holidays/${existing.id}` : "/api/rh/holidays", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.draft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error ?? "Não foi possível salvar o feriado.");
      onSaved(`${parsed.draft.name}: feriado ${existing ? "atualizado" : "cadastrado"} no calendário.`, isoParts(parsed.draft.date).year);
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setSaving(true);
    try {
      const response = await fetch(`/api/rh/holidays/${existing.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error ?? "Não foi possível excluir o feriado.");
      onSaved(`${existing.name}: feriado removido do calendário.`);
    } catch {
      setError("Sem conexão com o servidor. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="form-layer" onMouseDown={onClose}>
    <form className="holiday-form" onSubmit={submit} onMouseDown={event => event.stopPropagation()} aria-label={existing ? "Editar feriado" : "Novo feriado"}>
      <header>
        <div>
          <p className="eyebrow">RH · CALENDÁRIO</p>
          <h2>{existing ? "Editar feriado" : "Novo feriado"}</h2>
          <p>{existing?.pendingReview ? "Completado a partir do ano anterior. Confira os dados e salve para confirmar." : "Os cálculos de dias úteis passam a considerar esta data."}</p>
        </div>
        <button type="button" className="holiday-form-close" onClick={onClose} aria-label="Fechar formulário">×</button>
      </header>

      <div className="doc-form-fields">
        <label>
          <span>Data *</span>
          <input type="date" value={draft.date} onChange={event => set("date", event.target.value)} required/>
        </label>
        <label>
          <span>Abrangência *</span>
          <select value={draft.scope} onChange={event => set("scope", event.target.value as RhHolidayScope)}>
            {HOLIDAY_SCOPES.map(scope => <option key={scope} value={scope}>{holidayScopeLabel[scope]}</option>)}
          </select>
        </label>
        <label className="field-wide">
          <span>Nome do feriado *</span>
          <input value={draft.name} onChange={event => set("name", event.target.value)} placeholder="Ex.: Aniversário de Itu" maxLength={120} required/>
        </label>
        <label>
          <span>Local</span>
          <input value={draft.location ?? ""} onChange={event => set("location", event.target.value || null)} placeholder="Ex.: Itu/SP" maxLength={60}/>
        </label>
        <label className="holiday-form-check">
          <input type="checkbox" checked={draft.dayOff} onChange={event => set("dayOff", event.target.checked)}/>
          <span>A Pecsil não trabalha nesta data</span>
        </label>
      </div>

      {error && <p className="holiday-form-error" role="alert">{error}</p>}

      <footer>
        {existing && (
          <button type="button" className="holiday-form-delete" onClick={remove} disabled={saving}>
            {confirmDelete ? "Confirmar exclusão" : "Excluir"}
          </button>
        )}
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button type="submit" disabled={saving}>{saving ? "Salvando…" : existing?.pendingReview ? "Salvar e confirmar" : "Salvar"}</Button>
      </footer>
    </form>
  </div>;
}
