"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Kpi, KpiGrid, Segmented, Status } from "../../packages/design-system";
import { FONTES, MODULOS, oQueMudou, rotuloAcao } from "../../lib/auditoria/rotulos";

/**
 * Fundação › Auditoria — quem entrou, abriu, fez, alterou e aprovou o quê. Junta as três trilhas
 * que o banco guarda desde 01/09/2026 (ações, eventos e entradas no sistema) e as telas abertas
 * (registradas dali em diante). Clicar num registro mostra o caminho dele (tudo o que aconteceu
 * com aquele orçamento, título, nota…).
 */

type Linha = {
  fonte: "acao" | "evento" | "login" | "tela"; quando: string; pessoa_id: string | null; pessoa_nome: string | null; pessoa_email: string | null;
  modulo: string; acao: string; resumo: string; entidade_tipo: string | null; entidade_id: string | null; risco: string; detalhes: Record<string, unknown> | null;
};
type Dados = { linhas: Linha[]; desde: string; ate: string; pessoas: { id: string; full_name: string | null; email: string | null }[]; ultimos: { profile_id: string; ultimo_login: string | null; ultima_atividade: string | null }[] };
type Fonte = "todas" | "acao" | "evento" | "login" | "tela";
const PERIODOS = [{ value: "1", label: "Hoje" }, { value: "7", label: "7 dias" }, { value: "30", label: "30 dias" }, { value: "90", label: "90 dias" }, { value: "365", label: "1 ano" }] as const;
type Periodo = (typeof PERIODOS)[number]["value"];
const TOM: Record<Linha["fonte"], "neutral" | "info" | "success" | "attention" | "purple"> = { acao: "info", evento: "success", login: "neutral", tela: "purple" };
const hora = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function AuditoriaCentral() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [fonte, setFonte] = useState<Fonte>("todas");
  const [pessoa, setPessoa] = useState("");
  const [modulo, setModulo] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [caminho, setCaminho] = useState<{ id: string; titulo: string } | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ dias: caminho ? "400" : periodo });
    if (fonte !== "todas" && !caminho) p.set("fonte", fonte);
    if (pessoa && !caminho) p.set("pessoa", pessoa);
    if (modulo && !caminho) p.set("modulo", modulo);
    if (buscaAplicada && !caminho) p.set("busca", buscaAplicada);
    if (caminho) p.set("entidade", caminho.id);
    return p.toString();
  }, [periodo, fonte, pessoa, modulo, buscaAplicada, caminho]);

  const carregar = useCallback(async (q: string) => {
    setCarregando(true);
    const r = await fetch(`/api/auditoria?${q}`, { cache: "no-store" }).catch(() => null);
    setCarregando(false);
    if (!r) { setErro("Sem conexão com o servidor."); return; }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(corpo.error ?? "Não foi possível carregar a auditoria."); return; }
    setErro("");
    setDados(corpo as Dados);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(params); }, 0); return () => clearTimeout(t); }, [carregar, params]);

  const linhas = useMemo(() => dados?.linhas ?? [], [dados]);
  const pessoas = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of dados?.pessoas ?? []) m.set(p.id, p.full_name || p.email || "—");
    for (const l of linhas) if (l.pessoa_id && !m.has(l.pessoa_id)) m.set(l.pessoa_id, l.pessoa_nome || l.pessoa_email || "—");
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [dados, linhas]);
  const conta = (f: Linha["fonte"]) => linhas.filter((l) => l.fonte === f).length;
  const sensiveis = linhas.filter((l) => l.risco === "high").length;

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">GOVERNANÇA</p><h1>Auditoria central</h1><p>Quem entrou, abriu, lançou, alterou, aprovou e excluiu o quê, com data e hora. Histórico desde 01/09/2026; as telas abertas passam a contar a partir de agora.</p></div>
        <div className="icms-acoes">
          <a className="ds-button secondary" href={`/api/auditoria?${params}&formato=csv`}>Exportar (CSV)</a>
        </div>
      </div>

      {caminho ? (
        <div className="aud-caminho">
          <div><b>Caminho do registro</b><small>{caminho.titulo} · tudo o que aconteceu com ele, do mais recente ao mais antigo</small></div>
          <Button variant="secondary" compact onClick={() => setCaminho(null)}>Voltar à trilha</Button>
        </div>
      ) : (
        <>
          <div className="aud-filtros">
            <Segmented<Periodo> options={PERIODOS.map((p) => ({ value: p.value, label: p.label }))} value={periodo} onChange={setPeriodo} ariaLabel="Período" compact />
            <select aria-label="Pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">Todas as pessoas</option>
              {pessoas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
            <select aria-label="Módulo" value={modulo} onChange={(e) => setModulo(e.target.value)}>
              <option value="">Todos os módulos</option>
              {Object.entries(MODULOS).filter(([k]) => !k.includes(".")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <form className="aud-busca" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca.trim()); }}>
              <input type="search" aria-label="Buscar" placeholder="Buscar (nome, nº, código, texto…)" value={busca} onChange={(e) => setBusca(e.target.value)} />
              <Button type="submit" variant="secondary" compact>Buscar</Button>
            </form>
          </div>
          <KpiGrid>
            <Kpi label="Ações" value={String(conta("acao"))} caption={sensiveis ? `${sensiveis} sensíveis` : "Lançou, alterou, excluiu, aprovou"} tone="blue" onOpen={() => setFonte("acao")} />
            <Kpi label="Eventos" value={String(conta("evento"))} caption="O que aconteceu nos módulos" tone="green" onOpen={() => setFonte("evento")} />
            <Kpi label="Entradas no sistema" value={String(conta("login"))} caption="Logins e saídas" tone="neutral" onOpen={() => setFonte("login")} />
            <Kpi label="Telas abertas" value={String(conta("tela"))} caption="Registradas a partir de agora" tone="purple" onOpen={() => setFonte("tela")} />
          </KpiGrid>
          <div className="almox-filtros">
            <Segmented<Fonte> options={[{ value: "todas", label: "Tudo" }, { value: "acao", label: "Ações" }, { value: "evento", label: "Eventos" }, { value: "login", label: "Entradas" }, { value: "tela", label: "Telas" }]} value={fonte} onChange={setFonte} ariaLabel="Tipo" compact />
          </div>
        </>
      )}

      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <section className="almox-bloco" aria-busy={carregando}>
          {linhas.length ? (
            <div className="aud-tabela" role="table">
              <div className="cabeca" role="row"><span>Quando</span><span>Quem</span><span>O quê</span><span>Módulo</span><span /></div>
              {linhas.map((l, k) => {
                const mudou = oQueMudou(l.detalhes);
                const titulo = `${rotuloAcao(l.acao)}${l.resumo ? ` · ${l.resumo}` : ""}`;
                return (
                  <div role="row" key={`${l.fonte}-${l.quando}-${k}`}>
                    <span className="aud-quando">{hora(l.quando)}</span>
                    <span className="nome">{l.pessoa_nome || (l.fonte === "login" ? l.pessoa_email : "Sistema")}{l.pessoa_email && l.pessoa_nome ? <small>{l.pessoa_email}</small> : null}</span>
                    <span className="nome aud-oque">
                      <span><Status tone={TOM[l.fonte]}>{FONTES[l.fonte]}</Status> {l.fonte === "evento" ? l.resumo : rotuloAcao(l.acao)}</span>
                      {l.fonte !== "evento" && l.resumo && <small>{l.resumo}</small>}
                      {mudou.map((m) => <small key={m} className="aud-mudou">{m}</small>)}
                      {l.risco === "high" && <small className="aud-sensivel">Operação sensível</small>}
                    </span>
                    <span>{MODULOS[l.modulo] ?? l.modulo}</span>
                    <span>{l.entidade_id && !caminho && l.fonte !== "login" && l.fonte !== "tela" && (
                      <button type="button" className="almox-link" onClick={() => setCaminho({ id: l.entidade_id!, titulo })}>Caminho</button>
                    )}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="finance-empty"><b>Nada neste período e filtro</b><small>Aumente o período ou limpe os filtros.</small></div>
          )}
          {linhas.length >= 400 && <p className="fiscal-nota-ajuda">Mostrando os 400 registros mais recentes. Use os filtros ou exporte o CSV (até 2.000).</p>}
        </section>
      )}
    </>
  );
}
