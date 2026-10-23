"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * War Room › Conselho › Vigia (J3): o quadro dos achados da SARA central. Cada achado é um gargalo que ela
 * viu nos avisos e nos Parados, com a evidência, a contenção, para quem foi, a resposta e o efeito. O que
 * vem do modelo aparece marcado como análise da IA, com a confiança.
 */
type Envio = { nome: string; resposta?: string | null; cobrancas?: number };
type Achado = {
  id: string; area: string; titulo: string; por_que: string; evidencias: { area: string; titulo: string; detalhe: string | null }[]; impacto: "alto" | "medio" | "baixo";
  ligacoes: string[]; contencao: string[]; confianca: "alta" | "media" | "baixa"; origem: "modelo" | "plataforma"; situacao: string; envios: Envio[]; efeito: string | null; created_at: string;
};
type Rodada = { id: string; disparo: string; situacao: string; sinais: number; achados_novos: number; enviados: number; modelo: string | null; resumo: string | null; erro: string | null; created_at: string };
type Quadro = { rodadas: Rodada[]; achados: Achado[]; responsaveis: { modulo: string; area: string; pessoas: string[] }[] };

const SITUACAO: Record<string, string> = {
  aberto: "Na fila para enviar", enviado: "Esperando resposta", tratando: "Vou tratar", ajuda: "Pediu ajuda", nao_e_problema: "Não é problema",
  resolvido: "Resolvido", sem_responsavel: "Sem responsável com acesso", silenciado: "Em silêncio (a área disse que não é problema)",
};
const IMPACTO = { alto: "Impacto alto", medio: "Impacto médio", baixo: "Impacto baixo" };
const CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ABERTOS = new Set(["aberto", "enviado", "tratando", "ajuda", "sem_responsavel"]);

export function Vigia() {
  const [q, setQ] = useState<Quadro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/central/vigia").catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j) { setErro(j?.error === "FORBIDDEN" ? "Sem permissão para a vigia." : "Não foi possível carregar a vigia."); return; }
    setErro(null); setQ(j as Quadro);
  }, []);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);

  const rodar = async () => {
    setRodando(true); setAviso(null);
    const r = await fetch("/api/sara/central/vigia", { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setRodando(false);
    if (!r?.ok) { setAviso(j?.error ?? "A vigia não rodou agora."); return; }
    setAviso(`${j.sinais} sinais lidos · ${j.novos} ${j.novos === 1 ? "achado novo" : "achados novos"} · ${j.enviados} ${j.enviados === 1 ? "enviado" : "enviados"} a quem decide · ${j.resolvidos} ${j.resolvidos === 1 ? "resolvido" : "resolvidos"}`);
    void carregar();
  };

  const ultima = q?.rodadas[0];
  const lista = (q?.achados ?? []).filter((a) => verTodos || ABERTOS.has(a.situacao));
  return (
    <section className="vigia" aria-labelledby="vigia-titulo">
      <header className="vigia-topo">
        <div>
          <h3 id="vigia-titulo">Vigia</h3>
          <p>Todo dia, de segunda a sábado, às 6h30, ela lê os avisos de todas as áreas e o que está parado, liga uma coisa à outra e leva cada gargalo a quem decide, como Decisão para você.</p>
        </div>
        <button type="button" className="vigia-rodar" onClick={() => void rodar()} disabled={rodando}>{rodando ? "Lendo a empresa…" : "Rodar a vigia agora"}</button>
      </header>
      {aviso && <p className="vigia-aviso" role="status">{aviso}</p>}
      {erro && <p className="vigia-aviso erro" role="alert">{erro}</p>}
      {ultima && (
        <p className="vigia-ultima">
          Última leitura: {quando(ultima.created_at)}{ultima.disparo === "manual" ? " (pedida aqui)" : ""} · {ultima.situacao === "falhou" ? `falhou: ${ultima.erro ?? ""}` : `${ultima.sinais} sinais, ${ultima.achados_novos} achados novos, ${ultima.enviados} enviados`}
          {ultima.resumo && <><br /><span className="vigia-ia">Análise da SARA (IA):</span> {ultima.resumo}</>}
        </p>
      )}
      {q && !q.rodadas.length && <p className="vigia-vazio">A vigia ainda não rodou. A primeira leitura sai no próximo dia útil às 6h30, ou agora, pelo botão.</p>}
      {q && q.achados.length > 0 && (
        <div className="vigia-filtro" role="group" aria-label="Quais achados">
          <button type="button" aria-pressed={!verTodos} onClick={() => setVerTodos(false)}>Em aberto · {q.achados.filter((a) => ABERTOS.has(a.situacao)).length}</button>
          <button type="button" aria-pressed={verTodos} onClick={() => setVerTodos(true)}>Todos (45 dias) · {q.achados.length}</button>
        </div>
      )}
      {q && q.rodadas.length > 0 && !lista.length && <p className="vigia-vazio">Nenhum achado em aberto.</p>}
      <div className="vigia-lista">
        {lista.map((a) => (
          <article key={a.id} className={`vigia-achado ${a.impacto} ${ABERTOS.has(a.situacao) ? "" : "fechado"}`}>
            <header>
              <span className={`vigia-impacto ${a.impacto}`}>{IMPACTO[a.impacto]}</span>
              <span className="vigia-area">{a.area}{a.ligacoes.length ? ` → afeta ${a.ligacoes.length} ${a.ligacoes.length === 1 ? "área" : "áreas"}` : ""}</span>
              <span className={`vigia-situacao s-${a.situacao}`}>{SITUACAO[a.situacao] ?? a.situacao}</span>
            </header>
            <b>{a.titulo}</b>
            {a.por_que && <p>{a.por_que}</p>}
            {a.evidencias.length > 0 && (
              <ul className="vigia-evidencias">{a.evidencias.map((e, i) => <li key={i}><em>{e.area}:</em> {e.titulo}{e.detalhe ? `. ${e.detalhe}` : ""}</li>)}</ul>
            )}
            {a.contencao.length > 0 && (
              <div className="vigia-contencao"><small>Para conter</small><ol>{a.contencao.map((c, i) => <li key={i}>{c}</li>)}</ol></div>
            )}
            <footer>
              <span>{a.envios.length ? `Para ${a.envios.map((e) => `${e.nome}${e.resposta ? ` (${e.resposta})` : e.cobrancas ? ` (lembrado ${e.cobrancas}×)` : ""}`).join(", ")}` : "Ainda não enviado"}</span>
              <span>{a.origem === "modelo" ? `Análise da SARA (IA) · confiança ${CONFIANCA[a.confianca]}` : "Dos avisos da plataforma"} · {quando(a.created_at)}</span>
            </footer>
            {a.efeito && <p className={`vigia-efeito${a.situacao === "resolvido" ? " resolvido" : ""}`}>{a.efeito}</p>}
          </article>
        ))}
      </div>
      {q && (
        <details className="vigia-quem">
          <summary>Quem decide em cada área</summary>
          <ul>{q.responsaveis.map((r) => <li key={r.modulo}><b>{r.area}:</b> {r.pessoas.length ? r.pessoas.join(", ") : "ninguém definido (o achado fica só aqui)"}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
