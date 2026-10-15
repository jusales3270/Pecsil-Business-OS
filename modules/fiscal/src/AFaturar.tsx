"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout } from "../../../packages/design-system";
import { lerNumeroBr } from "../../../lib/numero-br";
import { api, money } from "./comum";
import { EditorOrcamento } from "../../comercial/src/vendas/Orcamentos";

/**
 * Fiscal › A faturar — o assistente de faturamento do GRV (docs/PLANO-ORCAMENTO.md, E4): itens dos
 * orçamentos ganhos com pedido, faturado e saldo. Quem fatura escolhe quantas peças vão nesta nota e
 * ela nasce preenchida; o banco nunca deixa a soma das notas passar do pedido (decisão de 16/10: o
 * teto é só o pedido; o produzido é informação). Por enquanto no TREINO (mesmas regras, sem consumir
 * o saldo real).
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
  // Sem quantidade ainda (campo vazio) só segura o botão; passar do saldo também avisa.
  const invalidos = escolhidos.filter((i) => { const q = lerNumero(escolha[i.item_id] ?? ""); return !(q > 0) || q > i.falta; });
  const passaram = escolhidos.filter((i) => lerNumero(escolha[i.item_id] ?? "") > i.falta);

  // Abre o campo da quantidade (vazio, com o saldo à vista) e põe o cursor nele.
  const abrir = (i: Item) => {
    setEscolha((e) => ({ ...e, [i.item_id]: e[i.item_id] ?? "" }));
    setTimeout(() => document.getElementById(`faturar-${i.item_id}`)?.focus(), 0);
  };
  const alternar = (i: Item) => {
    if (escolha[i.item_id] !== undefined) setEscolha((e) => { const n = { ...e }; delete n[i.item_id]; return n; });
    else abrir(i);
  };

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
        <div><p className="eyebrow">FISCAL · FATURAMENTO</p><h1>A faturar</h1><p>Itens dos orçamentos ganhos e o saldo de cada um. Escolha quantas peças vão nesta nota: ela nasce preenchida, e a soma das notas nunca passa do pedido.</p></div>
      </div>
      <div className="nfe-faixa-treino" role="note">
        <b>TREINO — SEM VALOR FISCAL</b>
        <span>As notas daqui faturam os orçamentos de treino do Comercial (T-1, T-2…), com a mesma regra do pedido (a soma das notas nunca passa do orçado). Nada vira nota real; tudo será apagado quando a plataforma entrar em produção.</span>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!itens && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {itens && !itens.length && <div className="finance-empty almox-vazio"><b>Nada a faturar</b><small>Os itens aparecem aqui quando um orçamento é marcado como ganho no Comercial, e saem quando o pedido inteiro estiver faturado.</small></div>}

      {porOrcamento.map((lista) => {
        const outroCliente = clienteEscolhido !== null && lista[0].cliente_id !== clienteEscolhido;
        return (
          <section className="almox-bloco" key={lista[0].quote_id}>
            <header className="almox-bloco-topo">
              <h2><button type="button" className="vnd-abrir-orcamento" onClick={() => setOrcamento(lista[0].quote_id)} title="Abrir o orçamento inteiro: cliente, pedido, máscara, anexos e anotações">Orçamento de treino T-{lista[0].numero} · {lista[0].cliente}</button></h2>
              <span className="nfe-contagem">Pedido de compra {lista[0].pedido_cliente ?? "—"} · <button type="button" className="almox-link" onClick={() => setOrcamento(lista[0].quote_id)}>Abrir orçamento</button></span>
            </header>
            <div className="vnd-tabela vnd-faturar" role="table">
              <div className="cabeca" role="row"><span /><span>Código</span><span>Item</span><span className="r">Pedido</span><span className="r">Produzido</span><span className="r">Faturado</span><span className="r">Saldo</span><span>Faturar agora</span></div>
              {lista.map((i) => {
                const marcado = escolha[i.item_id] !== undefined;
                const podeMarcar = podeOperar && i.falta > 0 && !outroCliente;
                const texto = escolha[i.item_id] ?? "";
                const q = lerNumero(texto);
                const passou = marcado && q > i.falta;
                const invalido = marcado && texto.trim() !== "" && (!(q > 0) || passou);
                return (
                  <div role="row" key={i.item_id} className={marcado ? "vnd-marcado" : undefined}>
                    <span><input type="checkbox" checked={marcado} disabled={!podeMarcar && !marcado} onChange={() => alternar(i)} aria-label={`Faturar ${i.descricao}`} /></span>
                    <span className="vnd-codigo">{i.codigo}</span>
                    <span className="nome">{i.descricao}<small>{money(i.preco_unitario)} / {i.unidade}{i.item_pedido ? ` · item ${i.item_pedido} do pedido` : ""}</small></span>
                    <span className="r">{qtd(i.pedido)}</span>
                    <span className="r">{qtd(i.produzido)}</span>
                    <span className="r">{qtd(i.faturado)}</span>
                    <span className="r"><b>{qtd(i.falta)}</b></span>
                    <span className="vnd-faturar-agora">{marcado ? (
                      <>
                        <input id={`faturar-${i.item_id}`} className={`vnd-qtd${invalido ? " vnd-invalido" : ""}`} inputMode="decimal" value={texto} placeholder={`até ${qtd(i.falta)}`}
                          onChange={(e) => setEscolha((x) => ({ ...x, [i.item_id]: e.target.value }))} aria-label={`Quantidade a faturar de ${i.descricao}`} aria-invalid={invalido} />
                        <small className={`vnd-dica${invalido ? " vnd-dica-erro" : ""}`}>
                          {passou ? `Passa do pedido: cabem ${qtd(i.falta)}` : q > 0 ? `Saldo depois: ${qtd(i.falta - q)}` : <button type="button" className="almox-link" onClick={() => setEscolha((x) => ({ ...x, [i.item_id]: String(i.falta).replace(".", ",") }))}>Tudo ({qtd(i.falta)})</button>}
                        </small>
                      </>
                    ) : podeMarcar ? (
                      <button type="button" className="almox-link" onClick={() => abrir(i)}>Escolher quantidade</button>
                    ) : outroCliente ? <small className="vnd-dica">outro cliente</small> : null}</span>
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
          {passaram.length > 0 && <Callout variant="warning" title="Passa do pedido">{passaram.map((i) => `${i.descricao} (cabem ${qtd(i.falta)})`).join(", ")}: a soma das notas nunca passa do que foi orçado e ganho.</Callout>}
          <Button variant="secondary" onClick={() => setEscolha({})} disabled={gerando}>Limpar</Button>
          <Button onClick={() => void gerar()} disabled={gerando || invalidos.length > 0}>{gerando ? "Gerando…" : "Gerar nota (treino)"}</Button>
        </div>
      )}
    </div>
  );
}
