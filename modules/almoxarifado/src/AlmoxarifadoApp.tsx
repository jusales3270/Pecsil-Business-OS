"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";
import { PedidoModal } from "./PedidoModal";
import { RecebimentoModal } from "./RecebimentoModal";
import { type ACaminho, DIVISAO, Icone, type Pedido, type Recebido, SITUACAO, chamar, date, hoje, money, qtd } from "./tipos";

/**
 * Almoxarifado: pede material ao Compras, acompanha a cotação e a compra, e
 * recebe o material lançando a nota — que vira conta a pagar no Financeiro e
 * linha no Painel do ICMS. Os avisos de cada passo chegam no sino.
 */

const SECOES = [
  { id: "Painel", icon: "grid" },
  { id: "Solicitações", icon: "inbox" },
  { id: "A caminho", icon: "truck" },
  { id: "Recebidos", icon: "check" },
] as const;
type Secao = (typeof SECOES)[number]["id"];

type FiltroPedido = "andamento" | "recebidos" | "cancelados" | "todos";
const FILTROS: { value: FiltroPedido; label: string; status: Pedido["status"][] | null }[] = [
  { value: "andamento", label: "Em andamento", status: ["aberta", "em_cotacao", "aprovada", "rejeitada", "comprada", "parcial"] },
  { value: "recebidos", label: "Recebidos", status: ["recebida"] },
  { value: "cancelados", label: "Cancelados", status: ["cancelada"] },
  { value: "todos", label: "Todos", status: null },
];

export default function AlmoxarifadoApp({ access, notify, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const [secao, setSecao] = useState<Secao>(() => (initialSection === "Recebimento" ? "A caminho" : SECOES.some((s) => s.id === initialSection) ? (initialSection as Secao) : "Painel"));
  const podePedir = canUseFeature(access, "almoxarifado.solicitacoes", "operar");
  const podeReceber = canUseFeature(access, "almoxarifado.recebimento", "operar");

  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [caminho, setCaminho] = useState<ACaminho[] | null>(null);
  const [erro, setErro] = useState("");
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [recebidos, setRecebidos] = useState<{ mes: string; items: Recebido[] } | null>(null);

  const [novoPedido, setNovoPedido] = useState(false);
  const [receber, setReceber] = useState<ACaminho | null | "avulso">(null);
  const [cancelar, setCancelar] = useState<Pedido | null>(null);
  const [detalhe, setDetalhe] = useState<Recebido | null>(null);

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      chamar<{ requests: Pedido[] }>("/api/almoxarifado/solicitacoes"),
      chamar<{ items: ACaminho[] }>("/api/almoxarifado/a-caminho"),
    ]);
    if (!a.ok || !b.ok) { setErro((!a.ok && a.error) || (!b.ok && b.error) || "Falha ao carregar."); return; }
    setErro("");
    setPedidos(a.data.requests);
    setCaminho(b.data.items.map((item) => ({ ...item, totalComprado: Number(item.totalComprado), jaRecebido: Number(item.jaRecebido) })));
  }, []);

  const carregarRecebidos = useCallback(async (alvo: string) => {
    const res = await chamar<{ mes: string; items: Recebido[] }>(`/api/almoxarifado/recebimentos?mes=${alvo}`);
    if (res.ok) setRecebidos({ mes: alvo, items: res.data.items.map((r) => ({ ...r, valor_total: Number(r.valor_total), icms: Number(r.icms), ipi: Number(r.ipi) })) });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(); }, 0);
    return () => clearTimeout(t);
  }, [carregar]);
  useEffect(() => {
    const t = setTimeout(() => { void carregarRecebidos(mes); }, 0);
    return () => clearTimeout(t);
  }, [carregarRecebidos, mes]);

  useEffect(() => {
    registerNav({
      moduleId: "almoxarifado",
      moduleName: "Almoxarifado",
      sidebarTree: true,
      items: SECOES.map(({ id, icon }) => ({
        id, label: id, icon,
        ...(id === "A caminho" && caminho?.length ? { badge: caminho.length, badgeTone: "attention" as const } : {}),
      })),
      activeId: secao,
      onSelect: (id) => setSecao(id as Secao),
    });
  }, [registerNav, secao, caminho?.length]);
  useEffect(() => () => registerNav(null), [registerNav]);

  const depois = async (mensagem: string) => {
    notify(mensagem);
    await Promise.all([carregar(), carregarRecebidos(mes)]);
  };

  const recebidosMes = recebidos?.mes === mes ? recebidos.items : null;
  const resumo = useMemo(() => {
    const lista = pedidos ?? [];
    return {
      aguardando: lista.filter((p) => p.status === "aberta" || p.status === "em_cotacao").length,
      aprovados: lista.filter((p) => p.status === "aprovada").length,
      rejeitados: lista.filter((p) => p.status === "rejeitada").length,
      caminhoValor: (caminho ?? []).reduce((acc, c) => acc + Math.max(0, c.totalComprado - c.jaRecebido), 0),
    };
  }, [pedidos, caminho]);

  const cabecalho = (eyebrow: string, titulo: string, texto: string, acao?: React.ReactNode) => (
    <div className="finance-page-head almox-head">
      <div><p className="eyebrow">{eyebrow}</p><h1>{titulo}</h1><p>{texto}</p></div>
      {acao}
    </div>
  );
  const botaoPedir = podePedir ? <Button onClick={() => setNovoPedido(true)}><Icone nome="mais" size={16} /> Pedir material</Button> : null;

  const cartaoPedido = (p: Pedido) => (
    <article key={p.id} className="almox-pedido">
      <header>
        <div className="almox-pedido-titulo"><span><b>Pedido #{p.numero}</b>{p.urgencia === "urgente" && <Status tone="danger">Urgente</Status>}</span><small>{DIVISAO[p.divisao]} · {p.solicitante ?? "—"} · {date(p.criadoEm)}</small></div>
        <Status tone={SITUACAO[p.status].tone}>{SITUACAO[p.status].label}</Status>
      </header>
      <div className="almox-pedido-itens">
        {p.itens.map((item, index) => <p key={index}><b>{qtd(item.quantidade)} {item.unidade}</b> {item.produto}{item.observacao && <em> — {item.observacao}</em>}</p>)}
      </div>
      {p.observacao && <p className="almox-obs">{p.observacao}</p>}
      {p.status === "cancelada" && p.motivoCancelamento && <p className="almox-obs">Cancelado: {p.motivoCancelamento}</p>}
      {podePedir && ["aberta", "em_cotacao", "aprovada", "rejeitada"].includes(p.status) && (
        <footer><Button variant="ghost" compact className="almox-perigo" onClick={() => setCancelar(p)}>Cancelar pedido</Button></footer>
      )}
    </article>
  );

  const cartaoCaminho = (c: ACaminho) => {
    const falta = Math.max(0, c.totalComprado - c.jaRecebido);
    return (
      <article key={c.cotacaoId} className="almox-pedido almox-caminho">
        <header>
          <div className="almox-pedido-titulo"><b>{c.fornecedor}</b><small>Cotação #{c.cotacaoId}{c.pedidoNumero ? ` · pedido #${c.pedidoNumero}` : ""} · comprado em {date(c.compradoEm)}{c.divisao ? ` · ${DIVISAO[c.divisao] ?? c.divisao}` : ""}</small></div>
          {c.recebimentos > 0 ? <Status tone="purple">Recebido em parte</Status> : <Status tone="info">A caminho</Status>}
        </header>
        <div className="almox-pedido-itens">
          {c.itens.map((item, index) => <p key={index}><b>{qtd(item.quantidade)} {item.unidade}</b> {item.produto}<em className="valor">{money(item.total)}</em></p>)}
        </div>
        <footer>
          <span className="almox-total">{c.recebimentos > 0 ? `Falta ${money(falta)} de ${money(c.totalComprado)}` : money(c.totalComprado)}{c.previsaoVencimento && <small>pagamento previsto {date(c.previsaoVencimento)}</small>}</span>
          {podeReceber && <Button compact onClick={() => setReceber(c)}><Icone nome="caixa" size={16} /> Receber</Button>}
        </footer>
      </article>
    );
  };

  const vazio = (titulo: string, texto: string) => <div className="finance-empty almox-vazio"><b>{titulo}</b><small>{texto}</small></div>;

  const conteudo = () => {
    if (erro) return vazio(erro, "Tente de novo em instantes.");
    if (!pedidos || !caminho) return vazio("Carregando…", "");

    if (secao === "Painel") {
      const meus = pedidos.filter((p) => !["recebida", "cancelada"].includes(p.status)).slice(0, 6);
      return (
        <>
          {cabecalho("ALMOXARIFADO", "Visão do almoxarifado", "Pedidos ao Compras, material a caminho e o que já chegou.", botaoPedir)}
          <KpiGrid>
            <Kpi label="Aguardando cotação" value={String(resumo.aguardando)} caption="Pedidos com o Compras" tone="amber" onOpen={() => setSecao("Solicitações")} />
            <Kpi label="Aprovados" value={String(resumo.aprovados)} caption={resumo.rejeitados ? `${resumo.rejeitados} rejeitado(s)` : "Aguardando o aviso de compra"} tone="green" onOpen={() => setSecao("Solicitações")} />
            <Kpi label="A caminho" value={String(caminho.length)} caption={money(resumo.caminhoValor)} tone="purple" onOpen={() => setSecao("A caminho")} />
            <Kpi label="Recebidos no mês" value={recebidosMes ? String(recebidosMes.length) : "…"} caption={recebidosMes ? money(recebidosMes.reduce((a, r) => a + r.valor_total, 0)) : ""} tone="blue" onOpen={() => setSecao("Recebidos")} />
          </KpiGrid>
          <div className="almox-painel">
            <section className="almox-bloco">
              <div className="almox-bloco-topo"><div><p className="eyebrow">CHEGANDO</p><h2>Material a caminho</h2></div>{podeReceber && <Button variant="secondary" compact onClick={() => setReceber("avulso")}>Nota sem pedido</Button>}</div>
              {caminho.length ? <div className="almox-lista">{caminho.slice(0, 4).map(cartaoCaminho)}</div> : vazio("Nada a caminho", "Quando o Compras der o aviso de compra, o material aparece aqui para você receber.")}
              {caminho.length > 4 && <button type="button" className="almox-link" onClick={() => setSecao("A caminho")}>Ver todos ({caminho.length}) ›</button>}
            </section>
            <section className="almox-bloco">
              <div className="almox-bloco-topo"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Pedidos em andamento</h2></div></div>
              {meus.length ? <div className="almox-lista">{meus.map(cartaoPedido)}</div> : vazio("Nenhum pedido em andamento", "Use \"Pedir material\" quando faltar algo. O Compras é avisado na hora.")}
            </section>
          </div>
        </>
      );
    }

    if (secao === "Solicitações") return <Solicitacoes pedidos={pedidos} cartao={cartaoPedido} cabecalho={cabecalho("ALMOXARIFADO · PEDIDOS", "Solicitações de material", "Cada pedido segue sozinho: em cotação, aprovado, comprado e recebido. Você recebe um aviso a cada passo.", botaoPedir)} />;

    if (secao === "A caminho") {
      return (
        <>
          {cabecalho("ALMOXARIFADO · RECEBIMENTO", "Material a caminho", "Compras já avisadas. Quando o material chegar, confira e lance a nota: ela vai para o pagamento e para o Painel do ICMS.",
            podeReceber ? <Button variant="secondary" onClick={() => setReceber("avulso")}><Icone nome="nota" size={16} /> Nota sem pedido</Button> : null)}
          {caminho.length ? <div className="almox-grade">{caminho.map(cartaoCaminho)}</div> : vazio("Nada a caminho", "Quando o Compras der o aviso de compra, o material aparece aqui.")}
        </>
      );
    }

    return (
      <>
        {cabecalho("ALMOXARIFADO · RECEBIDOS", "Notas recebidas", "Notas lançadas no recebimento. Cada uma virou conta a pagar e linha no Painel do ICMS.",
          <label className="almox-mes"><span>Mês</span><input type="month" value={mes} max={hoje().slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>)}
        {!recebidosMes ? vazio("Carregando…", "") : !recebidosMes.length ? vazio("Nenhuma nota recebida neste mês", "Escolha outro mês.") : (
          <section className="almox-bloco">
            <div className="almox-tabela" role="table">
              <div className="cabeca" role="row"><span>Recebido</span><span>Fornecedor</span><span>NF</span><span>Pedido</span><span>Valor</span><span>ICMS</span><span /></div>
              {recebidosMes.map((r) => (
                <button type="button" role="row" key={r.id} onClick={() => setDetalhe(r)}>
                  <span>{date(r.recebido_em)}</span>
                  <span className="nome">{r.fornecedor}</span>
                  <span>{r.nf_numero}{r.nf_serie ? `/${r.nf_serie}` : ""}</span>
                  <span>{r.material_requests?.numero ? `#${r.material_requests.numero}` : r.cotacao_id ? `cot. #${r.cotacao_id}` : "avulsa"}</span>
                  <span className="valor">{money(r.valor_total)}</span>
                  <span className="valor">{money(r.icms)}</span>
                  <span className="marcas">{r.com_xml && <Status tone="success">XML</Status>}{r.divergencia && <Status tone="danger">Divergência</Status>}{!r.encerra_pedido && <Status tone="purple">Parcial</Status>}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </>
    );
  };

  return (
    <div className="almox-modulo">
      {conteudo()}
      {novoPedido && <PedidoModal onClose={() => setNovoPedido(false)} onCriado={(numero) => { setNovoPedido(false); setSecao("Solicitações"); void depois(`Pedido #${numero} enviado ao Compras.`); }} />}
      {receber && <RecebimentoModal compra={receber === "avulso" ? null : receber} onClose={() => setReceber(null)} onFeito={(mensagem) => { setReceber(null); void depois(mensagem); }} />}
      {cancelar && <CancelarModal pedido={cancelar} onClose={() => setCancelar(null)} onFeito={() => { setCancelar(null); void depois(`Pedido #${cancelar.numero} cancelado.`); }} />}
      {detalhe && <DetalheRecebido recebido={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  );
}

function Solicitacoes({ pedidos, cartao, cabecalho }: { pedidos: Pedido[]; cartao: (p: Pedido) => React.ReactNode; cabecalho: React.ReactNode }) {
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
      {visiveis.length ? <div className="almox-grade">{visiveis.map(cartao)}</div> : <div className="finance-empty almox-vazio"><b>Nenhum pedido neste filtro</b><small>Troque o filtro ou a busca.</small></div>}
    </>
  );
}

function CancelarModal({ pedido, onClose, onFeito }: { pedido: Pedido; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const enviar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (motivo.trim().length < 3) { setErro("Informe o motivo."); return; }
    setSalvando(true);
    const res = await chamar(`/api/almoxarifado/solicitacoes/${pedido.id}/cancelar`, { method: "POST", body: JSON.stringify({ motivo }) });
    setSalvando(false);
    if (!res.ok) { setErro(res.error); return; }
    onFeito();
  };
  return (
    <Modal eyebrow="Almoxarifado" title={`Cancelar o pedido #${pedido.numero}?`} subtitle={pedido.status === "aberta" ? "O Compras ainda não começou a cotar." : "O Compras já está trabalhando nele e será avisado."} onClose={onClose}>
      <form className="almox-form" onSubmit={enviar}>
        <label className="almox-largo"><span>Motivo</span><textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Ex.: achamos o material no estoque" /></label>
        {erro && <p className="almox-erro" role="alert">{erro}</p>}
        <footer><Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Voltar</Button><Button type="submit" className="almox-perigo-cheio" disabled={salvando}>{salvando ? "Cancelando…" : "Cancelar pedido"}</Button></footer>
      </form>
    </Modal>
  );
}

function DetalheRecebido({ recebido: r, onClose }: { recebido: Recebido; onClose: () => void }) {
  return (
    <Modal eyebrow={`Recebimento #${r.numero}`} title={`NF ${r.nf_numero}${r.nf_serie ? `/${r.nf_serie}` : ""} · ${r.fornecedor}`} subtitle={`Recebida em ${date(r.recebido_em)}${r.received_by_name ? ` por ${r.received_by_name}` : ""}`} onClose={onClose}>
      <div className="almox-detalhe">
        <dl>
          <div><dt>Valor da nota</dt><dd><b>{money(r.valor_total)}</b></dd></div>
          <div><dt>ICMS · IPI</dt><dd>{money(r.icms)} · {money(r.ipi)}</dd></div>
          <div><dt>Emissão</dt><dd>{date(r.emissao)}</dd></div>
          <div><dt>Origem</dt><dd>{r.com_xml ? "XML da NF-e" : "Digitada"}{r.cotacao_id ? ` · cotação #${r.cotacao_id}` : " · sem pedido"}</dd></div>
          {r.nf_chave && <div className="largo"><dt>Chave de acesso</dt><dd className="mono">{r.nf_chave}</dd></div>}
          <div className="largo"><dt>Vencimentos</dt><dd>{r.receipt_installments.map((d) => `${date(d.vencimento)} · ${money(Number(d.valor))}`).join("  |  ")}</dd></div>
          {r.divergencia && <div className="largo"><dt>Divergência</dt><dd>{r.divergencia_motivo}</dd></div>}
          {r.observacao && <div className="largo"><dt>Observação</dt><dd>{r.observacao}</dd></div>}
        </dl>
        {r.receipt_items.length > 0 && (
          <div className="almox-pedido-itens">
            {[...r.receipt_items].sort((a, b) => a.ordem - b.ordem).map((item, index) => <p key={index}><b>{qtd(Number(item.quantidade))} {item.unidade ?? ""}</b> {item.descricao}<em className="valor">{money(Number(item.valor_total))}</em></p>)}
          </div>
        )}
        <footer><Button variant="secondary" onClick={onClose}>Fechar</Button></footer>
      </div>
    </Modal>
  );
}
