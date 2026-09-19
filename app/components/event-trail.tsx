"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Status } from "../../packages/design-system";
import { EVENT_MODULES, findEventType } from "../../modules/event-catalog";

type ModuleEvent = {
  id: number;
  module: string;
  type: string;
  summary: string;
  actor: string | null;
  occurredAt: string;
};

const PERIODS = [
  [1, "Hoje e ontem"],
  [7, "Últimos 7 dias"],
  [30, "Últimos 30 dias"],
  [90, "Últimos 90 dias"],
] as const;

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/**
 * Linha do tempo da trilha de eventos: o que cada módulo anunciou, em ordem.
 * Hoje ninguém reage a esses eventos; eles são a base das integrações entre
 * departamentos e da SARA.
 */
export function EventTrailView() {
  const [moduleCode, setModuleCode] = useState("");
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<{ key: string; events: ModuleEvent[]; error: string } | null>(null);
  const key = `${moduleCode}|${days}`;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(days) });
    if (moduleCode) params.set("module", moduleCode);
    fetch(`/api/eventos?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "Sem acesso a Eventos." : "Não foi possível carregar os eventos.");
        return response.json();
      })
      .then((data) => setResult({ key, events: data.events, error: "" }))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setResult({ key, events: [], error: reason.message });
      });
    return () => controller.abort();
  }, [key, days, moduleCode]);

  const loading = result?.key !== key;
  const events = useMemo(() => (loading ? [] : result?.events ?? []), [loading, result]);
  const groups = useMemo(() => {
    const byDay = new Map<string, ModuleEvent[]>();
    for (const event of events) byDay.set(dayKey(event.occurredAt), [...(byDay.get(dayKey(event.occurredAt)) ?? []), event]);
    return [...byDay.entries()];
  }, [events]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">FUNDAÇÃO · TRILHA DE EVENTOS</p>
          <h1>Eventos</h1>
          <p>
            O que acontece em cada módulo, na ordem em que acontece. É a base para os departamentos conversarem entre si e para a SARA
            acompanhar a operação.
          </p>
        </div>
      </div>
      <Card className="md-card">
        <div className="md-toolbar event-filters">
          <label>
            <span>Módulo</span>
            <select value={moduleCode} onChange={(e) => setModuleCode(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(EVENT_MODULES).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Período</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <Status tone="info">{loading ? "Carregando…" : `${events.length} ${events.length === 1 ? "evento" : "eventos"}`}</Status>
        </div>
        {!loading && result?.error && <p className="user-admin-error">{result.error}</p>}
        {!loading && !result?.error && events.length === 0 && (
          <div className="user-admin-empty">
            Nenhum evento no período. Os eventos começam a aparecer conforme as pessoas usam os módulos: cotações, compras,
            visitas, títulos, férias, acessos.
          </div>
        )}
        <div className="event-trail">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h3>{day}</h3>
              <ol>
                {items.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.occurredAt}>{timeOf(event.occurredAt)}</time>
                    <span className="event-body">
                      <b>{event.summary}</b>
                      <small>
                        {EVENT_MODULES[event.module] ?? event.module} · {findEventType(event.type)?.label ?? event.type}
                        {event.actor ? ` · por ${event.actor}` : " · automático"}
                      </small>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </Card>
    </>
  );
}
