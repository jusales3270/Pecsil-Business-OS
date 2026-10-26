"use client";

import { useCallback, useEffect, useState } from "react";
import { AcoesDocumento } from "./AcoesDocumento";

/**
 * War Room › Conselho › Documentos: o que a SARA central gerou em PDF (relatórios e cartas), para quem foi
 * enviado e se já abriram. Para pedir um documento, fale com a SARA central.
 */
type Envio = { para_nome: string | null; canal: string; enviado_em: string; aberto_em: string | null };
type Doc = { id: string; numero: string; tipo: "relatorio" | "carta"; titulo: string; paginas: number | null; criado_por_nome: string | null; created_at: string; meu: boolean; sara_documento_envios: Envio[] };
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const TIPO = { relatorio: "Relatório", carta: "Carta" };
const CANAL: Record<string, string> = { plataforma: "pela plataforma", whatsapp: "pelo WhatsApp", email: "por e-mail" };

export function Documentos() {
  const [lista, setLista] = useState<Doc[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/sara/documentos?todos=1", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !j) { setErro("Não foi possível carregar os documentos."); return; }
    setErro(null); setLista(j.documentos as Doc[]);
  }, []);
  useEffect(() => { const t = setTimeout(() => void carregar(), 0); return () => clearTimeout(t); }, [carregar]);
  return (
    <section className="cresc" aria-labelledby="docs-titulo">
      <header className="vigia-topo">
        <div>
          <h3 id="docs-titulo">Documentos</h3>
          <p>Relatórios e cartas em PDF, com o timbre da empresa, que a SARA central montou. Peça a ela (ex.: &ldquo;compare os últimos financiamentos quitados, faça um relatório e envie para a Ana&rdquo;): ela levanta os dados com as áreas, confere cada número, mostra a prévia e só envia com o seu Permitir. Daqui você abre, imprime e envia os que você pediu.</p>
        </div>
      </header>
      {erro && <p className="vigia-aviso erro" role="alert">{erro}</p>}
      {lista && !lista.length && <p className="vigia-vazio">Nenhum documento ainda.</p>}
      <div className="vigia-lista">
        {lista?.map((d) => (
          <article key={d.id} className="cresc-item doc-quadro">
            <b>{d.titulo}</b>
            <p>{TIPO[d.tipo] ?? "Documento"} {d.numero}{d.paginas ? ` · ${d.paginas} ${d.paginas === 1 ? "página" : "páginas"}` : ""} · {quando(d.created_at)}{d.criado_por_nome ? ` · pedido por ${d.criado_por_nome}` : ""}</p>
            <footer>
              <span>{d.sara_documento_envios.length ? d.sara_documento_envios.map((e) => `${e.para_nome ?? "?"} ${CANAL[e.canal] ?? e.canal}${e.canal === "plataforma" ? ` (${e.aberto_em ? `abriu ${quando(e.aberto_em)}` : "não abriu ainda"})` : ""}`).join(", ") : "Ainda não enviado"}</span>
              <AcoesDocumento id={d.id} numero={d.numero} titulo={d.titulo} podeEnviar={d.meu} onEnviado={() => void carregar()} />
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
