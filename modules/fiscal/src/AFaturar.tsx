"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Status } from "../../../packages/design-system";
import { lerNumeroBr } from "../../../lib/numero-br";
import { api, money } from "./comum";
import { EditorOrcamento } from "../../comercial/src/vendas/Orcamentos";

/**
 * Fiscal › A faturar — o assistente de faturamento do GRV (docs/PLANO-ORCAMENTO.md, E4): itens dos
 * orçamentos ganhos com pedido, produzido e faturado. O Jefferson escolhe quanto faturar e a nota
 * nasce preenchida; o banco nunca deixa passar do pedido nem do produzido. Por enquanto no TREINO
 * (mesmas regras, sem consumir o saldo real).
 */

type Item = {
  quote_id: string; numero: number; cliente_id: string; cliente: string; pedido_cliente: string | null; item_id: string; ordem: number; codigo: string;
  descricao: string; unidade: string; preco_unitario: number; item_pedido: string | null; pedido: number; produzido: number; faturado: number; disponivel: number; falta: number;
};
const qtd = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const lerNumero = (t: string) => lerNumeroBr(t);

export function AFaturar({ notify, onAbrirNota }: { notify: (m: string) => void; onAbrirNota: (id: string) => void }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [podeOperar, setPodeOperar] = useState(false);
  const [erro, setErro] = useState("");
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [gerando, setGerando] = useState(false);
  // Orçamento aberto para conferir antes de faturar (cliente, pedido, máscara, anexos, anotações).
  const [orcamento, setOrcamento] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await api<{ itens: Item[]; podeOperar: boolean }>("/api/fiscal/faturar?ambiente=treino");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setPodeOperar(r.data.podeOperar);
    setItens(r.data.itens.map((i) => ({ ...i, preco_unitario: Number(i.preco_unitario), pedido: Number(i.pedido), produzido: Number(i.produzido), faturado: Number(i.faturado), disponivel: Number(i.disponivel), falta: Number(i.falta) })));
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const porOrcamento = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of itens ?? []) m.set(i.quote_id, [...(m.get(i.quote_id) ?? []), i]);
    return [...m.values()];
  }, [itens]);
  const escolhidos = (itens ?? []).filter((i) => escolha[i.item_id] !== undefined);
  const clienteEscolhido = escolhidos[0]?.cliente_id ?? null;
  const totalEscolhido = escolhidos.reduce((a, i) => a + lerNumero(escolha[i.item_id] ?? "0") * i.preco_unitario, 0);
  const invalidos = escolhidos.filter((i) => { const q = lerNumero(escolha[i.item_id] ?? ""); return !(q > 0) || q > i.disponivel || q > i.falta; });

  const alternar = (i: Item) => setEscolha((e) => {
    const n = { ...e };
    if (n[i.item_id] !== undefined) delete n[i.item_id];
    else n[i.item_id] = String(Math.min(i.disponivel, i.falta)).replace(".", ",");
    return n;
  });

  const gerar = async () => {
    setGerando(true);
    const r = await api<{ id: string }>("/api/fiscal/faturar", {
      method: "POST", body: JSON.stringify({ ambiente: "treino", itens: escolhidos.map((i) => ({ item: i.item_id, quantidade: lerNumero(escolha[i.item_id] ?? "0") })) }),
    });
    setGerando(false);
    if (!r.ok) { notify(r.error); void carregar(); return; }
    notify("Rascunho da nota criado a partir do orçamento: confira e valide.");
    setEscolha({});
    onAbrirNota(r.data.id);
  };

  if (orcamento) return <EditorOrcamento id={orcamento} treinoNovo={false} notify={notify} onAbrir={setOrcamento} onFechar={() => { setOrcamento(null); void carregar(); }} voltar="Voltar ao A faturar" />;

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">FISCAL · FATURAMENTO</p><h1>A faturar</h1><p>Itens dos orçamentos ganhos com o que já foi produzido. Escolha quanto faturar: a nota nasce preenchida, e o total das notas nunca passa do pedido.</p></div>
      </div>
      <div className="nfe-faixa-treino" role="note">
        <b>TREINO — SEM VALOR FISCAL</b>
        <span>As notas daqui faturam os orçamentos de treino do Comercial (T-1, T-2…), com as mesmas regras de pedido e produção. Nada vira nota real; tudo será apagado quando a plataforma entrar em produção.</span>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!itens && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {itens && !itens.length && <div className="finance-empty almox-vazio"><b>Nada a faturar</b><small>Os itens aparecem aqui quando um orçamento é marcado como ganho no Comercial. O faturamento libera conforme a entrada de produção.</small></div>}

      {porOrcamento.map((lista) => {
        const outroCliente = clienteEscolhido !== null && lista[0].cliente_id !== clienteEscolhido;
        return (
          <section className="almox-bloco" key={lista[0].quote_id}>
            <header className="almox-bloco-topo">
              <h2><button type="button" className="vnd-abrir-orcamento" onClick={() => setOrcamento(lista[0].quote_id)} title="Abrir o orçamento inteiro: cliente, pedido, máscara, anexos e anotações">Orçamento de treino T-{lista[0].numero} · {lista[0].cliente}</button></h2>
              <span className="nfe-contagem">Pedido de compra {lista[0].pedido_cliente ?? "—"} · <button type="button" className="almox-link" onClick={() => setOrcamento(lista[0].quote_id)}>Abrir orçamento</button></span>
            </header>
            <div className="vnd-tabela vnd-faturar" role="table">
              <div className="cabeca" role="row"><span /><span>Código</span><span>Item</span><span className="r">Pedido</span><span className="r">Produzido</span><span className="r">Faturado</span><span className="r">Disponível</span><span className="r">Falta</span><span>Faturar agora</span></div>
              {lista.map((i) => {
                const marcado = escolha[i.item_id] !== undefined;
                const podeMarcar = podeOperar && i.disponivel > 0 && !outroCliente;
                const q = lerNumero(escolha[i.item_id] ?? "");
                const invalido = marcado && (!(q > 0) || q > i.disponivel || q > i.falta);
                return (
                  <div role="row" key={i.item_id} className={marcado ? "vnd-marcado" : undefined}>
                    <span><input type="checkbox" checked={marcado} disabled={!podeMarcar && !marcado} onChange={() => alternar(i)} aria-label={`Faturar ${i.descricao}`} /></span>
                    <span className="vnd-codigo">{i.codigo}</span>
                    <span className="nome">{i.descricao}<small>{money(i.preco_unitario)} / {i.unidade}{i.item_pedido ? ` · item ${i.item_pedido} do pedido` : ""}</small></span>
                    <span className="r">{qtd(i.pedido)}</span>
                    <span className="r">{qtd(i.produzido)}</span>
                    <span className="r">{qtd(i.faturado)}</span>
                    <span className="r">{i.disponivel > 0 ? <b>{qtd(i.disponivel)}</b> : <Status tone="neutral">0</Status>}</span>
                    <span className="r">{qtd(i.falta)}</span>
                    <span>{marcado
                      ? <input className={`vnd-qtd${invalido ? " vnd-invalido" : ""}`} inputMode="decimal" value={escolha[i.item_id]} onChange={(e) => setEscolha((x) => ({ ...x, [i.item_id]: e.target.value }))} aria-label="Quantidade a faturar" />
                      : i.disponivel <= 0 ? <small className="vnd-dica">sem produção</small> : outroCliente ? <small className="vnd-dica">outro cliente</small> : null}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {escolhidos.length > 0 && (
        <div className="vnd-barra-faturar">
          <span>{escolhidos.length} {escolhidos.length === 1 ? "item" : "itens"} · {money(totalEscolhido)} <small>(sem IPI)</small></span>
          {invalidos.length > 0 && <Callout variant="warning" title="Quantidade acima do disponível">{invalidos.map((i) => i.descricao).join(", ")}: até o disponível (produzido e ainda não faturado).</Callout>}
          <Button variant="secondary" onClick={() => setEscolha({})} disabled={gerando}>Limpar</Button>
          <Button onClick={() => void gerar()} disabled={gerando || invalidos.length > 0}>{gerando ? "Gerando…" : "Gerar nota (treino)"}</Button>
        </div>
      )}
    </div>
  );
}
