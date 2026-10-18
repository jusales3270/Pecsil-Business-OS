"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Fundação › O que a SARA aprendeu (proprietário, 18/10/2026). O que a equipe de SARAs colheu das conversas:
 * as habilidades que ela propôs (rotinas para trabalho repetitivo — só o proprietário ativa), as lacunas
 * (pedidos que ela não conseguiu atender: o que construir), as respostas ruins (👎) e o uso por módulo.
 * Veem o proprietário e a Auditoria; decidir é do proprietário.
 */

type Passo = { ferramenta: string; para_que: string; entrada?: Record<string, unknown> };
type Habilidade = { id: string; modulo: string; nome: string; descricao: string; gatilhos: string[]; passos: Passo[]; formato: string | null; origem: "conversa" | "analise";
  evidencia: { vezes?: number; exemplos?: string[] }; situacao: "proposta" | "ativa" | "recusada" | "arquivada"; proposta_por: string | null; decidido_por: string | null;
  decidido_em: string | null; motivo: string | null; usos: number; ultimo_uso: string | null; criada_em: string };
type Lacuna = { id: string; modulo: string; assunto: string; pergunta: string | null; pessoa: string | null; quando: string; destino: string; destino_por: string | null };
type Modulo = { modulo: string; conversas: number; pessoas: number; respostas: number; nota_media: number | null; avaliadas: number; ruins: number; fora_do_escopo: number; tokens: number };
type Ruim = { modulo: string; nota: number; quando: string; pessoa: string | null; pergunta: string | null; resposta: string };
type Dados = { pode_decidir: boolean; modulos: Modulo[]; lacunas: Lacuna[]; ruins: Ruim[]; habilidades: Habilidade[]; rotulos: Record<string, string>; consultas: Record<string, string> };

const DESTINO: Record<string, string> = { pendente: "A decidir", roadmap: "Vai para o roadmap", ja_existe: "Já existe na tela", nao_fazer: "Não fazer" };
const SITUACAO: Record<string, string> = { proposta: "Proposta", ativa: "Ativa", recusada: "Recusada", arquivada: "Arquivada" };
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const mil = (n: number) => n.toLocaleString("pt-BR");

export function SaraAprendizado({ notify }: { notify: (m: string) => void }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [verDecididas, setVerDecididas] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/aprendizado", { cache: "no-store" });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(b.error || "Não foi possível carregar."); return; }
    setErro(""); setD(b as Dados);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const rot = (m: string) => d?.rotulos[m] ?? m;
  const consulta = (n: string) => d?.consultas[n] ?? n.replace(/_/g, " ");
  // Lacunas agrupadas por módulo e assunto (o mesmo pedido, escrito de jeitos parecidos).
  const grupos = useMemo(() => {
    const m = new Map<string, { modulo: string; assunto: string; itens: Lacuna[] }>();
    for (const l of d?.lacunas ?? []) {
      if (!verDecididas && l.destino !== "pendente") continue;
      const k = `${l.modulo}|${normal(l.assunto)}`;
      const g = m.get(k) ?? { modulo: l.modulo, assunto: l.assunto, itens: [] };
      g.itens.push(l); m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.itens.length - a.itens.length);
  }, [d, verDecididas]);

  const decidir = async (corpo: object, msg: string) => {
    setOcupado(msg);
    const r = await fetch("/api/sara/aprendizado", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
    const b = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) { notify(b.error || "Não foi possível salvar."); return; }
    notify(msg); void carregar();
  };
  const analisar = async () => {
    setOcupado("Lendo as conversas…");
    const r = await fetch("/api/sara/aprendizado", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ analisar: true }) });
    const b = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) { notify(b.error || "A análise não foi possível agora."); return; }
    const novas = (b.resultado ?? []).reduce((s: number, x: { propostas: string[] }) => s + x.propostas.length, 0);
    notify(novas ? `${novas} habilidade(s) proposta(s) a partir das conversas.` : "Nenhum trabalho repetitivo novo nas conversas dos últimos 60 dias.");
    void carregar();
  };

  if (erro) return <Callout variant="warning" title="O que a SARA aprendeu">{erro}</Callout>;
  if (!d) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;
  const propostas = d.habilidades.filter((h) => h.situacao === "proposta");
  const ativas = d.habilidades.filter((h) => h.situacao === "ativa");
  const outras = d.habilidades.filter((h) => h.situacao === "recusada" || h.situacao === "arquivada");
  const pendentes = d.lacunas.filter((l) => l.destino === "pendente").length;
  const respostas = d.modulos.reduce((s, m) => s + m.respostas, 0);

  return (
    <div className="aprendeu">
      <div className="page-head">
        <div>
          <p className="eyebrow">SEGUNDO CÉREBRO · SARA</p>
          <h1>O que a SARA aprendeu</h1>
          <p>O que a equipe de SARAs colheu das conversas nos últimos 90 dias: as habilidades que ela propõe para trabalhos repetitivos, os pedidos que ela ainda não consegue atender e as respostas que não agradaram.</p>
        </div>
        <div className="icms-acoes">
          {d.pode_decidir && <Button type="button" onClick={() => void analisar()} disabled={Boolean(ocupado)}>{ocupado === "Lendo as conversas…" ? ocupado : "Procurar trabalhos repetitivos"}</Button>}
          <Button type="button" variant="secondary" onClick={() => void carregar()}>Atualizar</Button>
        </div>
      </div>

      <div className="aprendeu-kpis">
        <div><small>Respostas da SARA</small><b>{mil(respostas)}</b></div>
        <div><small>Habilidades propostas</small><b>{propostas.length}</b></div>
        <div><small>Habilidades ativas</small><b>{ativas.length}</b></div>
        <div><small>Lacunas a decidir</small><b>{pendentes}</b></div>
      </div>

      <section className="aprendeu-bloco" aria-label="Habilidades propostas">
        <header><h2>Habilidades propostas</h2><Status tone={propostas.length ? "attention" : "neutral"}>{propostas.length}</Status></header>
        <p className="aprendeu-ajuda">A SARA propõe uma habilidade quando percebe um trabalho repetitivo. Ativa, ela vira um atalho ⚡ na SARA do módulo e só usa consultas que a pessoa já pode fazer. Não grava nada.</p>
        {!propostas.length ? <p className="aprendeu-vazio">Nenhuma proposta agora.{d.pode_decidir ? " Use \"Procurar trabalhos repetitivos\" para ler as conversas." : ""}</p> : propostas.map((h) => (
          <article key={h.id} className="aprendeu-habilidade">
            <div className="aprendeu-hab-topo"><b>⚡ {h.nome}</b><span>{rot(h.modulo)} · {h.origem === "analise" ? "da análise das conversas" : "proposta numa conversa"} · {h.evidencia?.vezes ?? 1}× visto</span></div>
            <p>{h.descricao}</p>
            <dl>
              <div><dt>Quando pedir</dt><dd>{h.gatilhos.map((g) => `"${g}"`).join(" · ")}</dd></div>
              <div><dt>Passos</dt><dd><ol>{h.passos.map((p, i) => <li key={i}><b>{consulta(p.ferramenta)}</b> — {p.para_que}</li>)}</ol></dd></div>
              {h.formato && <div><dt>Como apresenta</dt><dd>{h.formato}</dd></div>}
              {h.evidencia?.exemplos?.length ? <div><dt>Pedidos parecidos</dt><dd>{h.evidencia.exemplos.slice(0, 3).map((e) => `"${e}"`).join(" · ")}</dd></div> : null}
            </dl>
            {d.pode_decidir && (
              <div className="aprendeu-acoes">
                <Button type="button" disabled={Boolean(ocupado)} onClick={() => void decidir({ habilidade: { id: h.id, situacao: "ativa" } }, `Habilidade "${h.nome}" ativada.`)}>Ativar</Button>
                <Button type="button" variant="secondary" disabled={Boolean(ocupado)} onClick={() => void decidir({ habilidade: { id: h.id, situacao: "recusada" } }, `Habilidade "${h.nome}" recusada.`)}>Recusar</Button>
              </div>
            )}
          </article>
        ))}
        {ativas.length > 0 && (
          <>
            <h3>Ativas</h3>
            <div className="aprendeu-tabela"><table>
              <thead><tr><th>Habilidade</th><th>Módulo</th><th>Usos</th><th>Último uso</th><th>Ativada por</th>{d.pode_decidir && <th />}</tr></thead>
              <tbody>{ativas.map((h) => <tr key={h.id}><td>⚡ {h.nome}</td><td>{rot(h.modulo)}</td><td>{h.usos}</td><td>{data(h.ultimo_uso)}</td><td>{h.decidido_por ?? "—"}</td>
                {d.pode_decidir && <td><button type="button" className="almox-link" onClick={() => void decidir({ habilidade: { id: h.id, situacao: "arquivada" } }, `Habilidade "${h.nome}" arquivada.`)}>Arquivar</button></td>}</tr>)}</tbody>
            </table></div>
          </>
        )}
        {outras.length > 0 && <p className="aprendeu-vazio">{outras.length} fora de uso: {outras.map((h) => `${h.nome} (${SITUACAO[h.situacao].toLowerCase()})`).join(" · ")}</p>}
      </section>

      <section className="aprendeu-bloco" aria-label="Lacunas">
        <header><h2>O que a SARA ainda não consegue responder</h2><Status tone={pendentes ? "attention" : "neutral"}>{pendentes}</Status>
          <label className="aprendeu-filtro"><input type="checkbox" checked={verDecididas} onChange={(e) => setVerDecididas(e.target.checked)} /> mostrar as já decididas</label></header>
        <p className="aprendeu-ajuda">Pedidos do trabalho que nenhuma consulta da SARA atende (falta de permissão não entra). Os mais repetidos primeiro: é a lista do que construir.</p>
        {!grupos.length ? <p className="aprendeu-vazio">Nenhuma lacuna {verDecididas ? "" : "a decidir "}nos últimos 90 dias.</p> : (
          <div className="aprendeu-tabela"><table>
            <thead><tr><th>Pedido</th><th>Módulo</th><th>Vezes</th><th>Pessoas</th><th>Último</th><th>Exemplo</th><th>Destino</th></tr></thead>
            <tbody>{grupos.map((g) => {
              const pessoas = new Set(g.itens.map((i) => i.pessoa)).size;
              const destino = g.itens.every((i) => i.destino === g.itens[0].destino) ? g.itens[0].destino : "pendente";
              return (
                <tr key={`${g.modulo}${g.assunto}`}>
                  <td>{g.assunto}</td><td>{rot(g.modulo)}</td><td>{g.itens.length}</td><td>{pessoas}</td><td>{data(g.itens[0].quando)}</td>
                  <td className="aprendeu-exemplo">{g.itens[0].pergunta ? `"${g.itens[0].pergunta.slice(0, 120)}"` : "—"}</td>
                  <td>{d.pode_decidir
                    ? <select className="icms-select" value={destino} disabled={Boolean(ocupado)} aria-label={`Destino de ${g.assunto}`}
                        onChange={(e) => void decidir({ lacunas: { ids: g.itens.map((i) => i.id), destino: e.target.value } }, `Destino: ${DESTINO[e.target.value]}.`)}>
                        {Object.entries(DESTINO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    : DESTINO[destino]}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="aprendeu-bloco" aria-label="Respostas ruins">
        <header><h2>Respostas que não agradaram (👎)</h2><Status tone={d.ruins.length ? "attention" : "neutral"}>{d.ruins.length}</Status></header>
        {!d.ruins.length ? <p className="aprendeu-vazio">Nenhuma resposta avaliada como ruim.</p> : d.ruins.map((r, i) => (
          <article key={i} className="aprendeu-ruim">
            <span>{rot(r.modulo)} · {data(r.quando)}{r.pessoa ? ` · ${r.pessoa}` : ""}</span>
            {r.pergunta && <p><b>Pergunta:</b> {r.pergunta}</p>}
            <p><b>Resposta:</b> {r.resposta}</p>
          </article>
        ))}
      </section>

      <section className="aprendeu-bloco" aria-label="Uso por módulo">
        <header><h2>Uso por módulo</h2></header>
        {!d.modulos.length ? <p className="aprendeu-vazio">A SARA ainda não foi usada.</p> : (
          <div className="aprendeu-tabela"><table>
            <thead><tr><th>Módulo</th><th>Conversas</th><th>Pessoas</th><th>Respostas</th><th>Nota média</th><th>👎</th><th>Fora do escopo</th><th>Tokens</th></tr></thead>
            <tbody>{d.modulos.map((m) => <tr key={m.modulo}><td>{rot(m.modulo)}</td><td>{m.conversas}</td><td>{m.pessoas}</td><td>{m.respostas}</td>
              <td>{m.nota_media != null ? `${String(m.nota_media).replace(".", ",")} (${m.avaliadas})` : "—"}</td><td>{m.ruins}</td><td>{m.fora_do_escopo}</td><td>{mil(m.tokens)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
