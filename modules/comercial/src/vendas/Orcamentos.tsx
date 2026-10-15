"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, EscolherArquivo, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../../packages/design-system";
import { MODALIDADES_FRETE, SITUACOES_ORCAMENTO } from "../../../../lib/comercial/vendas";
import { api, curto, date, dataHora, hoje, money } from "../../../fiscal/src/comum";
import { lerNumeroBr } from "../../../../lib/numero-br";
import { SITUACAO_MASCARA, ehSaida, impostosDoOrcamento, mascaraDoBanco, situacaoDaMascara, sugerirMascara, type Mascara } from "../../../../lib/fiscal/mascaras";
import { ProdutoModal, vazio as produtoVazio, type DadosProdutos, type Grupo, type Produto } from "./Produtos";
import { BuscaProduto } from "./BuscaProduto";
import { pareceCodigo } from "../../../../lib/comercial/busca-produto";
import { SITUACAO_OS_FORJA } from "../../../../lib/forja/envio-os-core";
import { FaixaTreino, gravarModoTreino, lerModoTreino, numeroOrcamento } from "../../../../app/components/faixa-treino";

/**
 * Comercial › Vendas › Orçamentos — o orçamento do GRV (P88) na plataforma (docs/PLANO-ORCAMENTO.md,
 * E2): itens pelo código interno, o pedido de compra do cliente e a cotação anexados (exigidos
 * para marcar como ganho — regra do Jefferson), anotações das mudanças e, depois de ganho, o que
 * já foi produzido e as notas que entregaram cada item.
 */

type Situacao = "rascunho" | "enviado" | "ganho" | "perdido" | "cancelado";
type Resumo = {
  id: string; numero: number; treino?: boolean; customer_id: string; contato: string | null; data_orcamento: string; validade: string | null; situacao: Situacao;
  pedido_cliente: string | null; prazo_entrega: string | null; ganho_em: string | null; motivo_perda: string | null; created_by_name: string | null;
  updated_at: string; cliente: { name: string } | null; total: number; itens: number;
};
type NotaDoOrcamento = {
  item_id: string; nfe_id: string; ambiente: string; situacao: string; serie: number | null; numero: number | null; emissao: string | null; quantidade: number;
  valor_unitario: number | null; valor_nota: number | null; chave: string | null; tem_danfe: boolean;
};
type Lista = { orcamentos: Resumo[]; clientes: { id: string; name: string }[]; proximoNumero: number; podeOperar: boolean; podeNumeracao: boolean };
type ItemBanco = {
  id: string; ordem: number; product_id: string; descricao: string; desenho: string | null; unidade: string; quantidade: number; preco_unitario: number;
  prazo_entrega: string | null; item_pedido: string | null; observacao: string | null; produto: { codigo: string; ncm: string | null } | null;
};
type Detalhe = {
  orcamento: Resumo & { condicao_pagamento: string | null; frete_modalidade: number; observacoes: string | null; ganho_por_nome: string | null; mascara_id: string | null; cliente: { name: string; tax_id: string | null; uf: string | null; ind_ie: number | null } | null };
  itens: ItemBanco[];
  anotacoes: { id: string; texto: string; autor_nome: string | null; created_at: string }[];
  anexos: { id: string; tipo: "pedido" | "cotacao" | "outro"; created_by_name: string | null; created_at: string; documento: { id: string; title: string; original_name: string } | null }[];
  notasFiscais: NotaDoOrcamento[];
  entradas: { id: string; quote_item_id: string; quantidade: number; data: string; created_by_name: string | null }[];
  historico: { product_id: string; preco_unitario: number; quantidade: number; orcamento: { id: string; numero: number; data_orcamento: string; situacao: string; cliente: { name: string } | null } }[];
  /** OS em rascunho na Forja, por item (orçamento ganho). */
  forja?: { quote_item_id: string | null; status: "pendente" | "enviado" | "erro" | "cancelar" | "cancelado"; ultimo_erro: string | null; forja_codigo: string | null; forja_status: string | null }[];
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
  // Treino (pedido do proprietário): orçamentos para treinar e caçar erro antes da produção, separados dos reais.
  const [treino, setTreino] = useState<boolean>(lerModoTreino);
  const trocarModo = (t: boolean) => { setTreino(t); setDados(null); gravarModoTreino(t); };

  const carregar = useCallback(async () => {
    const r = await api<Lista>(`/api/comercial/orcamentos${treino ? "?treino=1" : ""}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, [treino]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  if (aberto) return <EditorOrcamento id={aberto === "novo" ? null : aberto} treinoNovo={treino} notify={notify} onAbrir={setAberto} onFechar={() => { setAberto(null); void carregar(); }} />;

  const todos = dados?.orcamentos ?? [];
  const lista = todos.filter((o) => NO_FILTRO[filtro](o.situacao));
  const abertos = todos.filter((o) => NO_FILTRO.abertos(o.situacao));
  const ganhos = todos.filter((o) => o.situacao === "ganho");

  return (
    <div className="icms-modulo">
      <div className="finance-page-head">
        <div><p className="eyebrow">COMERCIAL · VENDAS{treino ? " · TREINO" : ""}</p><h1>{treino ? "Orçamentos de treino" : "Orçamentos"}</h1><p>Do pedido do cliente à aprovação: itens, cotação e pedido de compra anexados. O orçamento ganho é o que a produção faz e o Fiscal fatura.</p></div>
        <div className="icms-acoes">
          <Segmented<"real" | "treino"> options={[{ value: "real", label: "Reais" }, { value: "treino", label: "Treino" }]} value={treino ? "treino" : "real"} onChange={(v) => trocarModo(v === "treino")} ariaLabel="Orçamentos reais ou de treino" compact />
          {dados?.podeNumeracao && !treino && <Button variant="secondary" onClick={() => setNumeracao(true)}>Numeração</Button>}
          {dados?.podeOperar && <Button onClick={() => setAberto("novo")}>{treino ? "Novo orçamento de treino" : "Novo orçamento"}</Button>}
        </div>
      </div>
      {treino && <FaixaTreino texto="Orçamentos de treino (T-1, T-2…), separados dos reais: o ganho não cria previsão a receber nem mexe no funil, a entrada de produção e as notas ficam no treino. Tudo será apagado quando a plataforma entrar em produção." />}
      {erro && <div className="finance-empty almox-vazio"><b>{erro}</b></div>}
      {!dados && !erro && <div className="finance-empty almox-vazio"><small>Carregando…</small></div>}
      {dados && (
        <>
          <KpiGrid>
            <Kpi label="Em aberto" value={String(abertos.length)} caption={curto(abertos.reduce((a, o) => a + o.total, 0))} tone="blue" onOpen={() => setFiltro("abertos")} />
            <Kpi label="Ganhos" value={String(ganhos.length)} caption={curto(ganhos.reduce((a, o) => a + o.total, 0))} tone="green" onOpen={() => setFiltro("ganho")} />
            <Kpi label="Perdidos ou cancelados" value={String(todos.length - abertos.length - ganhos.length)} caption="Com o motivo registrado" tone="neutral" onOpen={() => setFiltro("perdido")} />
            <Kpi label="Próximo número" value={numeroOrcamento(dados.proximoNumero, treino)} caption={treino ? "Numeração do treino" : "Continua a numeração do GRV"} tone="neutral" />
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
                    <span className="vnd-codigo">{numeroOrcamento(o.numero, treino)}</span>
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
type Cab = { customer_id: string; contato: string; data_orcamento: string; validade: string; pedido_cliente: string; condicao_pagamento: string; frete_modalidade: string; prazo_entrega: string; observacoes: string; mascara_id: string };
type Cliente = { id: string; name: string; uf?: string | null; ind_ie?: number | null };
type DadosMascaras = { mascaras: Mascara[]; ipiPorNcm: Map<string, number | null>; ufEmpresa: string | null };
let seq = 0;
const novaChave = () => `i${++seq}`;
const rotuloProduto = (p: Pick<Produto, "codigo" | "descricao">) => `${p.codigo} — ${p.descricao}`;

/** Também aberto pelo Fiscal › A faturar: o Jefferson vê o orçamento inteiro (só leitura, sem comercial.orcamentos). */
export function EditorOrcamento({ id, treinoNovo, notify, onAbrir, onFechar, voltar = "Voltar à lista" }: { id: string | null; treinoNovo: boolean; notify: (m: string) => void; onAbrir: (id: string) => void; onFechar: () => void; voltar?: string }) {
  const [det, setDet] = useState<Detalhe | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [fiscal, setFiscal] = useState<DadosMascaras | null>(null);
  // Escolheu a máscara à mão: trocar o cliente não troca mais a máscara sozinha.
  const [mascaraManual, setMascaraManual] = useState(false);
  const [podeOperar, setPodeOperar] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [podeCadastrar, setPodeCadastrar] = useState(false);
  // Cadastro de produto aberto a partir do orçamento: o item (chave) recebe a peça nova; sem chave, vira um item novo.
  const [cadastro, setCadastro] = useState<{ chave: string | null; texto: string } | null>(null);
  const [cab, setCab] = useState<Cab>(() => ({ customer_id: "", contato: "", data_orcamento: hoje(), validade: "", pedido_cliente: "", condicao_pagamento: "", frete_modalidade: "9", prazo_entrega: "", observacoes: "", mascara_id: "" }));
  const [itens, setItens] = useState<ItemForm[]>([]);
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [perder, setPerder] = useState(false);
  const [nota, setNota] = useState("");
  // Nota fiscal aberta no popup (DANFE para conferir e imprimir).
  const [notaAberta, setNotaAberta] = useState<string | null>(null);

  const carregarProdutos = useCallback(async () => {
    const [r, f] = await Promise.all([
      api<{ produtos: Produto[]; clientes: Cliente[]; grupos: Grupo[]; podeOperar: boolean }>("/api/comercial/produtos?ativos=1"),
      api<{ mascaras: Record<string, unknown>[]; ncms: { ncm: string; ipi_aliquota: number | null }[]; ufEmpresa: string | null }>("/api/fiscal/mascaras"),
    ]);
    if (r.ok) { setProdutos(r.data.produtos); setClientes(r.data.clientes); setGrupos(r.data.grupos); setPodeCadastrar(r.data.podeOperar); }
    if (f.ok) setFiscal({ mascaras: f.data.mascaras.map(mascaraDoBanco).filter((m) => ehSaida(m)), ipiPorNcm: new Map(f.data.ncms.map((n) => [n.ncm, n.ipi_aliquota === null ? null : Number(n.ipi_aliquota)])), ufEmpresa: f.data.ufEmpresa });
    return r.ok ? r.data.produtos : null;
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
      mascara_id: o.mascara_id ?? "",
    });
    setMascaraManual(Boolean(o.mascara_id));
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
  const anexoPedido = det?.anexos.some((a) => a.tipo === "pedido") ?? false;
  const anexoCotacao = det?.anexos.some((a) => a.tipo === "cotacao") ?? false;
  const faltamParaGanhar = [
    !itens.length && "itens",
    !cab.pedido_cliente.trim() && "o nº do pedido de compra do cliente",
    !anexoPedido && "o anexo do pedido do cliente",
    !anexoCotacao && "o anexo da cotação enviada",
  ].filter(Boolean) as string[];

  const mudarCab = (k: keyof Cab, v: string) => { setCab((c) => ({ ...c, [k]: v })); setSujo(true); };
  const clienteAtual = clientes.find((c) => c.id === cab.customer_id) ?? (det?.orcamento.cliente ? { id: cab.customer_id, ...det.orcamento.cliente } : null);
  const sugestao = fiscal ? sugerirMascara(fiscal.mascaras, clienteAtual?.uf, fiscal.ufEmpresa) : null;
  const mascara = fiscal?.mascaras.find((m) => m.id === cab.mascara_id) ?? null;
  const ncmDe = (productId: string) => produtos.find((p) => p.id === productId)?.ncm ?? det?.itens.find((x) => x.product_id === productId)?.produto?.ncm ?? null;
  const impostos = useMemo(() => impostosDoOrcamento({
    itens: itens.map((i) => ({ quantidade: lerNumero(i.quantidade), preco: lerNumero(i.preco_unitario), ncm: i.product_id ? ncmDe(i.product_id) : null, descricao: i.descricao })),
    mascara, ipiPorNcm: fiscal?.ipiPorNcm ?? new Map(), consumidorFinal: clienteAtual?.ind_ie === 9,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [itens, mascara, fiscal, clienteAtual?.ind_ie, produtos, det]);
  const trocarCliente = (id: string) => {
    const c = clientes.find((x) => x.id === id);
    const s = fiscal ? sugerirMascara(fiscal.mascaras, c?.uf, fiscal.ufEmpresa) : null;
    setCab((atual) => ({ ...atual, customer_id: id, mascara_id: !mascaraManual && s?.mascara ? s.mascara.id : atual.mascara_id }));
    setSujo(true);
  };
  const mudarItem = (chave: string, parcial: Partial<ItemForm>) => { setItens((l) => l.map((i) => (i.chave === chave ? { ...i, ...parcial } : i))); setSujo(true); };
  // Escolheu a peça na lista: o item ganha descrição, unidade e desenho do cadastro; o NCM entra no cálculo
  // dos impostos. Sem cliente ainda, o orçamento fica com o cliente dono da peça.
  const doProduto = (p: Produto): Partial<ItemForm> => ({
    busca: rotuloProduto(p), product_id: p.id, descricao: p.descricao, unidade: p.unidade || "PC",
    desenho: p.desenho_codigo ? `${p.desenho_codigo}${p.desenho_revisao ? ` rev. ${p.desenho_revisao}` : ""}` : "",
  });
  const escolherProduto = (chave: string, p: Produto) => {
    mudarItem(chave, doProduto(p));
    if (!cab.customer_id && p.customer_id && clientes.some((c) => c.id === p.customer_id)) trocarCliente(p.customer_id);
  };
  const nomeCliente = (cid: string | null) => (cid ? clientes.find((c) => c.id === cid)?.name ?? null : null);
  const itemVazio = (): ItemForm => ({ chave: novaChave(), product_id: "", busca: "", descricao: "", desenho: "", unidade: "PC", quantidade: "", preco_unitario: "", prazo_entrega: "", item_pedido: "", observacao: "" });
  const produtoCadastrado = async (novo?: { id: string; codigo: string }) => {
    const alvo = cadastro;
    setCadastro(null);
    const lista = await carregarProdutos();
    const p = novo && lista?.find((x) => x.id === novo.id);
    if (!p || !alvo) return;
    if (alvo.chave) escolherProduto(alvo.chave, p);
    else {
      setItens((l) => [...l, { ...itemVazio(), ...doProduto(p) }]);
      setSujo(true);
      if (!cab.customer_id && p.customer_id && clientes.some((c) => c.id === p.customer_id)) trocarCliente(p.customer_id);
    }
  };
  const formCadastro = (texto: string) => {
    const t = texto.trim().toUpperCase();
    return { ...produtoVazio(), customer_id: cab.customer_id, ...(pareceCodigo(t) ? { codigo: t } : { descricao: t.slice(0, 120) }) };
  };

  const ehTreino = det ? Boolean(det.orcamento.treino) : treinoNovo;
  const corpo = () => JSON.stringify({
    ...cab, treino: ehTreino, frete_modalidade: Number(cab.frete_modalidade),
    itens: itens.map((i) => ({ product_id: i.product_id, descricao: i.descricao, desenho: i.desenho, unidade: i.unidade, quantidade: lerNumero(i.quantidade), preco_unitario: lerNumero(i.preco_unitario), prazo_entrega: i.prazo_entrega, item_pedido: i.item_pedido, observacao: i.observacao })),
  });
  const rodar = async (rotulo: string, fn: () => Promise<void>) => { setOcupado(rotulo); try { await fn(); } finally { setOcupado(null); } };

  const salvar = () => rodar("salvar", async () => {
    const r = id ? await api(`/api/comercial/orcamentos/${id}`, { method: "PUT", body: corpo() }) : await api<{ id: string; numero: number }>("/api/comercial/orcamentos", { method: "POST", body: corpo() });
    if (!r.ok) { notify(r.error); return; }
    if (!id) { notify(`Orçamento ${ehTreino ? "de treino " : ""}${numeroOrcamento((r.data as { numero: number }).numero, ehTreino)} criado.`); onAbrir((r.data as { id: string }).id); return; }
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
    notify(`Clonado como orçamento ${numeroOrcamento(r.data.numero, ehTreino)}: ajuste as quantidades, o pedido e os anexos.`);
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
  const reenviarForja = () => rodar("forja", async () => {
    if (!id) return;
    const r = await api<{ reenviados: number }>(`/api/comercial/orcamentos/${id}/forja`, { method: "POST" });
    notify(r.ok ? "Enviando de novo para a Forja…" : r.error);
    setTimeout(() => { void carregar(id); }, 2500);
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
          <p className="eyebrow">COMERCIAL · ORÇAMENTO{ehTreino ? " · TREINO" : ""}</p>
          <h1>{o ? `Orçamento ${ehTreino ? "de treino " : ""}${numeroOrcamento(o.numero, ehTreino)}` : ehTreino ? "Novo orçamento de treino" : "Novo orçamento"}</h1>
          <p>{o ? <>Montado por {o.created_by_name ?? "—"}{o.ganho_por_nome ? ` · ganho por ${o.ganho_por_nome} em ${dataHora(o.ganho_em)}` : ""}</> : "Escolha o cliente, inclua os itens e salve. Depois anexe o pedido do cliente e a cotação."}</p>
        </div>
        <div className="icms-acoes">
          <Status tone={TOM[situacao]}>{SITUACOES_ORCAMENTO[situacao]}</Status>
          {o && podeOperar && <Button variant="secondary" onClick={() => void clonar()} disabled={ocupado !== null}>Clonar</Button>}
          <Button variant="secondary" onClick={onFechar}>{voltar}</Button>
        </div>
      </div>

      {ehTreino && <FaixaTreino texto="Este orçamento é de treino: siga o fluxo de verdade (anexos, ganho, produção, nota) para treinar e achar erro. Nada daqui vira pedido, previsão a receber ou nota real." />}
      {situacao === "perdido" && o?.motivo_perda && <Callout variant="danger" title="Perdido">{o.motivo_perda}</Callout>}
      {situacao === "ganho" && <Callout variant="success" title="Ganho: pedido aprovado">Itens travados. {ehTreino ? "No treino, cada item abriu um rascunho TREINO na Forja: dá para praticar roteiro, desenhos e materiais, mas ele não pode ser liberado para produção." : "Cada item abriu uma OS em rascunho na Forja: o PCP completa roteiro, desenhos e materiais e libera para produção."} A produção lança o que ficar pronto e o Fiscal fatura, em uma ou mais notas, nunca acima do pedido.</Callout>}

      <div className="nfe-editor">
        <div className="nfe-form">
          <fieldset className="nfe-form" disabled={!podeOperar || ocupado !== null}>
            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Cliente e pedido</h2></header>
              <div className="fiscal-campos nfe-campos">
                <label className="nfe-largo"><span>Cliente</span>
                  <select value={cab.customer_id} onChange={(e) => trocarCliente(e.target.value)} disabled={!aberto}>
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
                <label className="nfe-largo"><span>Máscara de impostos<small> · a nota sai com ela</small></span>
                  <select value={cab.mascara_id} onChange={(e) => { mudarCab("mascara_id", e.target.value); setMascaraManual(Boolean(e.target.value)); }} disabled={!aberto}>
                    <option value="">Escolha…</option>
                    {(fiscal?.mascaras ?? []).filter((m) => m.ativo || m.id === cab.mascara_id).map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.cfop} · {m.descricao}</option>)}
                  </select>
                  <small className="vnd-mascara-ajuda">
                    {mascara ? <>{SITUACAO_MASCARA[situacaoDaMascara(mascara)]}{mascara.ufs.length ? ` · para ${mascara.ufs.join(", ")}` : ""}</> : sugestao?.motivo ?? ""}
                    {aberto && sugestao?.mascara && sugestao.mascara.id !== cab.mascara_id && (
                      <> {mascara ? `Sugerida pelo estado do cliente: ${sugestao.mascara.codigo}.` : ""} <button type="button" className="almox-link" onClick={() => { mudarCab("mascara_id", sugestao.mascara!.id); setMascaraManual(false); }}>Usar a {sugestao.mascara.codigo}</button></>
                    )}
                  </small>
                </label>
                <label className="nfe-cheio nfe-texto"><span>Observações</span><textarea rows={2} maxLength={2000} value={cab.observacoes} onChange={(e) => mudarCab("observacoes", e.target.value)} /></label>
              </div>
            </section>

            <section className="almox-bloco fiscal-config-bloco">
              <header><h2>Itens</h2><span className="nfe-contagem">{itens.length} {itens.length === 1 ? "item" : "itens"} · {money(total)}</span></header>
              {!produtos.length && editavel && <p className="fiscal-nota-ajuda">Nenhum produto cadastrado ainda{podeCadastrar ? ": use Cadastrar produto abaixo." : ": peça a quem cuida de Comercial › Vendas › Produtos para cadastrar."}</p>}
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
                      <div className="nfe-cheio vnd-campo-produto"><span id={`${i.chave}-produto`}>Produto{editavel && <small> · digite o começo do código ou da descrição e escolha na lista</small>}</span>
                        <BuscaProduto valor={i.busca} produtos={produtos} clienteId={cab.customer_id || null} nomeCliente={nomeCliente} escolhido={Boolean(i.product_id)}
                          disabled={!aberto} podeCadastrar={editavel && podeCadastrar} labelledBy={`${i.chave}-produto`}
                          onDigitar={(texto) => mudarItem(i.chave, { busca: texto, product_id: "" })}
                          onEscolher={(p) => escolherProduto(i.chave, p)}
                          onCadastrar={(texto) => setCadastro({ chave: i.chave, texto })} />
                        {aberto && i.busca.trim() && !i.product_id && <small className="vnd-dica">Escolha uma peça da lista{podeCadastrar ? " ou cadastre a nova" : ""}: sem isso o item não grava.</small>}
                      </div>
                      <label className="nfe-cheio"><span>Descrição no orçamento</span><input value={i.descricao} maxLength={120} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { descricao: e.target.value.toUpperCase() })} /></label>
                      <label><span>Desenho</span><input value={i.desenho} maxLength={80} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { desenho: e.target.value })} /></label>
                      <label><span>Unidade</span><input value={i.unidade} maxLength={6} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { unidade: e.target.value.toUpperCase() })} /></label>
                      <label><span>Quantidade</span><input inputMode="decimal" value={i.quantidade} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { quantidade: e.target.value })} /></label>
                      <label><span>Preço unitário (R$)</span><input inputMode="decimal" value={i.preco_unitario} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { preco_unitario: e.target.value })} /></label>
                      <label><span>Item no pedido<small> · ex.: 060</small></span><input value={i.item_pedido} maxLength={20} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { item_pedido: e.target.value })} /></label>
                      <label><span>Prazo</span><input type="date" value={i.prazo_entrega} disabled={!aberto} onChange={(e) => mudarItem(i.chave, { prazo_entrega: e.target.value })} /></label>
                    </div>
                    {impostos.ok && impostos.itens[k] && (
                      <p className="nfe-item-calculo">ICMS {money(impostos.itens[k].vICMS)}{impostos.aliquotas.reducao ? ` (base ${money(impostos.itens[k].vBC)})` : ""} · IPI {money(impostos.itens[k].vIPI)}{impostos.aliquotas.ipi[k] !== null ? ` (${String(impostos.aliquotas.ipi[k]).replace(".", ",")}%)` : ""} · com IPI {money(impostos.itens[k].vProd + impostos.itens[k].vIPI)}</p>
                    )}
                    {hist.length > 0 && aberto && (
                      <p className="nfe-item-calculo">Já cobrado: {hist.map((h) => `${money(Number(h.preco_unitario))} (#${h.orcamento.numero}, ${h.orcamento.cliente?.name ?? "—"}, ${date(h.orcamento.data_orcamento)}${h.orcamento.situacao === "ganho" ? ", ganho" : ""})`).join(" · ")}</p>
                    )}
                    {banco && (() => {
                      const envio = det?.forja?.find((f) => f.quote_item_id === banco.id);
                      if (!(situacao === "ganho" || (envio && (envio.status === "cancelar" || envio.status === "erro")))) return null;
                      return (
                        <p className={`nfe-item-calculo vnd-forja${envio?.status === "erro" ? " vnd-forja-erro" : ""}`} role={envio?.status === "erro" ? "alert" : undefined}>
                          <b>OS na Forja:</b>{" "}
                          {!envio ? "entra na fila na próxima sincronização."
                            : envio.status === "pendente" ? "enviando o rascunho…"
                            : envio.status === "enviado" ? <><span className="vnd-codigo">{envio.forja_codigo}</span> · {SITUACAO_OS_FORJA[envio.forja_status ?? ""] ?? envio.forja_status ?? "rascunho"}</>
                            : envio.status === "cancelar" ? "cancelando o rascunho…"
                            : envio.status === "cancelado" ? "rascunho cancelado."
                            : <>não foi {situacao === "ganho" ? "criada" : "cancelada"}: {envio.ultimo_erro}{podeOperar && <> <button type="button" className="almox-link" onClick={() => void reenviarForja()} disabled={ocupado !== null}>Tentar de novo</button></>}</>}
                        </p>
                      );
                    })()}
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
                            <button type="button" className="vnd-nota-link" onClick={() => setNotaAberta(n.nfe_id)}>
                              <b>NF-e {n.numero ? `nº ${n.numero}` : "(rascunho)"}{n.ambiente !== "producao" ? ` · ${n.ambiente === "treino" ? "TREINO" : "homologação"}` : ""} · {qtd(n.quantidade)} {i.unidade}{n.valor_unitario !== null ? ` × ${money(Number(n.valor_unitario))} = ${money(Number(n.quantidade) * Number(n.valor_unitario))}` : ""}</b>
                              <small>{n.situacao === "cancelada" ? "Cancelada: a quantidade voltou para faturar" : n.situacao}{n.emissao ? ` · ${dataHora(n.emissao)}` : ""} · ver a nota</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {editavel && (
                <div className="vnd-itens-acoes">
                  <Button variant="secondary" compact onClick={() => { setItens((l) => [...l, itemVazio()]); setSujo(true); }}>Adicionar item</Button>
                  {podeCadastrar && <Button variant="ghost" compact onClick={() => setCadastro({ chave: null, texto: "" })}>Cadastrar produto</Button>}
                </div>
              )}
            </section>
          </fieldset>

          {o && (det?.notasFiscais.length ?? 0) > 0 && (
            <NotasDoPedido notas={det!.notasFiscais} itens={det!.itens} onAbrir={setNotaAberta} />
          )}

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
                          {a.documento && id ? <a className="almox-link" href={`/api/comercial/orcamentos/${id}/anexos?anexo=${a.id}`} target="_blank" rel="noreferrer">{a.documento.original_name}</a> : "—"}
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
              <div><dt>Produtos</dt><dd>{money(total)}</dd></div>
              {impostos.ok && (
                <>
                  <div><dt>Base do ICMS</dt><dd>{money(impostos.totais.vBC)}</dd></div>
                  <div><dt>ICMS{impostos.aliquotas.icms ? ` (${String(impostos.aliquotas.icms).replace(".", ",")}%)` : ""}</dt><dd>{money(impostos.totais.vICMS)}</dd></div>
                  <div><dt>IPI</dt><dd>{money(impostos.totais.vIPI)}</dd></div>
                </>
              )}
              <div className="nfe-total"><dt>{impostos.ok ? "Total com IPI" : "Total do orçamento"}</dt><dd>{money(impostos.ok ? impostos.totais.vNF : total)}</dd></div>
            </dl>
            {impostos.ok
              ? <p className="fiscal-nota-ajuda">Preços com o ICMS incluído; o IPI soma por fora, como na nota. Máscara {mascara?.codigo}{mascara && situacaoDaMascara(mascara) !== "confirmada" ? " ainda não confirmada com o contador" : ""}.</p>
              : <p className="fiscal-nota-ajuda">Impostos ainda não calculados: falta {impostos.faltando.join(", ")}.</p>}
          </section>

          {aberto && o && (
            <section className="almox-bloco nfe-conferencia">
              <h2>Para marcar como ganho</h2>
              {faltamParaGanhar.length ? <ul className="nfe-avisos">{faltamParaGanhar.map((f) => <li key={f}>Falta {f}.</li>)}</ul> : <Status tone="success">Pronto para ganhar</Status>}
            </section>
          )}

          {/* Quem só vê o orçamento não tem botões: o quadro de ações nem aparece. */}
          {podeOperar && <section className="almox-bloco nfe-acoes-lado">
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
          </section>}
        </aside>
      </div>

      {perder && (
        <MotivoModal onClose={() => setPerder(false)} onConfirmar={async (motivo) => { setPerder(false); await mudarSituacao("perdido", "Orçamento marcado como perdido.", motivo); }} />
      )}
      {notaAberta && id && det && (
        <NotaModal quoteId={id} nfeId={notaAberta} notas={det.notasFiscais.filter((n) => n.nfe_id === notaAberta)} itens={det.itens} onClose={() => setNotaAberta(null)} />
      )}
      {cadastro && (
        <ProdutoModal inicial={formCadastro(cadastro.texto)} produto={null} notify={notify} onClose={() => setCadastro(null)} onSalvo={(novo) => void produtoCadastrado(novo)}
          dados={{ produtos, grupos, clientes, podeOperar: podeCadastrar } satisfies DadosProdutos} />
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

/* --- Notas fiscais do pedido ----------------------------------------------------------------- */

type ItemDaNota = Pick<ItemBanco, "id" | "descricao" | "unidade" | "quantidade"> & { produto: { codigo: string } | null };
const rotuloNota = (n: NotaDoOrcamento) => `NF-e ${n.numero ? `nº ${n.numero}${n.serie ? `/${n.serie}` : ""}` : "(rascunho)"}${n.ambiente !== "producao" ? ` · ${n.ambiente === "treino" ? "TREINO" : "homologação"}` : ""}`;

/** Todas as notas que faturaram este pedido, com quantidade e valor praticado; clicar abre a nota. */
function NotasDoPedido({ notas, itens, onAbrir }: { notas: NotaDoOrcamento[]; itens: ItemDaNota[]; onAbrir: (nfe: string) => void }) {
  const porNota = [...new Map(notas.map((n) => [n.nfe_id, n])).values()];
  const item = (id: string) => itens.find((i) => i.id === id);
  return (
    <section className="almox-bloco fiscal-config-bloco">
      <header><h2>Notas fiscais deste pedido</h2><span className="nfe-contagem">{porNota.length} {porNota.length === 1 ? "nota" : "notas"}</span></header>
      <p className="fiscal-nota-ajuda">Cada nota emitida a partir deste orçamento entra aqui sozinha, com as peças e o preço praticado. Clique para conferir e imprimir.</p>
      <div className="vnd-tabela vnd-notas-pedido" role="table" aria-label="Notas fiscais deste pedido">
        <div className="cabeca" role="row"><span>Nota</span><span>Situação</span><span>Itens</span><span className="r">Valor da nota</span><span /></div>
        {porNota.map((n) => (
          <div role="row" key={n.nfe_id} className={n.situacao === "cancelada" ? "vnd-nota-cancelada" : undefined}>
            <span className="nome">{rotuloNota(n)}<small>{n.emissao ? dataHora(n.emissao) : "ainda não emitida"}</small></span>
            <span>{n.situacao}</span>
            <span className="nome">{notas.filter((x) => x.nfe_id === n.nfe_id).map((x) => (
              <small key={x.item_id}>{item(x.item_id)?.produto?.codigo ?? "—"} · {qtd(x.quantidade)} {item(x.item_id)?.unidade ?? ""}{x.valor_unitario !== null ? ` × ${money(Number(x.valor_unitario))}` : ""}</small>
            ))}</span>
            <span className="r">{n.valor_nota !== null ? money(Number(n.valor_nota)) : "—"}</span>
            <span><button type="button" className="almox-link" onClick={() => onAbrir(n.nfe_id)}>Ver nota</button></span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Popup da nota: DANFE (quando autorizada) para conferir e imprimir; antes disso, o resumo do que ela fatura. */
function NotaModal({ quoteId, nfeId, notas, itens, onClose }: { quoteId: string; nfeId: string; notas: NotaDoOrcamento[]; itens: ItemDaNota[]; onClose: () => void }) {
  const n = notas[0];
  const quadro = useRef<HTMLIFrameElement>(null);
  if (!n) return null;
  const url = `/api/comercial/orcamentos/${quoteId}/notas-fiscais/${nfeId}/danfe`;
  const item = (id: string) => itens.find((i) => i.id === id);
  const total = notas.reduce((a, x) => a + Number(x.quantidade) * Number(x.valor_unitario ?? 0), 0);
  return (
    <Modal eyebrow="ORÇAMENTO · NOTA FISCAL" title={rotuloNota(n)} subtitle={`${n.situacao}${n.emissao ? ` · emitida em ${dataHora(n.emissao)}` : ""}${n.chave ? ` · chave ${n.chave}` : ""}`} onClose={onClose}>
      <div className="vnd-nota-popup">
        <div className="vnd-nota-imprimir">
          <h3 className="vnd-nota-imprimir-titulo">{rotuloNota(n)} · deste pedido</h3>
          <div className="vnd-tabela vnd-nota-itens" role="table" aria-label="Itens deste pedido na nota">
            <div className="cabeca" role="row"><span>Código</span><span>Item</span><span className="r">Quantidade</span><span className="r">Preço praticado</span><span className="r">Total</span></div>
            {notas.map((x) => (
              <div role="row" key={x.item_id}>
                <span className="vnd-codigo">{item(x.item_id)?.produto?.codigo ?? "—"}</span>
                <span className="nome">{item(x.item_id)?.descricao ?? "—"}</span>
                <span className="r">{qtd(x.quantidade)} {item(x.item_id)?.unidade ?? ""}</span>
                <span className="r">{x.valor_unitario !== null ? money(Number(x.valor_unitario)) : "—"}</span>
                <span className="r">{money(Number(x.quantidade) * Number(x.valor_unitario ?? 0))}</span>
              </div>
            ))}
          </div>
          <p className="fiscal-nota-ajuda">Deste pedido nesta nota: <b>{money(total)}</b>{n.valor_nota !== null ? ` · valor total da nota (com impostos e outros itens): ${money(Number(n.valor_nota))}` : ""}</p>
        </div>
        {n.tem_danfe ? (
          <iframe ref={quadro} className="vnd-danfe" src={url} title={`DANFE da ${rotuloNota(n)}`} />
        ) : (
          <p className="fiscal-nota-ajuda">{n.situacao === "cancelada" ? "Nota cancelada: as peças voltaram para o saldo a faturar." : "O DANFE sai quando a nota for autorizada. Por enquanto dá para imprimir o resumo acima."}</p>
        )}
        <footer className="vnd-nota-acoes">
          {n.tem_danfe && <a className="almox-link" href={url} target="_blank" rel="noreferrer">Abrir em nova aba</a>}
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={() => { if (n.tem_danfe && quadro.current?.contentWindow) quadro.current.contentWindow.print(); else window.print(); }}>{n.tem_danfe ? "Imprimir DANFE" : "Imprimir resumo"}</Button>
        </footer>
      </div>
    </Modal>
  );
}
