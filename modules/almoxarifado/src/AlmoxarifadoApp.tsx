"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Kpi, KpiGrid, Modal, Status } from "../../../packages/design-system";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";
import { PedidoModal } from "./PedidoModal";
import { CancelarModal, CartaoPedido, ListaPedidos } from "./pedidos-ui";
import { RecebimentoModal } from "./RecebimentoModal";
import { type ACaminho, DIVISAO, Icone, type NotaLidaResposta, type Pedido, type Recebido, chamar, date, hoje, lerNotaArquivo, money, qtd } from "./tipos";

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
  const [notaInicial, setNotaInicial] = useState<NotaLidaResposta | undefined>(undefined);
  const [arquivoDaNota, setArquivoDaNota] = useState<File | null>(null);
  const [notaLida, setNotaLida] = useState<NotaLidaResposta | null>(null);
  const [lendoNota, setLendoNota] = useState(false);
  const arquivoNota = useRef<HTMLInputElement>(null);
  const enviarNota = async (file: File | undefined) => {
    if (!file) return;
    setLendoNota(true);
    const res = await lerNotaArquivo(file);
    setLendoNota(false);
    if (!res.ok) { notify(res.error); return; }
    if (res.data.jaRecebida) { notify(`Esta nota já foi recebida (recebimento #${res.data.jaRecebida.numero}, ${date(res.data.jaRecebida.em)}).`); return; }
    setArquivoDaNota(file);
    setNotaLida(res.data);
  };
  const abrirRecebimento = (alvo: ACaminho | "avulso", lida: NotaLidaResposta) => { setNotaLida(null); setNotaInicial(lida); setReceber(alvo); };
  const botaoEnviarNota = podeReceber ? (
    <>
      <input ref={arquivoNota} type="file" accept=".xml,.pdf,text/xml,application/xml,application/pdf" hidden onChange={(e) => { void enviarNota(e.target.files?.[0]); e.target.value = ""; }} />
      <Button compact onClick={() => arquivoNota.current?.click()} disabled={lendoNota}><Icone nome="nota" size={16} /> {lendoNota ? "Lendo a nota…" : "Enviar nota"}</Button>
    </>
  ) : null;
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

  const cartaoPedido = (p: Pedido) => <CartaoPedido key={p.id} pedido={p} onCancelar={podePedir ? setCancelar : undefined} />;

  const cartaoCaminho = (c: ACaminho) => {
    const falta = Math.max(0, c.totalComprado - c.jaRecebido);
    return (
      <article key={c.cotacaoId} className="almox-pedido almox-caminho">
        <header>
          <div className="almox-pedido-titulo"><b>{c.fornecedor}</b><small>Cotação #{c.cotacaoId}{c.pedidoNumero ? ` · pedido #${c.pedidoNumero}` : ""}{c.origem === "FUNDICAO" ? ` · para a Fundição (${c.solicitante ?? "—"})` : ""} · comprado em {date(c.compradoEm)}{c.divisao ? ` · ${DIVISAO[c.divisao] ?? c.divisao}` : ""}</small></div>
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
              <div className="almox-bloco-topo"><div><p className="eyebrow">CHEGANDO</p><h2>Material a caminho</h2></div>{podeReceber && <div className="almox-acoes-topo">{botaoEnviarNota}<Button variant="secondary" compact onClick={() => setReceber("avulso")}>Nota sem pedido</Button></div>}</div>
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

    if (secao === "Solicitações") return <ListaPedidos pedidos={pedidos} cartao={cartaoPedido} cabecalho={cabecalho("ALMOXARIFADO · PEDIDOS", "Solicitações de material", "Cada pedido segue sozinho: em cotação, aprovado, comprado e recebido. Você recebe um aviso a cada passo.", botaoPedir)} />;

    if (secao === "A caminho") {
      return (
        <>
          {cabecalho("ALMOXARIFADO · RECEBIMENTO", "Material a caminho", "Compras já avisadas. Quando o material chegar, confira e lance a nota: ela vai para o pagamento e para o Painel do ICMS.",
            podeReceber ? <div className="almox-acoes-topo">{botaoEnviarNota}<Button variant="secondary" onClick={() => setReceber("avulso")}><Icone nome="nota" size={16} /> Nota sem pedido</Button></div> : null)}
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
      {receber && <RecebimentoModal compra={receber === "avulso" ? null : receber} inicial={notaInicial} arquivoInicial={notaInicial ? arquivoDaNota : null} onClose={() => { setReceber(null); setNotaInicial(undefined); setArquivoDaNota(null); }} onFeito={(mensagem) => { setReceber(null); setNotaInicial(undefined); setArquivoDaNota(null); void depois(mensagem); }} />}
      {notaLida && (
        <Modal eyebrow="Almoxarifado · enviar nota" title={`NF ${notaLida.nfe.numero}${notaLida.nfe.serie ? `/${notaLida.nfe.serie}` : ""} · ${notaLida.fornecedor?.nome ?? notaLida.nfe.emitente.nome}`} subtitle={`${money(notaLida.nfe.valorNota)} · emitida em ${date(notaLida.nfe.emissao)} · lida do ${notaLida.origem === "pdf" ? "PDF (confira os valores)" : "XML"}`} onClose={() => setNotaLida(null)}>
          <div className="almox-form">
            {notaLida.pedidos.length ? (
              <>
                <p>{notaLida.pedidos.length === 1 ? "Esta nota combina com o pedido abaixo." : "Esta nota combina com estes pedidos. Escolha o certo:"}</p>
                <div className="almox-nota-pedidos">
                  {notaLida.pedidos.map((p) => {
                    const c = (caminho ?? []).find((x) => x.cotacaoId === p.cotacaoId);
                    return c ? (
                      <button key={p.cotacaoId} type="button" onClick={() => abrirRecebimento(c, notaLida)}>
                        <span><b>{c.fornecedor}</b><small>{c.pedidoNumero ? `Pedido #${c.pedidoNumero} · ` : ""}cotação #{c.cotacaoId}{c.solicitante ? ` · ${c.solicitante}` : ""} · {p.motivo === "cnpj" ? "mesmo CNPJ" : p.motivo === "fornecedor" ? "mesmo fornecedor" : "nome parecido"}</small></span>
                        <span className="r"><b>{money(p.falta)}</b><small>{p.valorConfere ? "valor confere" : "valor diferente"}</small></span>
                      </button>
                    ) : null;
                  })}
                </div>
              </>
            ) : <p>Nenhum pedido a caminho combina com esta nota{notaLida.fornecedor ? ` de ${notaLida.fornecedor.nome}` : ""}. Você pode recebê-la sem pedido (o Compras é avisado).</p>}
            <footer>
              <Button variant="secondary" onClick={() => setNotaLida(null)}>Cancelar</Button>
              <Button variant="secondary" onClick={() => abrirRecebimento("avulso", notaLida)}>Receber sem pedido</Button>
            </footer>
          </div>
        </Modal>
      )}
      {cancelar && <CancelarModal pedido={cancelar} url={`/api/almoxarifado/solicitacoes/${cancelar.id}/cancelar`} onClose={() => setCancelar(null)} onFeito={() => { setCancelar(null); void depois(`Pedido #${cancelar.numero} cancelado.`); }} />}
      {detalhe && <DetalheRecebido recebido={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
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
