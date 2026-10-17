"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Status } from "../../packages/design-system";

/**
 * Fundação › Parados (A-11): o que está esperando alguém, por área, do mais antigo para o mais novo.
 * Cada um vê só o que a sua área resolve. É só a lista: ninguém é cobrado por mensagem.
 */
type Item = { tipo: string; area: string; titulo: string; detalhe: string | null; desde: string; dias: number; link: string; ref: string };

const PRAZO: Record<string, string> = {
  pedido_material: "pedido sem cotação há mais de 2 dias",
  cotacao_aprovacao: "esperando aprovação há mais de 2 dias",
  cotacao_sem_compra: "aprovada e não comprada há mais de 2 dias",
  compra_atrasada: "entrega vencida",
  os_rascunho: "rascunho não liberado há mais de 3 dias",
  orcamento_sem_resposta: "sem resposta do cliente há mais de 7 dias",
  a_faturar: "saldo a faturar há mais de 3 dias",
  conta_aprovacao: "esperando aprovação há mais de 2 dias",
  nota_sem_lancamento: "nota sem lançamento há mais de 5 dias",
};

export function Parados({ abrir }: { abrir: (link: string) => void }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    const r = await fetch("/api/foundation/parados", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(d.error || "Não foi possível carregar a lista."); return; }
    setErro("");
    setItens(d.itens as Item[]);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const porArea = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of itens ?? []) m.set(i.area, [...(m.get(i.area) ?? []), i]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [itens]);

  if (erro) return <Callout variant="warning" title="Parados">{erro}</Callout>;
  if (!itens) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">O QUE ESTÁ ESPERANDO</p>
          <h1>Parados</h1>
          <p>Pedidos, cotações, compras, OS, orçamentos, faturamento e contas que estão esperando alguém da sua área há mais dias que o normal, do mais antigo para o mais novo.</p>
        </div>
        <div className="icms-acoes"><Button type="button" variant="secondary" onClick={() => void carregar()}>Atualizar</Button></div>
      </div>
      {!itens.length
        ? <div className="finance-empty almox-vazio"><b>Nada parado na sua área</b><small>Tudo andando dentro do prazo.</small></div>
        : porArea.map(([area, lista]) => (
          <section key={area} className="parados-area" aria-label={area}>
            <header><h2>{area}</h2><Status tone="attention">{lista.length}</Status></header>
            <ul>
              {lista.map((i) => (
                <li key={`${i.tipo}-${i.ref}`}>
                  <span className={`parados-dias${i.dias >= 30 ? " muito" : i.dias >= 7 ? " bastante" : ""}`}><b>{i.dias}</b><small>{i.dias === 1 ? "dia" : "dias"}</small></span>
                  <span className="parados-texto"><b>{i.titulo}</b>{i.detalhe && <small>{i.detalhe}</small>}<em>{PRAZO[i.tipo] ?? ""}</em></span>
                  <Button type="button" variant="secondary" compact onClick={() => abrir(i.link)}>Abrir</Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
