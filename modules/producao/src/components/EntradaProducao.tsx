"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal } from "../../../../packages/design-system";
import { api, dataHora } from "../../../fiscal/src/comum";

/**
 * Produção › Entrada de produção (Rafael; decisão O3: manual). Peças prontas dos orçamentos
 * ganhos: lançar libera o faturamento no Fiscal, e o banco nunca deixa passar do pedido.
 */

type Item = {
  quote_id: string; numero: number; cliente: string; pedido_cliente: string | null; item_id: string; codigo: string; descricao: string; unidade: string;
  pedido: number; produzido: number; faturado: number; falta: number;
};
type Entrada = { id: string; quote_item_id: string; quantidade: number; data: string; observacao: string | null; created_by_name: string | null; created_at: string };
type Dados = { itens: Item[]; entradas: Entrada[]; podeOperar: boolean };
const qtd = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function EntradaProducao({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [lancar, setLancar] = useState<Item | null>(null);
  const [historico, setHistorico] = useState<Item | null>(null);

  const carregar = useCallback(async () => {
    const r = await api<Dados>("/api/producao/entrada");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados({ ...r.data, itens: r.data.itens.map((i) => ({ ...i, pedido: Number(i.pedido), produzido: Number(i.produzido), faturado: Number(i.faturado), falta: Number(i.falta) })) });
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const porOrcamento = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of dados?.itens ?? []) m.set(i.quote_id, [...(m.get(i.quote_id) ?? []), i]);
    return [...m.values()];
  }, [dados]);

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">PRODUÇÃO · ENTRADA</p><h1>Entrada de produção</h1><p>Peças prontas dos orçamentos ganhos. O que entra aqui fica disponível para o Fiscal faturar, nunca acima do pedido.</p></div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && !porOrcamento.length && (
        <div className="finance-empty almox-vazio"><b>Nenhum pedido em produção</b><small>Quando um orçamento for marcado como ganho no Comercial, os itens dele aparecem aqui.</small></div>
      )}
      {porOrcamento.map((itens) => (
        <section className="almox-bloco" key={itens[0].quote_id}>
          <header className="almox-bloco-topo"><h2>Orçamento #{itens[0].numero} · {itens[0].cliente}</h2><span className="nfe-contagem">Pedido {itens[0].pedido_cliente ?? "—"}</span></header>
          <div className="vnd-tabela vnd-entrada" role="table">
            <div className="cabeca" role="row"><span>Código</span><span>Item</span><span className="r">Pedido</span><span className="r">Produzido</span><span className="r">Faturado</span><span className="r">Falta produzir</span><span /></div>
            {itens.map((i) => (
              <div role="row" key={i.item_id}>
                <span className="vnd-codigo">{i.codigo}</span>
                <span className="nome">{i.descricao}</span>
                <span className="r">{qtd(i.pedido)}</span>
                <span className="r">{qtd(i.produzido)}</span>
                <span className="r">{qtd(i.faturado)}</span>
                <span className="r">{qtd(Math.max(i.pedido - i.produzido, 0))}</span>
                <span className="fiscal-dfe-acoes">
                  {dados?.entradas.some((e) => e.quote_item_id === i.item_id) && <button type="button" className="almox-link" onClick={() => setHistorico(i)}>Entradas</button>}
                  {dados?.podeOperar && i.produzido < i.pedido && <button type="button" className="almox-link" onClick={() => setLancar(i)}>Lançar</button>}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {lancar && <LancarModal item={lancar} onClose={() => setLancar(null)} onFeito={(m) => { setLancar(null); notify(m); void carregar(); }} />}
      {historico && dados && (
        <HistoricoModal item={historico} entradas={dados.entradas.filter((e) => e.quote_item_id === historico.item_id)} podeOperar={dados.podeOperar}
          onClose={() => setHistorico(null)} onMudou={(m) => { notify(m); setHistorico(null); void carregar(); }} />
      )}
    </div>
  );
}

function LancarModal({ item, onClose, onFeito }: { item: Item; onClose: () => void; onFeito: (m: string) => void }) {
  const cabe = Math.max(item.pedido - item.produzido, 0);
  const [quantidade, setQuantidade] = useState(String(cabe));
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    setEnviando(true); setErro("");
    const r = await api("/api/producao/entrada", { method: "POST", body: JSON.stringify({ item: item.item_id, quantidade, observacao }) });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(`Entrada lançada: ${quantidade} × ${item.descricao}. O Fiscal foi avisado.`);
  };
  return (
    <Modal eyebrow="PRODUÇÃO · ENTRADA" title={`${item.codigo} · ${item.descricao}`} subtitle={`Orçamento #${item.numero} · pedido ${qtd(item.pedido)}, já produzido ${qtd(item.produzido)}`} onClose={onClose}>
      <form className="almox-form" onSubmit={enviar}>
        <div className="fiscal-campos nfe-campos">
          <label><span>Quantidade pronta<small> · cabem {qtd(cabe)}</small></span><input inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} autoFocus /></label>
          <label className="nfe-largo"><span>Observação</span><input value={observacao} maxLength={500} onChange={(e) => setObservacao(e.target.value)} placeholder="Lote, OS da Forja…" /></label>
        </div>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={enviando}>Voltar</Button>
          <Button type="submit" disabled={enviando || !(Number(quantidade.replace(",", ".")) > 0)}>{enviando ? "Lançando…" : "Lançar entrada"}</Button>
        </footer>
      </form>
    </Modal>
  );
}

function HistoricoModal({ item, entradas, podeOperar, onClose, onMudou }: { item: Item; entradas: Entrada[]; podeOperar: boolean; onClose: () => void; onMudou: (m: string) => void }) {
  const [erro, setErro] = useState("");
  const estornar = async (e: Entrada) => {
    const r = await api(`/api/producao/entrada?id=${e.id}`, { method: "DELETE" });
    if (!r.ok) { setErro(r.error); return; }
    onMudou(`Entrada de ${qtd(e.quantidade)} estornada.`);
  };
  return (
    <Modal eyebrow="PRODUÇÃO · ENTRADA" title={`Entradas · ${item.codigo}`} subtitle={item.descricao} onClose={onClose}>
      <div className="almox-form">
        <ul className="nfe-eventos">
          {entradas.map((e) => (
            <li key={e.id}>
              <b>{qtd(e.quantidade)} {item.unidade}</b>
              {e.observacao && <span>{e.observacao}</span>}
              <small>{e.created_by_name ?? "—"} · {dataHora(e.created_at)}{podeOperar && <> · <button type="button" className="almox-link almox-perigo" onClick={() => void estornar(e)}>Estornar</button></>}</small>
            </li>
          ))}
        </ul>
        <p className="fiscal-nota-ajuda">Estorno só para lançamento errado, e só do que ainda não foi faturado.</p>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
}
