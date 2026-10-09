"use client";

import { useState } from "react";
import { Button, Modal, Segmented, Status } from "../../../packages/design-system";
import { DIVISAO, type Pedido, SITUACAO, chamar, date, qtd } from "./tipos";

/**
 * Peças da lista de pedidos de material, usadas pelo Almoxarifado (todos os
 * pedidos) e pela Fundição (só os dela): cartão, lista com filtros e cancelamento.
 */

export type FiltroPedido = "andamento" | "recebidos" | "cancelados" | "todos";
export const FILTROS: { value: FiltroPedido; label: string; status: Pedido["status"][] | null }[] = [
  { value: "andamento", label: "Em andamento", status: ["aberta", "em_cotacao", "aprovada", "rejeitada", "comprada", "parcial"] },
  { value: "recebidos", label: "Recebidos", status: ["recebida"] },
  { value: "cancelados", label: "Cancelados", status: ["cancelada"] },
  { value: "todos", label: "Todos", status: null },
];

export const PODE_CANCELAR: Pedido["status"][] = ["aberta", "em_cotacao", "aprovada", "rejeitada"];

export function CartaoPedido({ pedido: p, onCancelar }: { pedido: Pedido; onCancelar?: (p: Pedido) => void }) {
  return (
    <article className="almox-pedido">
      <header>
        <div className="almox-pedido-titulo">
          <span><b>Pedido #{p.numero}</b>{p.urgencia === "urgente" && <Status tone="danger">Urgente</Status>}</span>
          <small>{DIVISAO[p.divisao]} · {p.solicitante ?? "—"}{p.origem === "FUNDICAO" ? " (Fundição)" : ""} · {date(p.criadoEm)}</small>
        </div>
        <Status tone={SITUACAO[p.status].tone}>{SITUACAO[p.status].label}</Status>
      </header>
      <div className="almox-pedido-itens">
        {p.itens.map((item, index) => <p key={index}><b>{qtd(item.quantidade)} {item.unidade}</b> {item.produto}{item.observacao && <em> — {item.observacao}</em>}</p>)}
      </div>
      {p.observacao && <p className="almox-obs">{p.observacao}</p>}
      {p.status === "cancelada" && p.motivoCancelamento && <p className="almox-obs">Cancelado: {p.motivoCancelamento}</p>}
      {onCancelar && PODE_CANCELAR.includes(p.status) && (
        <footer><Button variant="ghost" compact className="almox-perigo" onClick={() => onCancelar(p)}>Cancelar pedido</Button></footer>
      )}
    </article>
  );
}

export function ListaPedidos({ pedidos, cartao, cabecalho, vazio = "Nenhum pedido neste filtro" }: { pedidos: Pedido[]; cartao: (p: Pedido) => React.ReactNode; cabecalho: React.ReactNode; vazio?: string }) {
  const [filtro, setFiltro] = useState<FiltroPedido>("andamento");
  const [busca, setBusca] = useState("");
  const conta = (f: FiltroPedido) => { const regra = FILTROS.find((x) => x.value === f)?.status; return pedidos.filter((p) => !regra || regra.includes(p.status)).length; };
  const visiveis = pedidos.filter((p) => {
    const regra = FILTROS.find((x) => x.value === filtro)?.status;
    const termo = busca.trim().toLowerCase();
    return (!regra || regra.includes(p.status)) && (!termo || String(p.numero).includes(termo) || p.itens.some((i) => i.produto.toLowerCase().includes(termo)));
  });
  return (
    <>
      {cabecalho}
      <div className="almox-filtros">
        <Segmented<FiltroPedido> options={FILTROS.map((f) => ({ value: f.value, label: `${f.label} · ${conta(f.value)}` }))} value={filtro} onChange={setFiltro} ariaLabel="Situação dos pedidos" />
        <input className="almox-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número ou material" aria-label="Buscar pedido" />
      </div>
      {visiveis.length ? <div className="almox-grade">{visiveis.map(cartao)}</div> : <div className="finance-empty almox-vazio"><b>{vazio}</b><small>Troque o filtro ou a busca.</small></div>}
    </>
  );
}

export function CancelarModal({ pedido, url, eyebrow = "Almoxarifado", onClose, onFeito }: { pedido: Pedido; url: string; eyebrow?: string; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (motivo.trim().length < 3) { setErro("Informe o motivo."); return; }
    setSalvando(true);
    const res = await chamar(url, { method: "POST", body: JSON.stringify({ motivo }) });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    onFeito();
  };
  return (
    <Modal eyebrow={eyebrow} title={`Cancelar o pedido #${pedido.numero}?`} subtitle={pedido.status === "aberta" ? "O Compras ainda não começou a cotar." : "O Compras já está trabalhando nele e será avisado."} onClose={onClose}>
      <form className="almox-form" onSubmit={enviar}>
        <label className="almox-largo"><span>Motivo</span><textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Ex.: achamos o material no estoque" /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer><Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Voltar</Button><Button type="submit" className="almox-perigo-cheio" disabled={salvando}>{salvando ? "Cancelando…" : "Cancelar pedido"}</Button></footer>
      </form>
    </Modal>
  );
}
