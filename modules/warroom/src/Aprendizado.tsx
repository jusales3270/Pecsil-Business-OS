"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * War Room › Conselho › Aprendizado (J5): o que a SARA aprendeu. As lições (o que alguém ensinou na conversa
 * ou o que a vigia perguntou à área), cada uma com quem ensinou e quem decidiu; e, por tipo de achado, o que o
 * histórico da vigia mostra (calculado pela plataforma, não pelo modelo). Lição é contexto, nunca dado.
 */
type Licao = {
  id: string; modulo: string; area: string; origem: "conversa" | "vigia"; efeito: "contexto" | "silenciar"; texto: string; ensinada_por_nome: string | null;
  situacao: "proposta" | "ativa" | "recusada" | "desativada"; pedida_a: string[]; decidida_por_nome: string | null; decidida_em: string | null; nota: string | null; created_at: string;
};
type Tipo = {
  tipo: string; area: string; titulo: string; vezes: number; respondidas: number; naoEProblema: number; resolvidos: number; resolvidosDepoisDeTratar: number;
  diasParaResolver: number | null; recorrente: boolean; propoeSilencio: boolean; silenciado: boolean; ultimaVez: string;
};
type Quadro = { licoes: Licao[]; tipos: Tipo[]; semTabela?: boolean };

const SITUACAO: Record<Licao["situacao"], string> = { proposta: "Esperando a área", ativa: "Valendo", recusada: "Não aprovada", desativada: "Desativada" };
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const num = (n: number | null) => (n === null ? "—" : String(n).replace(".", ","));

export function Aprendizado() {
  const [q, setQ] = useState<Quadro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mexendo, setMexendo] = useState<string | null>(null);
  const [todas, setTodas] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/central/aprendizado").catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j) { setErro(j?.error === "FORBIDDEN" ? "Sem permissão para o aprendizado." : "Não foi possível carregar o aprendizado."); return; }
    setErro(null); setQ(j as Quadro);
  }, []);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);

  const desativar = async (l: Licao) => {
    setMexendo(l.id); setAviso(null);
    const r = await fetch("/api/sara/central/aprendizado", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: l.id }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setMexendo(null);
    if (!r?.ok) { setAviso(j?.error ?? "Não foi possível desativar agora."); return; }
    setAviso(l.efeito === "silenciar" ? "Desativada: a vigia volta a avisar este tipo." : "Desativada: as SARAs deixam de usar esta lição.");
    void carregar();
  };

  const valendo = (q?.licoes ?? []).filter((l) => l.situacao === "proposta" || l.situacao === "ativa");
  const lista = todas ? q?.licoes ?? [] : valendo;
  return (
    <section className="aprend" aria-labelledby="aprend-titulo">
      <header className="vigia-topo">
        <div>
          <h3 id="aprend-titulo">Aprendizado</h3>
          <p>O que a SARA aprendeu com as respostas das áreas e com o que as pessoas ensinam na conversa. Toda lição passa por quem decide na área antes de valer, e é contexto para as respostas: os números continuam vindo das consultas.</p>
        </div>
      </header>
      {aviso && <p className="vigia-aviso" role="status">{aviso}</p>}
      {erro && <p className="vigia-aviso erro" role="alert">{erro}</p>}

      <h4 className="aprend-sub">Lições</h4>
      {q && q.licoes.length > 0 && (
        <div className="vigia-filtro" role="group" aria-label="Quais lições">
          <button type="button" aria-pressed={!todas} onClick={() => setTodas(false)}>Valendo e esperando · {valendo.length}</button>
          <button type="button" aria-pressed={todas} onClick={() => setTodas(true)}>Todas (180 dias) · {q.licoes.length}</button>
        </div>
      )}
      {q && !lista.length && (
        <p className="vigia-vazio">{q.licoes.length ? "Nenhuma lição valendo ou esperando agora." : "Nenhuma lição ainda. Quando alguém corrigir a SARA central ou explicar uma regra do negócio, ela propõe a lição a quem decide na área. A vigia também pergunta quando uma área diz \"Não é problema\" várias vezes ao mesmo aviso."}</p>
      )}
      <div className="vigia-lista">
        {lista.map((l) => (
          <article key={l.id} className={`aprend-licao s-${l.situacao}`}>
            <header>
              <span className="vigia-area">{l.area}</span>
              <span className="aprend-tipo">{l.efeito === "silenciar" ? "Parar de avisar" : "Regra do negócio"}</span>
              <span className={`aprend-situacao s-${l.situacao}`}>{SITUACAO[l.situacao]}</span>
            </header>
            <p>{l.texto}</p>
            <footer>
              <span>{l.origem === "vigia" ? "Perguntado pela vigia" : `Ensinou: ${l.ensinada_por_nome ?? "alguém da empresa"}`} · {dia(l.created_at)}</span>
              <span>
                {l.situacao === "proposta" ? (l.pedida_a.length ? `Pedida a ${l.pedida_a.join(", ")}` : "Esta área não tem quem decide cadastrado")
                  : `${l.situacao === "ativa" ? "Aprovou" : l.situacao === "recusada" ? "Não aprovou" : "Desativou"}: ${l.decidida_por_nome ?? "—"}${l.decidida_em ? ` · ${dia(l.decidida_em)}` : ""}`}
              </span>
            </footer>
            {l.nota && <p className="aprend-nota">“{l.nota}”</p>}
            {(l.situacao === "ativa" || l.situacao === "proposta") && (
              <button type="button" className="aprend-desativar" disabled={mexendo === l.id} onClick={() => void desativar(l)}>{mexendo === l.id ? "Desativando…" : "Desativar"}</button>
            )}
          </article>
        ))}
      </div>

      <h4 className="aprend-sub">O que a vigia aprendeu (90 dias)</h4>
      <p className="vigia-vazio">Calculado pela plataforma a partir dos achados e das respostas: não é opinião do modelo. Recorrente sobe de impacto no próximo achado.</p>
      {q && !q.tipos.length && <p className="vigia-vazio">Ainda não há histórico de achados.</p>}
      {q && q.tipos.length > 0 && (
        <div className="aprend-tabela" role="region" aria-label="Histórico da vigia por tipo" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Área</th><th scope="col">Aviso</th><th scope="col" className="n">Vezes</th><th scope="col" className="n">Respondidas</th>
                <th scope="col" className="n">Não é problema</th><th scope="col" className="n">Saíram dos avisos</th><th scope="col" className="n">Depois de “Vou tratar”</th>
                <th scope="col" className="n">Dias para sair (mediana)</th><th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {q.tipos.map((t) => (
                <tr key={t.tipo}>
                  <td>{t.area}</td><td className="aviso">{t.titulo}</td><td className="n">{t.vezes}</td><td className="n">{t.respondidas}</td><td className="n">{t.naoEProblema}</td>
                  <td className="n">{t.resolvidos}</td><td className="n">{t.resolvidosDepoisDeTratar}</td><td className="n">{num(t.diasParaResolver)}</td>
                  <td>{[t.recorrente && "Recorrente", t.silenciado && "Em silêncio (a área pediu)", !t.silenciado && t.propoeSilencio && "Perguntar se pode parar"].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
