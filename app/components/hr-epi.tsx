"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, DetailRows, Kpi, KpiGrid, Modal, Status, type DetailRow } from "../../packages/design-system";

/**
 * Ficha de EPI (NR-6): o que foi entregue a cada colaborador, com CA,
 * quantidade, data e assinatura de recebimento. Os dados vêm de
 * `GET /api/rh/epi`; nada de documento pessoal chega à tela.
 */

export type PpeDelivery = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  itemId: string;
  itemName: string;
  caNumber: string | null;
  quantity: number;
  deliveredOn: string;
  signedOn: string | null;
};

export type PpeState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; deliveries: PpeDelivery[] };

/** Carrega a ficha uma vez por montagem da seção de SST. */
export function usePpeData(enabled: boolean): PpeState {
  const [state, setState] = useState<PpeState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch("/api/rh/epi", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { deliveries: PpeDelivery[] };
      })
      .then(({ deliveries }) => { if (active) setState({ status: "ready", deliveries }); })
      .catch(() => { if (active) setState({ status: "error" }); });
    return () => { active = false; };
  }, [enabled]);
  return state;
}

const formatDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "–";

type EmployeePpe = {
  employeeId: string;
  name: string;
  department: string | null;
  deliveries: PpeDelivery[];
  unsigned: number;
  last: PpeDelivery;
};

function groupByEmployee(deliveries: PpeDelivery[]): EmployeePpe[] {
  const map = new Map<string, PpeDelivery[]>();
  for (const delivery of deliveries) map.set(delivery.employeeId, [...(map.get(delivery.employeeId) ?? []), delivery]);
  return [...map.entries()]
    .map(([employeeId, list]) => {
      const sorted = [...list].sort((a, b) => b.deliveredOn.localeCompare(a.deliveredOn));
      return {
        employeeId,
        name: sorted[0].employeeName,
        department: sorted[0].department,
        deliveries: sorted,
        unsigned: sorted.filter((d) => !d.signedOn).length,
        last: sorted[0],
      };
    })
    .sort((a, b) => b.unsigned - a.unsigned || a.name.localeCompare(b.name, "pt-BR"));
}

export function PpeSection({ state }: { state: PpeState }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"Todos" | "Sem assinatura">("Todos");
  const [selected, setSelected] = useState<EmployeePpe | null>(null);
  const [detail, setDetail] = useState<{ title: string; subtitle: string; rows: DetailRow[]; empty: string } | null>(null);

  const deliveries = useMemo(() => (state.status === "ready" ? state.deliveries : []), [state]);
  const people = useMemo(() => groupByEmployee(deliveries), [deliveries]);
  const [since] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const recent = deliveries.filter((d) => d.deliveredOn >= since).length;
  const unsigned = deliveries.filter((d) => !d.signedOn).length;
  const itemsWithoutCa = new Set(deliveries.filter((d) => !d.caNumber).map((d) => d.itemId)).size;

  const deliveryRow = (d: PpeDelivery): DetailRow => ({
    key: d.id,
    title: d.employeeName,
    subtitle: `${d.itemName}${d.caNumber && !d.itemName.includes(d.caNumber) ? ` · CA ${d.caNumber}` : ""} · ${d.quantity} ${d.quantity === 1 ? "unidade" : "unidades"}`,
    meta: formatDate(d.deliveredOn),
  });
  const openRecent = () => setDetail({
    title: "Entregas em 30 dias", subtitle: `Desde ${formatDate(since)}, da mais recente para a mais antiga`,
    rows: deliveries.filter((d) => d.deliveredOn >= since).map(deliveryRow), empty: "Nenhuma entrega nos últimos 30 dias.",
  });
  const openUnsigned = () => setDetail({
    title: "Entregas sem assinatura", subtitle: "Recebimento ainda não comprovado pelo colaborador (NR-6)",
    rows: deliveries.filter((d) => !d.signedOn).map(deliveryRow), empty: "Todas as entregas estão assinadas.",
  });
  const openPeople = () => setDetail({
    title: "Colaboradores com ficha", subtitle: "Quem tem ao menos uma entrega registrada",
    rows: [...people].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((p) => ({
      key: p.employeeId, title: p.name, subtitle: `${p.department ?? "—"} · última entrega ${formatDate(p.last.deliveredOn)}`,
      meta: `${p.deliveries.length}`,
      status: p.unsigned ? { tone: "attention", label: `${p.unsigned} sem assinatura` } : undefined,
    })),
    empty: "Nenhum colaborador com entrega registrada.",
  });
  const openWithoutCa = () => {
    const byItem = new Map<string, PpeDelivery[]>();
    for (const d of deliveries.filter((d) => !d.caNumber)) byItem.set(d.itemId, [...(byItem.get(d.itemId) ?? []), d]);
    setDetail({
      title: "Itens sem CA", subtitle: "EPI entregue sem número de Certificado de Aprovação informado",
      rows: [...byItem.values()].map((list) => ({
        key: list[0].itemId, title: list[0].itemName,
        subtitle: `Entregue a ${[...new Set(list.map((d) => d.employeeName))].join(", ")}`,
        meta: `${list.length} ${list.length === 1 ? "entrega" : "entregas"}`,
      })),
      empty: "Todos os itens entregues têm CA.",
    });
  };

  const needle = query.trim().toLocaleLowerCase("pt-BR");
  const visible = people
    .filter((p) => filter === "Todos" || p.unsigned > 0)
    .filter((p) => !needle || p.name.toLocaleLowerCase("pt-BR").includes(needle));

  if (state.status === "loading") {
    return <Card className="absence-card"><div className="hr-empty"><b>Carregando fichas de EPI…</b></div></Card>;
  }
  if (state.status === "error") {
    return <Card className="absence-card"><div className="hr-empty"><b>Não foi possível carregar as fichas de EPI</b><small>Tente de novo em instantes.</small></div></Card>;
  }

  return <>
    <KpiGrid>
      <Kpi label="Entregas em 30 dias" value={String(recent)} caption={`${deliveries.length} no histórico`} tone="blue" onOpen={openRecent}/>
      <Kpi label="Sem assinatura" value={String(unsigned)} caption={unsigned ? "Recebimento a comprovar" : "Todas comprovadas"} tone={unsigned ? "amber" : "green"} onOpen={openUnsigned}/>
      <Kpi label="Colaboradores com ficha" value={String(people.length)} caption="Com ao menos uma entrega" tone="teal" onOpen={openPeople}/>
      <Kpi label="Itens sem CA" value={String(itemsWithoutCa)} caption={itemsWithoutCa ? "Sem certificado informado" : "Todos com CA"} tone={itemsWithoutCa ? "amber" : "green"} onOpen={openWithoutCa}/>
    </KpiGrid>
    {detail && <Modal eyebrow="SST · EPI" title={detail.title} subtitle={detail.subtitle} onClose={() => setDetail(null)}><DetailRows rows={detail.rows} empty={detail.empty}/></Modal>}
    <Card className="absence-card">
      <div className="absence-toolbar">
        <div><p className="eyebrow">NR-6 · FICHA DE EPI</p><h2>Entregas por colaborador</h2></div>
        <label><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar colaborador..." aria-label="Buscar colaborador"/></label>
        <label><span>Situação</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filtrar por assinatura"><option>Todos</option><option>Sem assinatura</option></select></label>
      </div>
      <div className="absence-table">
        <div className="absence-table-head"><span>Colaborador</span><span>Última entrega</span><span>Entregas</span><span>Situação</span><span/></div>
        {visible.map((person) => <button key={person.employeeId} onClick={() => setSelected(person)}>
          <span className="absence-person"><i>{initialsOf(person.name)}</i><span><b>{person.name}</b><small>{person.department ?? "—"}</small></span></span>
          <span><b>{person.last.itemName}</b><small>{formatDate(person.last.deliveredOn)}</small></span>
          <span><b>{person.deliveries.length}</b><small>{((n) => `${n} ${n === 1 ? "item" : "itens"}`)(new Set(person.deliveries.map((d) => d.itemId)).size)}</small></span>
          <Status tone={person.unsigned ? "attention" : "success"}>{person.unsigned ? `${person.unsigned} sem assinatura` : "Assinado"}</Status>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6"/></svg>
        </button>)}
        {!visible.length && <div className="hr-empty"><b>{people.length ? "Nenhum colaborador encontrado" : "Nenhuma entrega de EPI registrada"}</b><small>{people.length ? "Altere a busca ou o filtro." : "As entregas aparecem aqui quando forem importadas ou registradas."}</small></div>}
      </div>
    </Card>
    {selected && <PpeDrawer person={selected} onClose={() => setSelected(null)}/>}
  </>;
}

function PpeDrawer({ person, onClose }: { person: EmployeePpe; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Agrupa por item (nome + CA), com o item entregue mais recentemente no topo.
  const byItem = new Map<string, PpeDelivery[]>();
  for (const delivery of person.deliveries) byItem.set(delivery.itemId, [...(byItem.get(delivery.itemId) ?? []), delivery]);
  const items = [...byItem.values()].sort((a, b) => b[0].deliveredOn.localeCompare(a[0].deliveredOn));

  return <div className="employee-layer" onMouseDown={onClose}>
    <aside className="sst-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label={`Ficha de EPI de ${person.name}`}>
      <header>
        <button onClick={onClose} aria-label="Fechar ficha de EPI"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg></span>
        <div><p className="eyebrow">SST · FICHA DE EPI</p><h2>{person.name}</h2><p>{person.department ?? "—"}</p></div>
        <Status tone={person.unsigned ? "attention" : "success"}>{person.unsigned ? `${person.unsigned} sem assinatura` : "Assinado"}</Status>
      </header>
      <div className="sst-drawer-content">
        <section className="ppe-summary">
          <span><small>Entregas</small><b>{person.deliveries.length}</b></span>
          <span><small>Itens</small><b>{items.length}</b></span>
          <span><small>Última entrega</small><b>{formatDate(person.last.deliveredOn)}</b></span>
        </section>
        {items.map((list) => <section className="ppe-item" key={list[0].itemId}>
          <h3>{list[0].itemName}<small>{list[0].caNumber ? `CA ${list[0].caNumber}` : "Sem CA"}</small></h3>
          <ul>{list.map((delivery) => <li key={delivery.id}>
            <span><b>{formatDate(delivery.deliveredOn)}</b><small>{delivery.quantity} {delivery.quantity === 1 ? "unidade" : "unidades"}</small></span>
            {delivery.signedOn
              ? <small className="ppe-signed">Assinado em {formatDate(delivery.signedOn)}</small>
              : <small className="ppe-unsigned">Sem assinatura</small>}
          </li>)}</ul>
        </section>)}
      </div>
    </aside>
  </div>;
}
