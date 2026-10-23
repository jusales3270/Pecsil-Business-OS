"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "../../packages/design-system";

/**
 * "Documentos para você" (menu da conta): os PDFs que a SARA central enviou para a pessoa (relatórios e
 * cartas, com o timbre da empresa). O aviso chega no sino; tocar abre aqui, já no documento. Abrir o PDF
 * marca como aberto (quem enviou vê na War Room).
 */
type Recebido = { id: string; numero: string; tipo: "relatorio" | "carta"; titulo: string; paginas: number | null; enviado_por: string | null; enviado_em: string; aberto_em: string | null };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const TIPO = { relatorio: "Relatório", carta: "Carta" };

export function DocumentosParaVoce({ focoId, onClose }: { focoId?: string | null; onClose: () => void }) {
  const [lista, setLista] = useState<Recebido[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    void fetch("/api/sara/documentos", { cache: "no-store" }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) })).then(({ ok, j }) => {
      if (!vivo) return;
      if (!ok) setErro(j?.error ?? "Não foi possível carregar os documentos."); else setLista(j.documentos as Recebido[]);
    }).catch(() => vivo && setErro("Não foi possível carregar os documentos."));
    return () => { vivo = false; };
  }, []);
  const abrir = (id: string) => setLista((l) => l?.map((d) => (d.id === id && !d.aberto_em ? { ...d, aberto_em: new Date().toISOString() } : d)) ?? l);
  return (
    <Modal eyebrow="Conta" title="Documentos para você" subtitle="Relatórios e cartas em PDF que a SARA central enviou para você." onClose={onClose}>
      <div className="almox-form decisoes">
        {erro ? <p className="almox-erro" role="alert">{erro}</p> : !lista ? <p className="ds-detail-empty">Carregando…</p>
          : !lista.length ? <p className="ds-detail-empty">Nenhum documento recebido.</p> : null}
        {lista?.map((d) => (
          <article key={d.id} className={`decisao doc-recebido${d.aberto_em ? " respondida" : ""}${d.id === focoId ? " foco" : ""}`} aria-label={d.titulo}>
            <header><b>{d.titulo}</b><span className={d.aberto_em ? "decisao-resposta" : "doc-novo"}>{d.aberto_em ? "Aberto" : "Novo"}</span></header>
            <small className="decisao-nota">{TIPO[d.tipo] ?? "Documento"} {d.numero}{d.paginas ? ` · ${d.paginas} ${d.paginas === 1 ? "página" : "páginas"}` : ""} · enviado por {d.enviado_por ?? "SARA central"} em {quando(d.enviado_em)}</small>
            <footer><a className="ds-button primary doc-abrir" href={`/api/sara/documentos/${d.id}/pdf`} target="_blank" rel="noopener noreferrer" onClick={() => abrir(d.id)}>Abrir o PDF</a></footer>
          </article>
        ))}
        <footer><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
}
