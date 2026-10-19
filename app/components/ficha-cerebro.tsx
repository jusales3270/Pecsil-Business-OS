"use client";

import { useEffect, useMemo, useState } from "react";
import { type LigacaoGrafo, linhasDaFicha, resumoDaLigacao, rotuloLigacao, tipoDe } from "../../lib/cerebro/visual";

/**
 * "No Segundo Cérebro" (etapa G3): a ficha do fornecedor, do cliente ou do material nas telas dos
 * módulos, com o que já foi comprado, pago, encomendado, a que preço e desde quando, e as ligações.
 * Só aparece o que a permissão da pessoa deixa (o banco decide); sem ficha, não aparece nada.
 */
type Ficha = {
  no: { tipo: string; chave: string; nome: string; termos: string[]; resumo: Record<string, unknown> };
  ligacoes: { tipo: string; familia: string; de_origem: boolean; outro: { tipo: string; chave: string; nome: string; link: string | null };
    quantidade: number | null; total: number | null; primeira: string | null; ultima: string | null; resumo: Record<string, unknown> }[];
};

const ESCONDER = new Set(["tem_peca"]);

export function FichaDoCerebro({ tipo, chave, titulo = "No Segundo Cérebro" }: { tipo: "fornecedor" | "cliente" | "material"; chave: string | number; titulo?: string }) {
  const [ficha, setFicha] = useState<Ficha | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    void fetch(`/api/cerebro/ficha?tipo=${tipo}&chave=${encodeURIComponent(String(chave))}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as Ficha) : null)).catch(() => null)
      .then((f) => { if (vivo) setFicha(f); });
    return () => { vivo = false; };
  }, [tipo, chave]);

  const grupos = useMemo(() => {
    const m = new Map<string, { rotulo: string; itens: Ficha["ligacoes"] }>();
    for (const l of ficha?.ligacoes ?? []) {
      if (ESCONDER.has(l.tipo)) continue;
      const k = `${l.tipo}:${l.de_origem}`;
      const g = m.get(k) ?? { rotulo: rotuloLigacao(l.tipo, l.de_origem), itens: [] };
      g.itens.push(l);
      m.set(k, g);
    }
    return [...m.values()];
  }, [ficha]);

  if (!ficha) return null;
  const linhas = linhasDaFicha(ficha.no.tipo, ficha.no.resumo);
  const pecas = (ficha.ligacoes ?? []).filter((l) => l.tipo === "tem_peca").length;
  if (!linhas.length && !grupos.length && !pecas) return null;
  return (
    <section className="ficha-cerebro" aria-label={titulo}>
      <header><p className="eyebrow">{titulo}</p><small>Somado a partir dos módulos (compras, cotações, títulos, OS)</small></header>
      {linhas.length > 0 && <dl className="cerebro-numeros">{linhas.map((x) => <div key={x.rotulo}><dt>{x.rotulo}</dt><dd>{x.valor}</dd></div>)}</dl>}
      {pecas > 0 && <p className="ti-nota">{pecas.toLocaleString("pt-BR")} peças cadastradas para este cliente.</p>}
      {grupos.map((g) => (
        <div key={g.rotulo} className="cerebro-lig-grupo">
          <h4>{g.rotulo} <small>{g.itens.length}</small></h4>
          <ul>
            {g.itens.slice(0, 8).map((l, i) => {
              const linha = resumoDaLigacao({ ...l, id: String(i), origem: "", destino: "", procedencia: "regra", situacao: "valendo" } as LigacaoGrafo);
              return (
                <li key={`${l.outro.chave}-${i}`}>
                  <span className="cerebro-lig-no"><i style={{ background: `var(${tipoDe(l.outro.tipo).cor})` }} aria-hidden />{l.outro.nome}</span>
                  {linha && <span className="cerebro-lig-resumo">{linha}</span>}
                </li>
              );
            })}
          </ul>
          {g.itens.length > 8 && <p className="ti-nota">e mais {g.itens.length - 8}.</p>}
        </div>
      ))}
    </section>
  );
}
