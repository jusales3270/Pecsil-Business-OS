"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Kpi, KpiGrid, Status } from "../../packages/design-system";
import { contabilizar, formatarData, formatarHoras, horaDoApontamento, minutosDaPassagem, naFabrica, saidaParaExibir, type TerceiroApontamento } from "../../lib/rh/terceiros-core";

/**
 * RH › Terceiros: acompanhamento de quem está na fábrica, com base nos
 * apontamentos da Portaria (entrada e saída continuam exclusivas da Portaria),
 * e o quadro de terceiros: quem a Portaria pode escolher ao registrar a
 * entrada. Com "Terceiros" em Operar, o RH inclui e exclui pessoas do quadro.
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

type PessoaQuadro = { id: string; nome: string; incluido_por: string | null; incluido_por_nome: string | null; incluido_em: string };

async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error === "FORBIDDEN" ? "Sem permissão para esta ação." : body?.error || "Não foi possível concluir." };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor." };
  }
}

/** Quadro de terceiros: a lista de prestadores da Portaria. Quem tem Operar inclui e exclui. */
function QuadroTerceiros({ podeEditar, notify }: { podeEditar: boolean; notify?: (mensagem: string) => void }) {
  const [quadro, setQuadro] = useState<PessoaQuadro[] | null>(null);
  const [erro, setErro] = useState("");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const res = await chamar<{ quadro: PessoaQuadro[] }>("/api/rh/terceiros/quadro");
    if (!res.ok) { setErro(res.error); return; }
    setErro("");
    setQuadro(res.data.quadro);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const incluir = async (event: React.FormEvent) => {
    event.preventDefault();
    if (nome.trim().length < 2) { setErro("Informe o nome do terceiro."); return; }
    setSalvando(true);
    const res = await chamar<{ nome: string }>("/api/rh/terceiros/quadro", { method: "POST", body: JSON.stringify({ nome }) });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    setNome("");
    notify?.(`${res.data.nome} incluído no quadro. Já aparece para a Portaria.`);
    await carregar();
  };

  const excluir = async (pessoa: PessoaQuadro) => {
    if (confirmar !== pessoa.id) { setConfirmar(pessoa.id); return; }
    setSalvando(true);
    const res = await chamar<{ nome: string }>(`/api/rh/terceiros/quadro?id=${pessoa.id}`, { method: "DELETE" });
    setSalvando(false);
    setConfirmar(null);
    if (!res.ok) { setErro(res.error); return; }
    notify?.(`${res.data.nome} excluído do quadro. Os apontamentos já feitos continuam no histórico.`);
    await carregar();
  };

  return (
    <Card className="absence-card">
      <div className="absence-toolbar">
        <div><p className="eyebrow">QUADRO</p><h2>Quadro de terceiros</h2></div>
        {quadro && <Status tone="neutral">{quadro.length} {quadro.length === 1 ? "pessoa" : "pessoas"}</Status>}
      </div>
      <p className="terceiros-quadro-texto">Quem a Portaria pode escolher ao registrar a entrada de um terceiro.{podeEditar ? " Excluir tira a pessoa da lista; as horas já apontadas continuam no histórico e no relatório." : ""}</p>
      {podeEditar && (
        <form className="terceiros-quadro-form" onSubmit={incluir}>
          <input value={nome} onChange={(event) => { setNome(event.target.value); setErro(""); }} placeholder="Nome do terceiro" maxLength={80} aria-label="Nome do terceiro" />
          <Button type="submit" disabled={salvando}>{salvando ? "Gravando…" : "Incluir no quadro"}</Button>
        </form>
      )}
      {erro && <p className="terceiros-quadro-erro" role="alert">{erro}</p>}
      {!quadro && !erro && <div className="hr-empty"><b>Carregando…</b></div>}
      {quadro && !quadro.length && <div className="hr-empty"><b>Nenhum terceiro no quadro</b><small>{podeEditar ? "Inclua acima quem presta serviço na fábrica." : "O RH inclui quem presta serviço na fábrica."}</small></div>}
      {/* div, não ul: `.ds-card ul > li` formata toda lista de cartão como checklist. */}
      {quadro && quadro.length > 0 && (
        <div className="terceiros-quadro" role="list">
          {quadro.map((pessoa) => (
            <div key={pessoa.id} role="listitem">
              <span><b>{pessoa.nome}</b><small>{pessoa.incluido_por
                ? `incluído por ${pessoa.incluido_por_nome ?? "—"} em ${new Date(pessoa.incluido_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : "já estava na lista da Portaria"}</small></span>
              {podeEditar && (
                <button type="button" className={`terceiros-quadro-excluir${confirmar === pessoa.id ? " confirmar" : ""}`} onClick={() => void excluir(pessoa)} onBlur={() => setConfirmar((c) => (c === pessoa.id ? null : c))} disabled={salvando} aria-label={confirmar === pessoa.id ? `Confirmar exclusão de ${pessoa.nome}` : `Excluir ${pessoa.nome} do quadro`}>
                  {confirmar === pessoa.id ? "Confirmar exclusão" : "Excluir"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function TerceirosSection({ podeEditar = false, notify }: { podeEditar?: boolean; notify?: (mensagem: string) => void }) {
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
  // Como a Portaria calculou: passagem sem minutos (sem saída ou saída em outro dia) não soma.
  const minutosDoDia = apontamentos.reduce((soma, a) => soma + (contabilizar(a).minutos ?? 0), 0);
  const lidoEm = estado.status === "ready" ? estado.lidoEm : null;

  return <>
    <div className="page-head hr-page-head">
      <div>
        <p className="eyebrow">RH · TERCEIROS</p>
        <h1>Terceiros na fábrica</h1>
        <p>Acompanhamento das entradas e saídas registradas pela Portaria e o quadro de terceiros. Os apontamentos são feitos e corrigidos só na Portaria.</p>
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
      <Kpi label="Horas no dia" value={formatarHoras(minutosDoDia)} caption="Como a Portaria calculou" tone="green" />
    </KpiGrid>

    {estado.status === "error" && <Card className="absence-card"><div className="hr-empty"><b>{estado.mensagem}</b></div></Card>}

    {ehHoje && estado.status === "ready" && (
      <Card className="absence-card">
        <div className="absence-toolbar"><div><p className="eyebrow">AGORA</p><h2>Na fábrica</h2></div>{lidoEm && <Status tone="info">Atualizado às {lidoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</Status>}</div>
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
          const { situacao, minutos } = contabilizar(a);
          return <div className="terceiros-row" key={a.id}>
            <span><b>{a.nome}</b></span>
            <span data-label="Entrada">{entrada}</span>
            <span data-label="Saída">{saidaParaExibir(a) ?? "—"}</span>
            <span data-label="Horas">{situacao === "contabilizada" && minutos !== null
              ? formatarHoras(minutos)
              : situacao === "sem-saida"
                ? (ehHoje ? <Status tone="success">Na fábrica</Status> : <Status tone="attention">Sem saída</Status>)
                : <Status tone="attention">Não contabilizada</Status>}</span>
          </div>;
        })}
        {estado.status === "ready" && !apontamentos.length && <div className="hr-empty"><b>Nenhum apontamento neste dia</b><small>A Portaria não registrou entradas de terceiros.</small></div>}
      </div>
    </Card>

    <QuadroTerceiros podeEditar={podeEditar} notify={notify} />
  </>;
}
