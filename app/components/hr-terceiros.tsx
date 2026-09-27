"use client";

import { useEffect, useState } from "react";
import { Card, Kpi, KpiGrid, Status } from "../../packages/design-system";
import { formatarData, formatarHoras, horaDoApontamento, minutosDaPassagem, naFabrica, type TerceiroApontamento } from "../../lib/rh/terceiros-core";

/**
 * RH › Terceiros: acompanhamento de quem está na fábrica, com base nos
 * apontamentos da Portaria. Só leitura: entrada e saída continuam sendo
 * registradas exclusivamente pela Portaria.
 */

type Estado = { status: "loading" } | { status: "error"; mensagem: string } | { status: "ready"; apontamentos: TerceiroApontamento[]; lidoEm: Date };

const ATUALIZA_MS = 60_000;

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Minutos desde a entrada, para "há quanto tempo está dentro". */
function minutosDesde(entrada: string, agora: Date) {
  const agoraHm = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  return minutosDaPassagem(entrada, agoraHm) ?? 0;
}

export function TerceirosSection() {
  const [hoje] = useState(hojeLocal);
  const [data, setData] = useState(hoje);
  const [estado, setEstado] = useState<Estado>({ status: "loading" });
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/rh/terceiros?data=${data}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 403) throw new Error("Você não tem acesso aos terceiros no RH.");
        if (!response.ok) throw new Error("Não foi possível ler os apontamentos da Portaria agora.");
        return (await response.json()) as { apontamentos: TerceiroApontamento[] };
      })
      .then(({ apontamentos }) => { if (ativo) setEstado({ status: "ready", apontamentos, lidoEm: new Date() }); })
      .catch((error: Error) => { if (ativo) setEstado({ status: "error", mensagem: error.message }); });
    return () => { ativo = false; };
  }, [data, versao]);

  // Atualiza sozinho enquanto a tela está aberta, só no dia de hoje.
  useEffect(() => {
    if (data !== hoje) return;
    const timer = window.setInterval(() => setVersao((v) => v + 1), ATUALIZA_MS);
    return () => window.clearInterval(timer);
  }, [data, hoje]);

  const ehHoje = data === hoje;
  const apontamentos = estado.status === "ready" ? estado.apontamentos : [];
  const dentro = ehHoje ? naFabrica(apontamentos) : [];
  const pessoas = new Set(apontamentos.map((a) => a.nome.trim())).size;
  const minutosDoDia = apontamentos.reduce((soma, a) => {
    const entrada = horaDoApontamento(a.entrada);
    return soma + (entrada ? minutosDaPassagem(entrada, horaDoApontamento(a.saida)) ?? 0 : 0);
  }, 0);
  const lidoEm = estado.status === "ready" ? estado.lidoEm : null;

  return <>
    <div className="page-head hr-page-head">
      <div>
        <p className="eyebrow">RH · TERCEIROS</p>
        <h1>Terceiros na fábrica</h1>
        <p>Acompanhamento das entradas e saídas registradas pela Portaria. Os apontamentos são feitos e corrigidos só na Portaria.</p>
      </div>
      <label className="terceiros-date">
        <span>Dia</span>
        <input type="date" value={data} max={hoje} onChange={(event) => event.target.value && setData(event.target.value)} />
      </label>
    </div>

    <KpiGrid>
      <Kpi label="Na fábrica agora" value={ehHoje ? String(dentro.length) : "—"} caption={ehHoje ? "Entraram e ainda não saíram" : "Só no dia de hoje"} tone="blue" />
      <Kpi label="Pessoas no dia" value={String(pessoas)} caption={formatarData(data)} tone="teal" />
      <Kpi label="Passagens" value={String(apontamentos.length)} caption="Entradas registradas" tone="purple" />
      <Kpi label="Horas no dia" value={formatarHoras(minutosDoDia)} caption="Somente passagens com saída" tone="green" />
    </KpiGrid>

    {estado.status === "error" && <Card className="absence-card"><div className="hr-empty"><b>{estado.mensagem}</b></div></Card>}

    {ehHoje && estado.status === "ready" && (
      <Card className="absence-card">
        <div className="absence-toolbar"><div><p className="eyebrow">AGORA</p><h2>Na fábrica</h2></div>{lidoEm && <Status tone="info">Atualizado às {lidoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</Status>}</div>
        <div className="absence-table terceiros-table">
          <div className="absence-table-head"><span>Terceiro</span><span>Entrada</span><span>Dentro há</span><span>Situação</span></div>
          {dentro.map((a) => {
            const entrada = horaDoApontamento(a.entrada) ?? "—";
            return <div className="terceiros-row" key={a.id}>
              <span><b>{a.nome}</b></span>
              <span data-label="Entrada">{entrada}</span>
              <span data-label="Dentro há">{formatarHoras(minutosDesde(entrada, lidoEm ?? new Date()))}</span>
              <span data-label="Situação"><Status tone="success">Na fábrica</Status></span>
            </div>;
          })}
          {!dentro.length && <div className="hr-empty"><b>Nenhum terceiro na fábrica agora</b><small>Quem entrar aparece aqui assim que a Portaria registrar.</small></div>}
        </div>
      </Card>
    )}

    <Card className="absence-card">
      <div className="absence-toolbar"><div><p className="eyebrow">MOVIMENTO DO DIA</p><h2>{ehHoje ? "Hoje" : formatarData(data)}</h2></div></div>
      <div className="absence-table terceiros-table">
        <div className="absence-table-head"><span>Terceiro</span><span>Entrada</span><span>Saída</span><span>Horas</span></div>
        {estado.status === "loading" && <div className="hr-empty"><b>Carregando…</b></div>}
        {apontamentos.map((a) => {
          const entrada = horaDoApontamento(a.entrada) ?? "—";
          const saida = horaDoApontamento(a.saida);
          const minutos = entrada !== "—" ? minutosDaPassagem(entrada, saida) : null;
          return <div className="terceiros-row" key={a.id}>
            <span><b>{a.nome}</b></span>
            <span data-label="Entrada">{entrada}</span>
            <span data-label="Saída">{saida ?? "—"}</span>
            <span data-label="Horas">{minutos === null ? <Status tone="success">Na fábrica</Status> : formatarHoras(minutos)}</span>
          </div>;
        })}
        {estado.status === "ready" && !apontamentos.length && <div className="hr-empty"><b>Nenhum apontamento neste dia</b><small>A Portaria não registrou entradas de terceiros.</small></div>}
      </div>
    </Card>
  </>;
}
