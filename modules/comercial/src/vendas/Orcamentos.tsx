"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, EscolherArquivo, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../../packages/design-system";
import { MODALIDADES_FRETE, SITUACOES_ORCAMENTO } from "../../../../lib/comercial/vendas";
import { api, curto, date, dataHora, hoje, money } from "../../../fiscal/src/comum";
import { lerNumeroBr } from "../../../../lib/numero-br";
import type { Produto } from "./Produtos";

/**
 * Comercial › Vendas › Orçamentos — o orçamento do GRV (P88) na plataforma (docs/PLANO-ORCAMENTO.md,
 * E2): itens pelo código interno, o pedido de compra do cliente e a cotação anexados (exigidos
 * para marcar como ganho — regra do Jefferson), anotações das mudanças e, depois de ganho, o que
 * já foi produzido e as notas que entregaram cada item.
 */

type Situacao = "rascunho" | "enviado" | "ganho" | "perdido" | "cancelado";
type Resumo = {
  id: string; numero: number; customer_id: string; contato: string | null; data_orcamento: string; validade: string | null; situacao: Situacao;
  pedido_cliente: string | null; prazo_entrega: string | null; ganho_em: string | null; motivo_perda: string | null; created_by_name: string | null;
  updated_at: string; cliente: { name: string } | null; total: number; itens: number;
};
type Lista = { orcamentos: Resumo[]; clientes: { id: string; name: string }[]; proximoNumero: number; podeOperar: boolean; podeNumeracao: boolean };
type ItemBanco = {
  id: string; ordem: number; product_id: string; descricao: string; desenho: string | null; unidade: string; quantidade: number; preco_unitario: number;
  prazo_entrega: string | null; item_pedido: string | null; observacao: string | null; produto: { codigo: string; ncm: string | null } | null;
};
type Detalhe = {
  orcamento: Resumo & { condicao_pagamento: string | null; frete_modalidade: number; observacoes: string | null; ganho_por_nome: string | null; cliente: { name: string; tax_id: string | null; uf: string | null } | null };
  itens: ItemBanco[];
  anotacoes: { id: string; texto: string; autor_nome: string | null; created_at: string }[];
  anexos: { id: string; tipo: "pedido" | "cotacao" | "outro"; created_by_name: string | null; created_at: string; documento: { id: string; title: string; original_name: string } | null }[];
  notasFiscais: { item_id: string; nfe_id: string; ambiente: string; situacao: string; serie: number | null; numero: number | null; emissao: string | null; quantidade: number }[];
  entradas: { id: string; quote_item_id: string; quantidade: number; data: string; created_by_name: string | null }[];
  historico: { product_id: string; preco_unitario: number; quantidade: number; orcamento: { id: string; numero: number; data_orcamento: string; situacao: string; cliente: { name: string } | null } }[];
  podeOperar: boolean;
};

const TOM: Record<Situacao, "neutral" | "info" | "success" | "danger" | "attention"> = { rascunho: "neutral", enviado: "info", ganho: "success", perdido: "danger", cancelado: "neutral" };
type Filtro = "abertos" | "ganho" | "perdido" | "todos";
const NO_FILTRO: Record<Filtro, (s: Situacao) => boolean> = {
  abertos: (s) => s === "rascunho" || s === "enviado", ganho: (s) => s === "ganho", perdido: (s) => s === "perdido" || s === "cancelado", todos: () => true,
};
const lerNumero = (t: string) => lerNumeroBr(t);
const br = (v: number, casas = 2) => (v ? v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: 4 }) : "");
const qtd = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function Orcamentos({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("abertos");
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  const [numeracao, setNumeracao] = useState(false);

  const carregar = useCallback(async () => {
    const r = await api<Lista>("/api/comercial/orcamentos");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  if (aberto) return <EditorOrcamento id={aberto === "novo" ? null : aberto} notify={notify} onAbrir={setAberto} onFechar={() => { setAberto(null); void carregar(); }} />;

  const todos = dados?.orcamentos ?? [];
  const lista = todos.filter((o) => NO_FILTRO[filtro](o.situacao));
  const abertos = todos.filter((o) => NO_FILTRO.abertos(o.situacao));
  const ganhos = todos.filter((o) => o.situacao === "ganho");

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">COMERCIAL · VENDAS</p><h1>Orçamentos</h1><p>Do pedido do cliente à aprovação: itens, cotação e pedido de compra anexados. O orçamento ganho é o que a produção faz e o Fiscal fatura.</p></div>
        <div className="icms-acoes">
          {dados?.podeNumeracao && <Button variant="secondary" onClick={() => setNumeracao(true)}>Numeração</Button>}
          {dados?.podeOperar && <Button onClick={() => setAberto("novo")}>Novo orçamento</Button>}
        </div>
      </div>
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <KpiGrid>
            <Kpi label="Em aberto" value={String(abertos.length)} caption={curto(abertos.reduce((a, o) => a + o.total, 0))} tone="blue" onOpen={() => setFiltro("abertos")} />
            <Kpi label="Ganhos" value={String(ganhos.length)} caption={curto(ganhos.reduce((a, o) => a + o.total, 0))} tone="green" onOpen={() => setFiltro("ganho")} />
            <Kpi label="Perdidos ou cancelados" value={String(todos.length - abertos.length - ganhos.length)} caption="Com o motivo registrado" tone="neutral" onOpen={() => setFiltro("perdido")} />
            <Kpi label="Próximo número" value={`#${dados.proximoNumero}`} caption="Continua a numeração do GRV" tone="neutral" />
          </KpiGrid>
          <div className="almox-filtros">
            <Segmented<Filtro> options={[{ value: "abertos", label: "Em aberto" }, { value: "ganho", label: "Ganhos" }, { value: "perdido", label: "Perdidos" }, { value: "todos", label: "Todos" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro" compact />
          </div>
          <section className="almox-bloco">
            {lista.length ? (
              <div className="vnd-tabela vnd-orcamentos" role="table">
                <div className="cabeca" role="row"><span>Nº</span><span>Cliente</span><span>Data</span><span>Pedido do cliente</span><span className="r">Total</span><span>Situação</span><span /></div>
                {lista.map((o) => (
                  <div role="row" key={o.id}>
                    <span className="vnd-codigo">#{o.numero}</span>
                    <span className="nome">{o.cliente?.name ?? "—"}<small>{o.itens} {o.itens === 1 ? "item" : "itens"}{o.contato ? ` · ${o.contato}` : ""}{o.motivo_perda ? ` · ${o.motivo_perda}` : ""}</small></span>
                    <span>{date(o.data_orcamento)}</span>
                    <span>{o.pedido_cliente ?? "—"}</span>
                    <span className="r">{money(o.total)}</span>
                    <span><Status tone={TOM[o.situacao]}>{SITUACOES_ORCAMENTO[o.situacao]}</Status></span>
                    <span className="fiscal-dfe-acoes"><button type="button" className="almox-link" onClick={() => setAberto(o.id)}>Abrir</button></span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="finance-empty">
                <b>{todos.length ? "Nenhum orçamento neste filtro" : "Nenhum orçamento ainda"}</b>
                <small>{todos.length ? "Troque o filtro." : dados.podeOperar ? "Clique em Novo orçamento para montar o primeiro." : "Quem cuida dos orçamentos monta aqui."}</small>
              </div>
            )}
          </section>
        </>
      )}
      {numeracao && dados && <NumeracaoModal atual={dados.proximoNumero} onClose={() => setNumeracao(false)} onFeito={(m) => { setNumeracao(false); notify(m); void carregar(); }} />}
    </div>
  );
}

/* --- Editor ------------------------------------------------------------------------------- */

type ItemForm = { chave: string; product_id: string; busca: string; descricao: string; desenho: string; unidade: string; quantidade: string; preco_unitario: string; prazo_entrega: string; item_pedido: string; observacao: string };
type Cab = { customer_id: string; contato: string; data_orcamento: string; validade: string; pedido_cliente: string; condicao_pagamento: string; frete_modalidade: string; prazo_entrega: string; observacoes: string };
let seq = 0;
const novaChave = () => `i${++seq}`;
const rotuloProduto = (p: Pick<Produto, "codigo" | "descricao">) => `${p.codigo} — ${p.descricao}`;

function EditorOrcamento({ id, notify, onAbrir, onFechar }: { id: string | null; notify: (m: string) => void; onAbrir: (id: string) => void; onFechar: () => void }) {
  const [det, setDet] = useState<Detalhe | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [clientes, setClientes] = useState<{ id: string; name: string }[]>([]);
  const [podeOperar, setPodeOperar] = useState(false);
  const [cab, setCab] = useState<Cab>(() => ({ customer_id: "", contato: "", data_orcamento: hoje(), validade: "", pedido_cliente: "", condicao_pagamento: "", frete_modalidade: "9", prazo_entrega: "", observacoes: "" }));
  const [itens, setItens] = useState<ItemForm[]>([]);
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [perder, setPerder] = useState(false);
  const [nota, setNota] = useState("");

  const carregarProdutos = useCallback(async () => {
    const r = await api<{ produtos: Produto[]; clientes: { id: string; name: string }[] }>("/api/comercial/produtos?ativos=1");
    if (r.ok) { setProdutos(r.data.produtos); setClientes(r.data.clientes); }
  }, []);
  const carregar = useCallback(async (qid: string) => {
    const r = await api<Detalhe>(`/api/comercial/orcamentos/${qid}`);
    if (!r.ok) { setErro(r.error); return; }
    const d = r.data;
    setDet(d);
    setPodeOperar(d.podeOperar);
    const o = d.orcamento;
    setCab({
      customer_id: o.customer_id, contato: o.contato ?? "", data_orcamento: o.data_orcamento, validade: o.validade ?? "", pedido_cliente: o.pedido_cliente ?? "",
      condicao_pagamento: o.condicao_pagamento ?? "", frete_modalidade: String(o.frete_modalidade ?? 9), prazo_entrega: o.prazo_entrega ?? "", observacoes: o.observacoes ?? "",
    });
    setItens(d.itens.map((i) => ({
      chave: novaChave(), product_id: i.product_id, busca: i.produto ? rotuloProduto({ codigo: i.produto.codigo, descricao: i.descricao }) : i.descricao,
      descricao: i.descricao, desenho: i.desenho ?? "", unidade: i.unidade, quantidade: br(Number(i.quantidade), 0), preco_unitario: br(Number(i.preco_unitario)),
      prazo_entrega: i.prazo_entrega ?? "", item_pedido: i.item_pedido ?? "", observacao: i.observacao ?? "",
    })));
    setSujo(false);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      void carregarProdutos();
      if (id) void carregar(id);
      else void api<Lista>("/api/comercial/orcamentos?situacao=rascunho").then((r) => { if (r.ok) setPodeOperar(r.data.podeOperar); });
    }, 0);
    return () => clearTimeout(t);
  }, [id, carregar, carregarProdutos]);

  const situacao: Situacao = det?.orcamento.situacao ?? "rascunho";
  const aberto = situacao === "rascunho" || situacao === "enviado";
  const editavel = podeOperar && aberto;
  const total = useMemo(() => itens.reduce((a, i) => a + lerNumero(i.quantidade) * lerNumero(i.preco_unitario), 0), [itens]);
  const porRotulo = useMemo(() => new Map(produtos.map((p) => [rotuloProduto(p), p])), [produtos]);
  const anexoPedido = det?.anexos.some((a) => a.tipo === "pedido") ?? false;
  const anexoCotacao = det?.anexos.some((a) => a.tipo === "cotacao") ?? false;
  const faltamParaGanhar = [
    !itens.length && "itens",
    !cab.pedido_cliente.trim() && "o nº do pedido de compra do cliente",
    !anexoPedido && "o anexo do pedido do cliente",
    !anexoCotacao && "o anexo da cotação enviada",
  ].filter(Boolean) as string[];

  const mudarCab = (k: keyof Cab, v: string) => { setCab((c) => ({ ...c, [k]: v })); setSujo(true); };
  const mudarItem = (chave: string, parcial: Partial<ItemForm>) => { setItens((l) => l.map((i) => (i.chave === chave ? { ...i, ...parcial } : i))); setSujo(true); };
  const escolherProduto = (chave: string, texto: string) => {
    const p = porRotulo.get(texto);
    mudarItem(chave, p
      ? { busca: texto, product_id: p.id, descricao: p.descricao, unidade: p.unidade, desenho: p.desenho_codigo ? `${p.desenho_codigo}${p.desenho_revisao ? ` rev. ${p.desenho_revisao}` : ""}` : "" }
      : { busca: texto, product_id: "" });
  };

  const corpo = () => JSON.stringify({
    ...cab, frete_modalidade: Number(cab.frete_modalidade),
    itens: itens.map((i) => ({ product_id: i.product_id, descricao: i.descricao, desenho: i.desenho, unidade: i.unidade, quantidade: lerNumero(i.quantidade), preco_unitario: lerNumero(i.preco_unitario), prazo_entrega: i.prazo_entrega, item_pedido: i.item_pedido, observacao: i.observacao })),
  });
  const rodar = async (rotulo: string, fn: () => Promise<void>) => { setOcupado(rotulo); try { await fn(); } finally { setOcupado(null); } };

  const salvar = () => rodar("salvar", async () => {
    const r = id ? await api(`/api/comercial/orcamentos/${id}`, { method: "PUT", body: corpo() }) : await api<{ id: string; numero: number }>("/api/comercial/orcamentos", { method: "POST", body: corpo() });
    if (!r.ok) { notify(r.error); return; }
    if (!id) { notify(`Orçamento #${(r.data as { numero: number }).numero} criado.`); onAbrir((r.data as { id: string }).id); return; }
    notify("Orçamento salvo.");
    void carregar(id);
  });
  const mudarSituacao = (situ: string, ok: string, motivo?: string) => rodar(situ, async () => {
    if (!id) return;
    if (sujo) { const s = await api(`/api/comercial/orcamentos/${id}`, { method: "PUT", body: corpo() }); if (!s.ok) { notify(s.error); return; } }
    const r = await api(`/api/comercial/orcamentos/${id}/situacao`, { method: "POST", body: JSON.stringify({ situacao: situ, motivo }) });
    notify(r.ok ? ok : r.error);
    void carregar(id);
  });
  const clonar = () => rodar("clonar", async () => {
    const r = await api<{ id: string; numero: number }>("/api/comercial/orcamentos", { method: "POST", body: JSON.stringify({ clonarDe: id }) });
    if (!r.ok) { notify(r.error); return; }
    notify(`Clonado como orçamento #${r.data.numero}: ajuste as quantidades, o pedido e os anexos.`);
    onAbrir(r.data.id);
  });
  const excluir = () => rodar("excluir", async () => {
    if (!id) { onFechar(); return; }
    const r = await api(`/api/comercial/orcamentos/${id}`, { method: "DELETE" });
    notify(r.ok ? "Rascunho excluído." : r.error);
    if (r.ok) onFechar();
  });
  const anexar = (tipo: string, arquivos: File[]) => rodar(`anexo-${tipo}`, async () => {
    if (!id || !arquivos[0]) return;
    const f = new FormData();
    f.append("arquivo", arquivos[0]);
    f.append("tipo", tipo);
    const r = await api(`/api/comercial/orcamentos/${id}/anexos`, { method: "POST", body: f });
    notify(r.ok ? "Anexo guardado." : r.error);
    void carregar(id);
  });
  const tirarAnexo = (anexo: string) => rodar(`tirar-${anexo}`, async () => {
    if (!id) return;
    const r = await api(`/api/comercial/orcamentos/${id}/anexos?anexo=${anexo}`, { method: "DELETE" });
    notify(r.ok ? "Anexo retirado do orçamento (o arquivo continua em Documentos)." : r.error);
    void carregar(id);
  });
  const anotar = () => rodar("nota", async () => {
    if (!id || !nota.trim()) return;
    const r = await api(`/api/comercial/orcamentos/${id}/notas`, { method: "POST", body: JSON.stringify({ texto: nota }) });
    if (!r.ok) { notify(r.error); return; }
    setNota("");
    void carregar(id);
  });

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b><Button variant="secondary" onClick={onFechar}>Voltar</Button></div>;
  if (id && !det) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  const o = det?.orcamento;
  const notasDoItem = (itemId: string) => (det?.notasFiscais ?? []).filter((n) => n.item_id === itemId);
  const produzidoDoItem = (itemId: string) => (det?.entradas ?? []).filter((e) => e.quote_item_id === itemId).reduce((a, e) => a + Number(e.quantidade), 0);
  const historicoDe = (productId: string) => (det?.historico ?? []).filter((h) => h.product_id === productId).slice(0, 3);

  return (
    <div className="icms-modulo nfe-editor-pagina">
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">COMERCIAL · ORÇAMENTO</p>
          <h1>{o ? `Orçamento #${o.numero}` : "Novo orçamento"}</h1>
          <p>{o ? <>Montado por {o.created_by_name ?? "—"}{o.ganho_por_nome ? ` · ganho por ${o.ganho_por_nome} em ${dataHora(o.ganho_em)}` : ""}</> : "Escolha o cliente, inclua os itens e salve. Depois anexe o pedido do cliente e a cotação."}</p>
        </div>
        <div className="icms-acoes">
          <Status tone={TOM[situacao]}>{SITUACOES_ORCAMENTO[situacao]}</Status>
          {o && podeOperar && <Button variant="secondary" onClick={() => void clonar()} disabled={ocupado !== null}>Clonar</Button>}
          <Button variant="secondary" onClick={onFechar}>Voltar à lista</Button>
        </div>
      </div>

      {situacao === "perdido" && o?.motivo_perda && <Callout variant="danger" title="Perdido">{o.motivo_perda}</Callout>}
      {situacao === "ganho" && <Callout variant="success" title="Ganho: pedido aprovado">Itens travados. A produção lança o que ficar pronto e o Fiscal fatura, em uma ou mais notas, nunca acima do pedido.</Callout>}

      <div className="nfe-editor">
        <div className="nfe-form">
          <fieldset className="nfe-form" disabled={!podeOperar || ocupado !== null}>
            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Cliente e pedido</h2></header>
              <div className="fiscal-campos nfe-campos">
                <label className="nfe-largo"><span>Cliente</span>
                  <select value={cab.customer_id} onChange={(e) => mudarCab("customer_id", e.target.value)} disabled={!aberto}>
                    <option value="">Escolha…</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label><span>Contato</span><input value={cab.contato} maxLength={120} onChange={(e) => mudarCab("contato", e.target.value)} /></label>
                <label><span>Data</span><input type="date" value={cab.data_orcamento} onChange={(e) => mudarCab("data_orcamento", e.target.value)} disabled={!aberto} /></label>
                <label><span>Validade</span><input type="date" value={cab.validade} onChange={(e) => mudarCab("validade", e.target.value)} /></label>
                <label><span>Pedido de compra do cliente<small> · a nota segue ele</small></span><input value={cab.pedido_cliente} maxLength={60} onChange={(e) => mudarCab("pedido_cliente", e.target.value)} disabled={!aberto} placeholder="Ex.: 4502385803" /></label>
                <label><span>Condição de pagamento</span><input value={cab.condicao_pagamento} maxLength={120} onChange={(e) => mudarCab("condicao_pagamento", e.target.value)} placeholder="28 dias" /></label>
                <label className="nfe-largo"><span>Frete</span>
                  <select value={cab.frete_modalidade} onChange={(e) => mudarCab("frete_modalidade", e.target.value)} disabled={!aberto}>{Object.entries(MODALIDADES_FRETE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
                <label><span>Prazo de entrega</span><input type="date" value={cab.prazo_entrega} onChange={(e) => mudarCab("prazo_entrega", e.target.value)} /></label>
                <label className="nfe-cheio nfe-texto"><span>Observações</span><textarea rows={2} maxLength={2000} value={cab.observacoes} onChange={(e) => mudarCab("observacoes", e.target.value)} /></label>
              </div>
            </section>

            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Itens</h2><span className="nfe-contagem">{itens.length} {itens.length === 1 ? "item" : "itens"} · {money(total)}</span></header>
              {!produtos.length && editavel && <p className="fiscal-nota-ajuda">Nenhum produto cadastrado ainda: cadastre em Comercial › Vendas › Produtos (ou aguarde a importação do GRV).</p>}
              <datalist id="vnd-lista-produtos">{produtos.map((p) => <option key={p.id} value={rotuloProduto(p)} />)}</datalist>
              {itens.map((i, k) => {
                const banco = det?.itens[k] && det.itens[k].product_id === i.product_id ? det.itens[k] : null;
                const produzido = banco ? produzidoDoItem(banco.id) : 0;
                const notas = banco ? notasDoItem(banco.id) : [];
                const faturadoReal = notas.filter((n) => n.ambiente === "producao" && n.situacao !== "cancelada").reduce((a, n) => a + Number(n.quantidade), 0);
                const hist = i.product_id ? historicoDe(i.product_id) : [];
                return (
                  <div className="nfe-item" key={i.chave}>
                    <header>
                      <b>Item {k + 1}</b>
                      <span>{money(lerNumero(i.quantidade) * lerNumero(i.preco_unitario))}</span>
                      {editavel && (
                        <span className="nfe-item-acoes">
                          <button type="button" className="almox-link" onClick={() => { setItens((l) => [...l.slice(0, k + 1), { ...i, chave: novaChave() }, ...l.slice(k + 1)]); setSujo(true); }}>Duplicar</button>
                          <button type="button" className="almox-link almox-perigo" onClick={() => { setItens((l) => l.filter((x) => x.chave !== i.chave)); setSujo(true); }}>Remover</button>
                        </span>
                      )}
                    </header>
                    <div className="fiscal-campos nfe-campos">
                      <label className="nfe-cheio"><span>Produto<small> · digite o código ou a descrição</small></span>
                        <input list="vnd-lista-produtos" value={i.busca} disabled={!aberto} onChange={(e) => escolherProduto(i.chave, e.target.value)} placeholder="5-24-00040 — ANEL…" />
                      </label>
                      <label className="nfe-cheio"><span>Descrição no orçamento</span><input value={i.descricao} maxLength={120} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { descricao: e.target.value.toUpperCase() })} /></label>
                      <label><span>Desenho</span><input value={i.desenho} maxLength={80} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { desenho: e.target.value })} /></label>
                      <label><span>Unidade</span><input value={i.unidade} maxLength={6} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { unidade: e.target.value.toUpperCase() })} /></label>
                      <label><span>Quantidade</span><input inputMode="decimal" value={i.quantidade} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { quantidade: e.target.value })} /></label>
                      <label><span>Preço unitário (R$)</span><input inputMode="decimal" value={i.preco_unitario} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { preco_unitario: e.target.value })} /></label>
                      <label><span>Item no pedido<small> · ex.: 060</small></span><input value={i.item_pedido} maxLength={20} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { item_pedido: e.target.value })} /></label>
                      <label><span>Prazo</span><input type="date" value={i.prazo_entrega} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { prazo_entrega: e.target.value })} /></label>
                    </div>
                    {hist.length > 0 && aberto && (
                      <p className="nfe-item-calculo">Já cobrado: {hist.map((h) => `${money(Number(h.preco_unitario))} (#${h.orcamento.numero}, ${h.orcamento.cliente?.name ?? "—"}, ${date(h.orcamento.data_orcamento)}${h.orcamento.situacao === "ganho" ? ", ganho" : ""})`).join(" · ")}</p>
                    )}
                    {banco && situacao === "ganho" && (
                      <div className="vnd-saldo">
                        <span>Pedido <b>{qtd(banco.quantidade)}</b></span>
                        <span>Produzido <b>{qtd(produzido)}</b></span>
                        <span>Faturado <b>{qtd(faturadoReal)}</b></span>
                        <span>Falta faturar <b>{qtd(Number(banco.quantidade) - faturadoReal)}</b></span>
                      </div>
                    )}
                    {notas.length > 0 && (
                      <ul className="nfe-eventos">
                        {notas.map((n) => (
                          <li key={`${n.nfe_id}-${n.item_id}`}>
                            <b>NF-e {n.numero ? `nº ${n.numero}` : "(rascunho)"}{n.ambiente !== "producao" ? ` · ${n.ambiente === "treino" ? "TREINO" : "homologação"}` : ""} · {qtd(n.quantidade)} {i.unidade}</b>
                            <small>{n.situacao === "cancelada" ? "Cancelada: a quantidade voltou para faturar" : n.situacao}{n.emissao ? ` · ${dataHora(n.emissao)}` : ""}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {editavel && <div><Button variant="secondary" compact onClick={() => { setItens((l) => [...l, { chave: novaChave(), product_id: "", busca: "", descricao: "", desenho: "", unidade: "PC", quantidade: "", preco_unitario: "", prazo_entrega: "", item_pedido: "", observacao: "" }]); setSujo(true); }}>Adicionar item</Button></div>}
            </section>
          </fieldset>

          {o && (
            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Anexos</h2></header>
              <p className="fiscal-nota-ajuda">O pedido de compra do cliente e a cotação enviada são exigidos para marcar o orçamento como ganho: é por eles que o Jefferson confere a nota.</p>
              <div className="vnd-anexos">
                {(["pedido", "cotacao", "outro"] as const).map((tipo) => {
                  const lista = det?.anexos.filter((a) => a.tipo === tipo) ?? [];
                  return (
                    <div className="vnd-anexo" key={tipo}>
                      <b>{tipo === "pedido" ? "Pedido do cliente" : tipo === "cotacao" ? "Cotação enviada" : "Outros"}</b>
                      {lista.map((a) => (
                        <span key={a.id} className="vnd-anexo-linha">
                          {a.documento ? <a className="almox-link" href={`/api/documentos/${a.documento.id}/baixar`} target="_blank" rel="noreferrer">{a.documento.original_name}</a> : "—"}
                          {editavel && <button type="button" className="almox-link almox-perigo" onClick={() => void tirarAnexo(a.id)} disabled={ocupado !== null}>Tirar</button>}
                        </span>
                      ))}
                      {!lista.length && tipo !== "outro" && <Status tone="attention">Falta</Status>}
                      {editavel && <EscolherArquivo compacto rotulo={lista.length ? "Anexar outro" : "Anexar"} onEscolher={(f) => void anexar(tipo, f)} ocupado={ocupado === `anexo-${tipo}`} textoOcupado="Guardando…" />}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {o && (
            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Anotações</h2></header>
              <p className="fiscal-nota-ajuda">O que mudou no meio do caminho (desconto, troca de parafuso, revisão do desenho). Fica registrado com autor e data.</p>
              {det && det.anotacoes.length > 0 && (
                <ul className="nfe-eventos">{det.anotacoes.map((n) => <li key={n.id}><span>{n.texto}</span><small>{n.autor_nome ?? "—"} · {dataHora(n.created_at)}</small></li>)}</ul>
              )}
              {podeOperar && (
                <div className="vnd-anotar">
                  <label className="nfe-texto"><textarea aria-label="Nova anotação" rows={2} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: o fundo teve desconto de 890 para 830." /></label>
                  <Button variant="secondary" compact onClick={() => void anotar()} disabled={!nota.trim() || ocupado !== null}>Anotar</Button>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="nfe-lado">
          <section className="almox-bloco nfe-totais">
            <h2>Total</h2>
            <dl>
              <div><dt>Itens</dt><dd>{itens.length}</dd></div>
              <div className="nfe-total"><dt>Total do orçamento</dt><dd>{money(total)}</dd></div>
            </dl>
            <p className="fiscal-nota-ajuda">Preços sem IPI. Os impostos são calculados na nota.</p>
          </section>

          {aberto && o && (
            <section className="almox-bloco nfe-conferencia">
              <h2>Para marcar como ganho</h2>
              {faltamParaGanhar.length ? <ul className="nfe-avisos">{faltamParaGanhar.map((f) => <li key={f}>Falta {f}.</li>)}</ul> : <Status tone="success">Pronto para ganhar</Status>}
            </section>
          )}

          <section className="almox-bloco nfe-acoes-lado">
            {podeOperar && aberto && (
              <>
                <Button onClick={() => void salvar()} disabled={ocupado !== null || !cab.customer_id || (!!id && !sujo)}>{ocupado === "salvar" ? "Salvando…" : id ? "Salvar" : "Criar orçamento"}</Button>
                {o && situacao === "rascunho" && <Button variant="secondary" onClick={() => void mudarSituacao("enviado", "Marcado como enviado ao cliente.")} disabled={ocupado !== null}>Marcar como enviado</Button>}
                {o && <Button onClick={() => void mudarSituacao("ganho", "Orçamento ganho: previsão a receber criada e a produção foi avisada.")} disabled={ocupado !== null || faltamParaGanhar.length > 0}>{ocupado === "ganho" ? "Gravando…" : "Marcar como ganho"}</Button>}
                {o && <Button variant="secondary" onClick={() => setPerder(true)} disabled={ocupado !== null}>Perdido</Button>}
                {o && situacao === "rascunho" && <Button variant="ghost" className="almox-perigo" onClick={() => void excluir()} disabled={ocupado !== null}>Excluir rascunho</Button>}
                {o && situacao === "enviado" && <Button variant="ghost" className="almox-perigo" onClick={() => void mudarSituacao("cancelado", "Orçamento cancelado.")} disabled={ocupado !== null}>Cancelar orçamento</Button>}
                {!o && <Button variant="ghost" onClick={onFechar}>Descartar</Button>}
              </>
            )}
            {podeOperar && !aberto && o && (
              <>
                {situacao === "ganho" && <Button variant="secondary" onClick={() => void salvar()} disabled={ocupado !== null || !sujo}>Salvar observações</Button>}
                <Button variant="secondary" onClick={() => void mudarSituacao("rascunho", "Orçamento reaberto: a previsão a receber foi cancelada.")} disabled={ocupado !== null}>Reabrir</Button>
                <p className="fiscal-nota-ajuda">Reabrir só funciona sem entrada de produção lançada.</p>
              </>
            )}
            {sujo && <p className="fiscal-nota-ajuda">Há alterações não salvas.</p>}
          </section>
        </aside>
      </div>

      {perder && (
        <MotivoModal onClose={() => setPerder(false)} onConfirmar={async (motivo) => { setPerder(false); await mudarSituacao("perdido", "Orçamento marcado como perdido.", motivo); }} />
      )}
    </div>
  );
}

function MotivoModal({ onClose, onConfirmar }: { onClose: () => void; onConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  return (
    <Modal eyebrow="COMERCIAL · ORÇAMENTO" title="Orçamento perdido" subtitle="Por que o cliente não fechou? Vira histórico para as próximas cotações." onClose={onClose}>
      <form className="almox-form" onSubmit={(e) => { e.preventDefault(); void onConfirmar(motivo.trim()); }}>
        <label className="nfe-texto"><span>Motivo</span><textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Preço acima do concorrente, prazo, desistiu do projeto…" /></label>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" className="almox-perigo-cheio" disabled={motivo.trim().length < 3}>Marcar como perdido</Button>
        </footer>
      </form>
    </Modal>
  );
}

function NumeracaoModal({ atual, onClose, onFeito }: { atual: number; onClose: () => void; onFeito: (m: string) => void }) {
  const [valor, setValor] = useState(String(atual));
  const [erro, setErro] = useState("");
  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    const r = await api("/api/comercial/orcamentos/numeracao", { method: "POST", body: JSON.stringify({ proximo: Number(valor) }) });
    if (!r.ok) { setErro(r.error); return; }
    onFeito(`O próximo orçamento será o #${valor}.`);
  };
  return (
    <Modal eyebrow="COMERCIAL · ORÇAMENTOS" title="Numeração" subtitle="Para continuar a numeração do GRV na virada" onClose={onClose}>
      <form className="almox-form" onSubmit={salvar}>
        <div className="fiscal-campos nfe-campos">
          <label><span>Próximo número</span><input inputMode="numeric" value={valor} onChange={(e) => setValor(e.target.value.replace(/\D/g, "").slice(0, 9))} /></label>
        </div>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>Voltar</Button>
          <Button type="submit" disabled={!valor}>Gravar</Button>
        </footer>
      </form>
    </Modal>
  );
}
