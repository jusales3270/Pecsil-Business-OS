"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Segmented, Status } from "../../../packages/design-system";
import { api, date, nomeMes } from "./comum";

/**
 * Fiscal › Calendário fiscal (N-06): declarações e guias da empresa, com a data já ajustada pelo feriado e o porquê.
 * As regras são parâmetros legais (rascunho até o contador conferir); o aviso dos próximos 7 dias vai para a SARA
 * do Fiscal e do Financeiro e, por elas, para o Bom dia. A agenda baixa em .ics para o Outlook ou o Google Agenda.
 */

type Ocorrencia = {
  codigo: string; nome: string; tipo: "guia" | "declaracao"; quem: "empresa" | "escritorio"; competencia: string;
  vencimento: string | null; original: string | null; ajuste: string | null; dependeRegime: boolean; aDefinir: boolean; ajusteAConferir: boolean; observacao: string | null;
  entrega: Entrega | null;
};
type Entrega = { obrigacao: string; periodo: string; entregue_em: string; recibo: string | null; document_id: string | null; observacao: string | null; nome?: string; competencia?: string };
type Dados = { hoje: string; de: string; ate: string; ocorrencias: Ocorrencia[]; entregas: Entrega[]; regime: string; modo: string | null; uf: string | null; aConferir: boolean; normas: string[] };
type Filtro = "todos" | "guia" | "declaracao";

const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const semana = (d: string) => DIA_SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400_000);
const prazo = (hoje: string, d: string) => { const n = dias(hoje, d); return n < 0 ? `passou há ${-n} dia(s)` : n === 0 ? "vence hoje" : n === 1 ? "vence amanhã" : `em ${n} dias`; };
const quando = (t: string) => new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ics = (t: string) => t.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

export function Calendario({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/fiscal/calendario");
    if (!r.ok) { setErro(r.error); return; }
    setErro(""); setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const comData = useMemo(() => (dados?.ocorrencias ?? []).filter((o) => o.vencimento && (filtro === "todos" || o.tipo === filtro)), [dados, filtro]);
  const aDefinir = (dados?.ocorrencias ?? []).filter((o) => o.aDefinir);
  const porMes = useMemo(() => {
    const m = new Map<string, Ocorrencia[]>();
    for (const o of comData) m.set(o.vencimento!.slice(0, 7), [...(m.get(o.vencimento!.slice(0, 7)) ?? []), o]);
    return [...m];
  }, [comData]);

  const baixarAgenda = () => {
    if (!dados) return;
    const agora = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const eventos = comData.filter((o) => o.vencimento! >= dados.hoje && !o.entrega).map((o) => {
      const d = o.vencimento!.replace(/-/g, "");
      const fim = new Date(Date.parse(`${o.vencimento}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10).replace(/-/g, "");
      return ["BEGIN:VEVENT", `UID:${o.codigo}-${o.vencimento}@ecos`, `DTSTAMP:${agora}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${fim}`,
        `SUMMARY:${ics(`${o.nome} (${o.competencia})`)}`, `DESCRIPTION:${ics(`${o.tipo === "guia" ? "Guia" : "Declaração"} · ${o.quem === "escritorio" ? "faz o escritório" : "faz a empresa"}${o.ajuste ? ` · ${o.ajuste}` : ""}${dados.aConferir ? " · prazo ainda a conferir pelo contador" : ""}`)}`,
        "BEGIN:VALARM", "TRIGGER:-P3D", "ACTION:DISPLAY", `DESCRIPTION:${ics(o.nome)}`, "END:VALARM", "END:VEVENT"].join("\r\n");
    });
    const texto = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ECOS//Calendario fiscal//PT", "CALSCALE:GREGORIAN", ...eventos, "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/calendar;charset=utf-8" }));
    a.download = `calendario-fiscal-${dados.hoje}.ics`; a.click(); URL.revokeObjectURL(a.href);
    notify(`${eventos.length} vencimento(s) na agenda, com lembrete 3 dias antes.`);
  };

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · CALENDÁRIO</p><h1>Calendário fiscal</h1><p>Declarações e guias da empresa, com a data já ajustada pelo feriado e o porquê. O que vence nos próximos 7 dias aparece nos avisos da SARA e no Bom dia.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          {dados.aConferir && <Callout variant="warning" title="Prazos ainda a conferir">As regras de vencimento estão nos Parâmetros legais como rascunho até o contador conferir ({dados.normas.join("; ")}).</Callout>}
          {dados.regime === "a_definir" && <Callout variant="info" title="Regime tributário ainda não definido">IRPJ e CSLL aparecem pelas duas regras (trimestral e estimativa mensal). Quem define o regime é o Fiscal, com o contador, em Parâmetros legais › Perfil da empresa.</Callout>}
          {aDefinir.length > 0 && (
            <section className="almox-bloco">
              <h3 className="ctb-titulo">Sem data ainda</h3>
              {aDefinir.map((o) => <p key={o.codigo} className="cal-definir"><b>{o.nome}</b> · {o.observacao}</p>)}
            </section>
          )}
          <div className="almox-filtros">
            <Segmented<Filtro> options={[{ value: "todos", label: "Tudo" }, { value: "guia", label: "Guias" }, { value: "declaracao", label: "Declarações" }]} value={filtro} onChange={setFiltro} ariaLabel="Tipo" compact />
            <Button variant="secondary" compact onClick={baixarAgenda} disabled={!comData.length}>Baixar agenda (.ics)</Button>
          </div>
          {porMes.length ? porMes.map(([mes, lista]) => (
            <section className="almox-bloco" key={mes}>
              <h3 className="ctb-titulo cal-mes">{nomeMes(mes)}</h3>
              <div className="vnd-tabela cal-tabela" role="table" aria-label={`Vencimentos de ${nomeMes(mes)}`}>
                <div className="cabeca" role="row"><span>Vencimento</span><span>Obrigação</span><span>Competência</span><span>Tipo</span><span>Quem faz</span><span>Prazo</span></div>
                {lista.map((o) => {
                  const n = dias(dados.hoje, o.vencimento!);
                  return (
                    <div role="row" key={`${o.codigo}-${o.vencimento}`} className={n < 0 ? "cal-passado" : undefined}>
                      <span className="nome">{date(o.vencimento)}<small>{semana(o.vencimento!)}</small></span>
                      <span className="nome">{o.nome}<small>{[o.ajuste, o.ajusteAConferir && !o.observacao ? "regra do dia não útil a conferir" : null, o.dependeRegime ? "depende do regime" : null, o.observacao].filter(Boolean).join(" · ")}</small></span>
                      <span>{o.competencia}</span>
                      <span>{o.tipo === "guia" ? "Guia" : "Declaração"}</span>
                      <span>{o.quem === "escritorio" ? "Escritório" : "Empresa"}</span>
                      <span>{o.entrega ? <Status tone="success">{`Entregue em ${date(o.entrega.entregue_em.slice(0, 10))}`}</Status> : n < 0 ? <Status tone="neutral">{prazo(dados.hoje, o.vencimento!)}</Status> : n <= 1 ? <Status tone="danger">{prazo(dados.hoje, o.vencimento!)}</Status> : n <= 7 ? <Status tone="attention">{prazo(dados.hoje, o.vencimento!)}</Status> : <Status tone="info">{prazo(dados.hoje, o.vencimento!)}</Status>}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )) : <div className="finance-empty"><b>Nada no período</b></div>}
          {dados.entregas.length > 0 && (
            <section className="almox-bloco">
              <h3 className="ctb-titulo">Entregas registradas</h3>
              <div className="vnd-tabela cal-entregas" role="table" aria-label="Entregas registradas">
                <div className="cabeca" role="row"><span>Obrigação</span><span>Competência</span><span>Entregue em</span><span>Recibo</span></div>
                {dados.entregas.map((e) => (
                  <div role="row" key={`${e.obrigacao}-${e.periodo}`}>
                    <span className="nome">{e.nome ?? e.obrigacao}{e.observacao && <small>{e.observacao}</small>}</span>
                    <span>{e.competencia ?? e.periodo}</span>
                    <span>{quando(e.entregue_em)}</span>
                    <span className="nome"><span className="cal-recibo">{e.recibo ?? "—"}</span>{e.document_id && <small><a className="almox-link" href={`/api/documentos/${e.document_id}/baixar`} target="_blank" rel="noreferrer">Abrir o recibo</a></small>}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <p className="fiscal-nota-ajuda">Período: {date(dados.de)} a {date(dados.ate)}. Dia útil = segunda a sexta, fora dos feriados dos Parâmetros legais{dados.uf ? ` (nacionais e de ${dados.uf}, quando houver)` : ""}.</p>
        </>
      )}
    </div>
  );
}
