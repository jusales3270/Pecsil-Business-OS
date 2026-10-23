"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * War Room › Conselho › Crescimento (J4): o relatório semanal da SARA central. Tudo aqui é opinião da IA,
 * com a confiança à vista; recurso e concorrência sempre com o link de onde veio; a conta de cada
 * investimento (prazo de retorno, VPL, TIR, cenário pessimista) é da plataforma.
 */
type Conf = "alta" | "media" | "baixa";
type Conteudo = {
  resumo: string;
  ideias: { titulo: string; por_que: string; acao: string; area: string; confianca: Conf }[];
  recursos: { titulo: string; para_que: string; fonte_url: string; confianca: Conf }[];
  concorrencia: { titulo: string; o_que: string; implicacao: string; fonte_url: string; confianca: Conf }[];
  investimentos: { titulo: string; area: string; premissas: string[]; custo: number; ganhoMensal: number; risco: string; confianca: Conf;
    avaliacao: { paybackMeses: number | null; vpl: number; tirAnual: number | null; pessimista: { paybackMeses: number | null; vpl: number } } }[];
  premissas: string[]; descartados: string[];
};
type Rel = { id: string; semana: string; disparo: string; situacao: string; conteudo: Conteudo | null; buscas: number; erro: string | null; created_at: string };

const CONF = { alta: "alta", media: "média", baixa: "baixa" };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const meses = (m: number | null) => (m == null ? "não se paga" : `${m.toLocaleString("pt-BR")} ${m === 1 ? "mês" : "meses"}`);
const seguro = (u: string) => (/^https?:\/\//i.test(u) ? u : null);
const dominio = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const Ia = ({ c }: { c: Conf }) => <span className="cresc-ia">Opinião da SARA (IA) · confiança {CONF[c]}</span>;
const Fonte = ({ url }: { url: string }) => { const u = seguro(url); return u ? <a className="cresc-fonte" href={u} target="_blank" rel="noopener noreferrer">{dominio(u)} ↗</a> : null; };

export function Crescimento() {
  const [lista, setLista] = useState<Rel[] | null>(null);
  const [atual, setAtual] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/central/crescimento").catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j) { setErro("Não foi possível carregar os relatórios."); return; }
    setErro(null); setLista(j.relatorios as Rel[]);
  }, []);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);

  const gerar = async () => {
    setGerando(true); setAviso(null);
    const r = await fetch("/api/sara/central/crescimento", { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setGerando(false);
    if (!r?.ok) { setAviso(j?.error ?? "O relatório não saiu agora."); return; }
    setAtual(j.id); void carregar();
  };

  const feitos = (lista ?? []).filter((r) => r.situacao === "feito" && r.conteudo);
  const rel = feitos.find((r) => r.id === atual) ?? feitos[0];
  const c = rel?.conteudo;
  return (
    <section className="cresc" aria-labelledby="cresc-titulo">
      <header className="vigia-topo">
        <div>
          <h3 id="cresc-titulo">Crescimento</h3>
          <p>Toda segunda-feira, ela pensa na empresa: ideias que saem dos dados, novos recursos (fomento, crédito, editais), a concorrência e investimentos com a conta de retorno. A pesquisa na internet leva só o assunto (setor e região), nunca dado da empresa.</p>
        </div>
        <button type="button" className="vigia-rodar" onClick={() => void gerar()} disabled={gerando}>{gerando ? "Pesquisando e pensando… (até 3 min)" : "Gerar o relatório agora"}</button>
      </header>
      {aviso && <p className="vigia-aviso" role="status">{aviso}</p>}
      {erro && <p className="vigia-aviso erro" role="alert">{erro}</p>}
      {lista && !feitos.length && <p className="vigia-vazio">Ainda não há relatório. O primeiro sai na segunda-feira às 8h, ou agora, pelo botão.{lista[0]?.situacao === "falhou" ? ` O último pedido falhou: ${lista[0].erro ?? ""}` : ""}</p>}
      {feitos.length > 1 && (
        <label className="cresc-semana">Relatório <select value={rel?.id} onChange={(e) => setAtual(e.target.value)}>
          {feitos.map((r) => <option key={r.id} value={r.id}>semana de {r.semana.split("-").reverse().join("/")}{r.disparo === "manual" ? ` (pedido ${quando(r.created_at)})` : ""}</option>)}
        </select></label>
      )}
      {rel && c && (
        <div className="cresc-corpo">
          <p className="vigia-ultima">Semana de {rel.semana.split("-").reverse().join("/")} · gerado {quando(rel.created_at)} · {rel.buscas} buscas na internet</p>
          {c.resumo && <p className="cresc-resumo"><span className="vigia-ia">Análise da SARA (IA):</span> {c.resumo}</p>}

          <h4>Ideias que saem dos dados</h4>
          {c.ideias.length ? c.ideias.map((x, i) => (
            <article key={i} className="cresc-item"><b>{x.titulo}</b><p>{x.por_que}</p><p className="cresc-acao"><small>O que fazer</small> {x.acao}</p>
              <footer><span>Quem decide: {x.area}</span><Ia c={x.confianca} /></footer></article>
          )) : <p className="vigia-vazio">Nenhuma ideia passou na conferência dos números nesta semana.</p>}

          <h4>Novos recursos</h4>
          {c.recursos.length ? c.recursos.map((x, i) => (
            <article key={i} className="cresc-item"><b>{x.titulo}</b><p>{x.para_que}</p><footer><Fonte url={x.fonte_url} /><Ia c={x.confianca} /></footer></article>
          )) : <p className="vigia-vazio">A pesquisa não trouxe recurso que sirva agora.</p>}

          <h4>Concorrência e mercado</h4>
          {c.concorrencia.length ? c.concorrencia.map((x, i) => (
            <article key={i} className="cresc-item"><b>{x.titulo}</b><p>{x.o_que}</p><p className="cresc-acao"><small>Para a empresa</small> {x.implicacao}</p><footer><Fonte url={x.fonte_url} /><Ia c={x.confianca} /></footer></article>
          )) : <p className="vigia-vazio">Nada novo da concorrência nesta semana.</p>}

          <h4>Investimentos pontuais</h4>
          {c.investimentos.length ? c.investimentos.map((x, i) => (
            <article key={i} className="cresc-item">
              <b>{x.titulo}</b>
              <dl className="cresc-conta">
                <div><dt>Custo estimado</dt><dd>{brl(x.custo)}</dd></div>
                <div><dt>Ganho estimado</dt><dd>{brl(x.ganhoMensal)}/mês</dd></div>
                <div><dt>Retorno</dt><dd>{meses(x.avaliacao.paybackMeses)}</dd></div>
                <div><dt>VPL</dt><dd>{brl(x.avaliacao.vpl)}</dd></div>
                <div><dt>TIR</dt><dd>{x.avaliacao.tirAnual == null ? "—" : `${(x.avaliacao.tirAnual * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% ao ano`}</dd></div>
                <div><dt>Pessimista</dt><dd>{meses(x.avaliacao.pessimista.paybackMeses)} · VPL {brl(x.avaliacao.pessimista.vpl)}</dd></div>
              </dl>
              {x.premissas.length > 0 && <ul className="vigia-evidencias">{x.premissas.map((p, k) => <li key={k}>{p}</li>)}</ul>}
              {x.risco && <p><em>Risco:</em> {x.risco}</p>}
              <footer><span>Quem decide: {x.area}</span><Ia c={x.confianca} /></footer>
            </article>
          )) : <p className="vigia-vazio">Nenhum investimento proposto nesta semana.</p>}

          <p className="vigia-ultima">{c.premissas.join(" ")} Custo e ganho são estimativas da IA; a conta é da plataforma.{c.descartados.length ? ` ${c.descartados.length} ${c.descartados.length === 1 ? "item saiu" : "itens saíram"} na conferência (número sem fonte ou link que não veio da pesquisa).` : ""}</p>
        </div>
      )}
    </section>
  );
}
