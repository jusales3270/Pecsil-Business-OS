"use client";

import { useCallback, useEffect, useState } from "react";
import { Status } from "../../packages/design-system";
import { rotuloDoSetor } from "../../lib/documentos/setores";

/**
 * "Documentos ligados" (Segundo Cérebro, Etapa 4): os documentos que citam esta entidade (nota,
 * fornecedor, cotação…), ligados por regra exata. Ligação provável (número citado) aparece para
 * confirmar ou descartar. Só aparece o que a pessoa pode abrir — o banco decide.
 */

export type TipoLigacao = "fornecedor" | "cliente" | "nota_icms" | "recebimento" | "titulo" | "cotacao" | "os";

type Ligacao = {
  id: string; rule: string; evidence: string | null; confidence: "exata" | "provavel"; status: "ativa" | "confirmada"; podeDecidir: boolean;
  documento: { id: string; title: string; original_name: string; module_code: string; created_at: string } | null;
};

const COMO: Record<string, string> = {
  origem: "enviado junto com este registro",
  chave_acesso: "pela chave de acesso",
  nf_cnpj: "pelo nº da nota e o CNPJ",
  cnpj: "pelo CNPJ",
  pela_nota: "pela nota fiscal",
  cotacao: "pelo nº da cotação/OC citado",
  os: "pelo nº da OS citado",
};
const quando = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function DocumentosLigados({ tipo, id, titulo = "Documentos ligados" }: { tipo: TipoLigacao; id: string | number; titulo?: string }) {
  const [lista, setLista] = useState<Ligacao[] | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/documentos/ligados?tipo=${tipo}&id=${encodeURIComponent(String(id))}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) { setErro("Não foi possível carregar os documentos ligados."); setLista([]); return; }
    setErro("");
    setLista(((await r.json()).ligacoes ?? []) as Ligacao[]);
  }, [tipo, id]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const decidir = async (l: Ligacao, decisao: "confirmada" | "descartada") => {
    const r = await fetch(`/api/documentos/ligacoes/${l.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisao }) }).catch(() => null);
    if (!r?.ok) { setErro((await r?.json().catch(() => ({})))?.error ?? "Não foi possível registrar."); return; }
    await carregar();
  };

  return (
    <section className="doc-ligados" aria-label={titulo}>
      <h3>{titulo}</h3>
      {lista === null && <p className="doc-ligados-vazio doc-ligados-carregando">Carregando…</p>}
      {lista && !lista.length && !erro && <p className="doc-ligados-vazio">Nenhum documento ligado.</p>}
      {erro && <p className="doc-ligados-vazio" role="alert">{erro}</p>}
      {lista?.map((l) => l.documento && (
        <div key={l.id} className="doc-ligado">
          <div className="doc-ligado-nome">
            <b title={l.documento.original_name}>{l.documento.title}</b>
            <small>{rotuloDoSetor(l.documento.module_code)} · {COMO[l.rule] ?? l.rule}{l.evidence ? ` (${l.evidence})` : ""} · {quando(l.documento.created_at)}</small>
          </div>
          <div className="doc-ligado-acoes">
            {l.confidence === "provavel" && l.status === "ativa" ? (
              <>
                <Status tone="attention">A confirmar</Status>
                {l.podeDecidir && <button type="button" className="doc-link" onClick={() => void decidir(l, "confirmada")}>Confirmar</button>}
                {l.podeDecidir && <button type="button" className="doc-link perigo" onClick={() => void decidir(l, "descartada")}>Descartar</button>}
              </>
            ) : (
              <>
                {l.status === "confirmada" && <Status tone="success">Confirmado</Status>}
                {l.podeDecidir && <button type="button" className="doc-link perigo" title="A ligação está errada" onClick={() => void decidir(l, "descartada")}>Desligar</button>}
              </>
            )}
            <a className="doc-link" href={`/api/documentos/${l.documento.id}/baixar`} target="_blank" rel="noopener">Baixar</a>
          </div>
        </div>
      ))}
    </section>
  );
}
