"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "../../packages/design-system";

/**
 * "Decisões para você" (menu da conta): a pergunta que é da pessoa ou da área dela chega no sino e é
 * respondida aqui, escolhendo uma das opções (com observação, se quiser). A resposta fica gravada e o
 * proprietário é avisado, só para acompanhar. Dá para mudar a resposta depois (fica no histórico).
 */

type Decisao = { id: string; assunto: string; pergunta: string; detalhes: string[]; opcoes: string[]; resposta: string | null; nota: string | null; respondido_em: string | null; pedida_por: string | null; pedida_em: string };
const quando = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

function CartaoDecisao({ d, enviar, foco }: { d: Decisao; enviar: (d: Decisao, resposta: string, nota: string) => Promise<string | null>; foco: boolean }) {
  const [escolha, setEscolha] = useState<string | null>(null);
  const [nota, setNota] = useState(d.nota ?? "");
  const [mudar, setMudar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const aberta = !d.resposta || mudar;
  const responder = async () => {
    if (!escolha) return;
    setOcupado(true); setErro("");
    const e = await enviar(d, escolha, nota);
    setOcupado(false);
    if (e) setErro(e); else { setMudar(false); setEscolha(null); }
  };
  return (
    <article className={`decisao${d.resposta && !mudar ? " respondida" : ""}${foco ? " foco" : ""}`} aria-label={d.assunto}>
      <header><b>{d.assunto}</b>{d.resposta && !mudar && <span className="decisao-resposta">Você respondeu: {d.resposta}</span>}</header>
      <p>{d.pergunta}</p>
      {d.detalhes.length > 0 && <ul>{d.detalhes.map((x, k) => <li key={k}>{x}</li>)}</ul>}
      <small className="decisao-nota">Pedida por {d.pedida_por ?? "proprietário"} em {quando(d.pedida_em)}{d.respondido_em && !mudar ? ` · respondida em ${quando(d.respondido_em)}` : ""}</small>
      {d.resposta && !mudar && d.nota && <small className="decisao-nota">Sua observação: {d.nota}</small>}
      {aberta ? (
        <>
          <div className="decisao-opcoes" role="radiogroup" aria-label="Sua resposta">
            {d.opcoes.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={escolha === o} className={escolha === o ? "escolhida" : ""} onClick={() => setEscolha(o)}>{o}</button>
            ))}
          </div>
          <label className="decisao-obs">Observação (opcional)
            <textarea value={nota} maxLength={1000} rows={2} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: só com limite de valor; só para a Usinagem…" />
          </label>
          <footer>
            {mudar && <Button variant="secondary" onClick={() => { setMudar(false); setEscolha(null); setNota(d.nota ?? ""); }}>Cancelar</Button>}
            <Button onClick={() => void responder()} disabled={!escolha || ocupado}>{ocupado ? "Enviando…" : "Responder"}</Button>
          </footer>
        </>
      ) : (
        <footer><Button variant="secondary" onClick={() => setMudar(true)}>Mudar a resposta</Button></footer>
      )}
      {erro && <p className="almox-erro" role="alert">{erro}</p>}
    </article>
  );
}

export function DecisoesParaVoce({ focoId, onClose, notify }: { focoId?: string | null; onClose: () => void; notify: (m: string) => void }) {
  const [dados, setDados] = useState<{ pendentes: number; decisoes: Decisao[] } | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    const r = await fetch("/api/decisoes", { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) { setErro(j?.error ?? "Não foi possível carregar as decisões."); return; }
    setErro(""); setDados(j);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);
  const enviar = async (d: Decisao, resposta: string, nota: string) => {
    const r = await fetch("/api/decisoes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: d.id, resposta, nota }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) return j?.error ?? "Não foi possível enviar. Tente de novo.";
    notify(`Resposta registrada: ${resposta}.`);
    await carregar();
    return null;
  };
  const esperando = dados?.decisoes.filter((d) => !d.resposta) ?? [];
  const respondidas = dados?.decisoes.filter((d) => d.resposta) ?? [];
  return (
    <Modal eyebrow="Conta" title="Decisões para você" subtitle="Perguntas que são suas ou da sua área. Responda aqui: a resposta fica registrada e quem perguntou é avisado." onClose={onClose}>
      <div className="almox-form decisoes">
        {erro ? <p className="almox-erro" role="alert">{erro}</p> : !dados ? <p className="ds-detail-empty">Carregando…</p>
          : !dados.decisoes.length ? <p className="ds-detail-empty">Nenhuma decisão esperando por você.</p> : null}
        {esperando.length > 0 && <h4 className="decisoes-grupo">Esperando sua resposta ({esperando.length})</h4>}
        {esperando.map((d) => <CartaoDecisao key={d.id} d={d} enviar={enviar} foco={d.id === focoId} />)}
        {respondidas.length > 0 && <h4 className="decisoes-grupo">Respondidas</h4>}
        {respondidas.map((d) => <CartaoDecisao key={d.id} d={d} enviar={enviar} foco={d.id === focoId} />)}
        <footer><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
}
