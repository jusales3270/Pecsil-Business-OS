"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../../packages/design-system";
import { ABERTAS, type Entrega, type Origem, SITUACAO, chamarLogistica, dataHora } from "./tipos";

/**
 * Entregas: a lista (abertas primeiro) e a criação a partir de uma OS, de um pedido ganho ou avulsa. Ao criar,
 * a plataforma acha o endereço do cliente no mapa e manda a ordem para a frota; se algo faltar (endereço,
 * origem, serviço desligado), a entrega fica gravada com o motivo e dá para tentar de novo.
 */
type LinkCliente = { id: string; entrega_id: string; expira_em: string; aberturas: number; ultima_abertura: string | null };
type Lista = { entregas: Entrega[]; origem: Origem | null; links: LinkCliente[]; servico: boolean; podeOperar: boolean };
type Candidatos = {
  os: { id: string; code: string; customer_id: string; customer_name: string | null; article_description: string | null; quantity: number | null; due_date: string | null; semEndereco: boolean }[];
  pedidos: { id: string; numero: number; customer_id: string; cliente: string; freteNosso: boolean; prazo: string | null; pedidoCliente: string | null; treino: boolean; semEndereco: boolean }[];
  clientes: { id: string; nome: string; semEndereco: boolean }[];
};
type Filtro = "abertas" | "entregues" | "todas";

export function Entregas({ notify }: { notify: (m: string) => void }) {
  const [dados, setDados] = useState<Lista | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [nova, setNova] = useState(false);
  const [cancelar, setCancelar] = useState<Entrega | null>(null);
  const [ponto, setPonto] = useState<Entrega | null>(null);
  const [link, setLink] = useState<Entrega | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarLogistica<Lista>("/api/logistica/entregas");
    if (!r.ok) { setErro(r.error); return; }
    setErro("");
    setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, 0); return () => clearTimeout(t); }, [carregar]);

  const lista = useMemo(() => {
    const todas = dados?.entregas ?? [];
    return filtro === "abertas" ? todas.filter((e) => ABERTAS.includes(e.situacao)) : filtro === "entregues" ? todas.filter((e) => e.situacao === "entregue") : todas;
  }, [dados, filtro]);
  const conta = (s: Entrega["situacao"][]) => (dados?.entregas ?? []).filter((e) => s.includes(e.situacao)).length;

  const reenviar = async (e: Entrega) => {
    setOcupado(e.id);
    const r = await chamarLogistica<Entrega>(`/api/logistica/entregas/${e.id}`, { method: "POST", body: JSON.stringify({ acao: "reenviar" }) });
    setOcupado(null);
    if (!r.ok) { notify(r.error); return; }
    notify(r.data.situacao === "enviada" ? `Entrega ${e.numero} enviada à frota.` : `Ainda não foi: ${r.data.erro ?? "tente de novo"}`);
    await carregar();
  };

  return (
    <>
      <div className="finance-page-head almox-head">
        <div>
          <p className="eyebrow">LOGÍSTICA · ENTREGAS</p>
          <h1>Entregas</h1>
          <p>Da OS ou do pedido até o cliente, com a frota própria. A entrega nasce aqui; o motorista recebe no celular e a situação volta sozinha.</p>
        </div>
        {dados?.podeOperar && <Button onClick={() => setNova(true)}>Nova entrega</Button>}
      </div>
      {erro && <Callout variant="danger" title="Não carregou">{erro}</Callout>}
      {dados && !dados.servico && <Callout variant="warning" title="Serviço de entregas desligado">As entregas ficam gravadas; vão para a frota quando o Fleetbase estiver ligado (use “Tentar de novo”).</Callout>}
      {dados?.podeOperar && dados && !dados.origem && <Callout variant="info" title="Falta a origem">Antes da primeira entrega, configure o pátio de onde o caminhão sai em Logística › Origem.</Callout>}
      <KpiGrid>
        <Kpi label="Na estrada" value={String(conta(["a_caminho"]))} tone="amber" caption="motorista já saiu" />
        <Kpi label="Com a frota" value={String(conta(["enviada"]))} tone="blue" caption="esperando o motorista sair" />
        <Kpi label="Para resolver" value={String((dados?.entregas ?? []).filter((e) => e.situacao === "criada").length)} tone={(dados?.entregas ?? []).some((e) => e.situacao === "criada") ? "red" : "green"}
          caption="criadas que ainda não foram para a frota" />
        <Kpi label="Entregues" value={String(conta(["entregue"]))} tone="green" caption="no total" />
      </KpiGrid>
      <div className="logi-filtro"><Segmented<Filtro> options={[{ value: "abertas", label: "Abertas" }, { value: "entregues", label: "Entregues" }, { value: "todas", label: "Todas" }]} value={filtro} onChange={setFiltro} ariaLabel="Filtro das entregas" /></div>
      {!dados ? <div className="finance-empty almox-vazio"><b>Carregando…</b><small /></div> : !lista.length ? (
        <div className="finance-empty almox-vazio"><b>{filtro === "abertas" ? "Nenhuma entrega aberta" : "Nenhuma entrega"}</b><small>{dados.podeOperar ? "Use “Nova entrega” a partir de uma OS, de um pedido ou avulsa." : "Quem opera a expedição cria as entregas."}</small></div>
      ) : (
        <div className="logi-tabela" role="table" aria-label="Entregas">
          <div className="logi-tr logi-th" role="row"><span role="columnheader">Nº</span><span role="columnheader">Cliente e carga</span><span role="columnheader">Situação</span><span role="columnheader">Motorista</span><span role="columnheader">Quando</span><span role="columnheader" /></div>
          {lista.map((e) => (
            <div key={e.id} className="logi-tr" role="row">
              <span role="cell" className="logi-num">{e.numero}</span>
              <span role="cell"><b>{e.cliente_nome}</b><small>{[e.origem_rotulo, e.descricao].filter(Boolean).join(" · ")}</small>{e.destino_endereco && <small>{e.destino_endereco}</small>}</span>
              <span role="cell"><Status tone={SITUACAO[e.situacao].tom}>{SITUACAO[e.situacao].rotulo}</Status>{e.rastreio && <small>rastreio {e.rastreio}</small>}{e.erro && e.situacao !== "cancelada" && <small className="logi-erro">{e.erro}</small>}{e.situacao === "cancelada" && e.erro && <small>{e.erro}</small>}</span>
              <span role="cell">{e.motorista ?? "—"}{e.veiculo && <small>{e.veiculo}</small>}</span>
              <span role="cell">{e.situacao === "entregue" ? <>entregue<small>{dataHora(e.entregue_em)}</small></> : e.situacao === "a_caminho" ? <>chega ~<small>{dataHora(e.previsao)}</small></> : e.situacao === "cancelada" ? <>cancelada<small>{dataHora(e.updated_at)}</small></> : <>criada<small>{dataHora(e.created_at)}</small></>}</span>
              <span role="cell" className="logi-acoes">
                {dados.podeOperar && e.situacao === "criada" && <Button variant="secondary" compact disabled={ocupado === e.id} onClick={() => void reenviar(e)}>{ocupado === e.id ? "Enviando…" : "Tentar de novo"}</Button>}
                {dados.podeOperar && e.situacao === "criada" && e.erro && /endereço|mapa/i.test(e.erro) && <Button variant="ghost" compact onClick={() => setPonto(e)}>Marcar o ponto</Button>}
                {dados.podeOperar && ["enviada", "a_caminho", "entregue"].includes(e.situacao) && (
                  <Button variant="ghost" compact onClick={() => setLink(e)}>{dados.links.some((l) => l.entrega_id === e.id) ? "Link do cliente ✓" : "Link do cliente"}</Button>
                )}
                {dados.podeOperar && ABERTAS.includes(e.situacao) && <Button variant="ghost" compact onClick={() => setCancelar(e)}>Cancelar</Button>}
              </span>
            </div>
          ))}
        </div>
      )}
      {nova && <NovaEntrega onFechar={() => setNova(false)} onCriada={async (e) => { setNova(false); notify(e.situacao === "enviada" ? `Entrega ${e.numero} criada e enviada à frota.` : `Entrega ${e.numero} criada, mas não foi para a frota: ${e.erro ?? "tente de novo"}`); await carregar(); }} />}
      {cancelar && <Cancelar entrega={cancelar} onFechar={() => setCancelar(null)} onFeito={async (aviso) => { setCancelar(null); notify(aviso ?? "Entrega cancelada."); await carregar(); }} />}
      {link && <LinkDoCliente entrega={link} atual={dados?.links.find((l) => l.entrega_id === link.id) ?? null} onFechar={() => setLink(null)} onMudou={() => void carregar()} />}
      {ponto && <MarcarPonto entrega={ponto} onFechar={() => setPonto(null)} onFeito={async () => { setPonto(null); notify("Ponto salvo. Use “Tentar de novo” para mandar à frota."); await carregar(); }} />}
    </>
  );
}

function NovaEntrega({ onFechar, onCriada }: { onFechar: () => void; onCriada: (e: Entrega) => void }) {
  const [tipo, setTipo] = useState<"os" | "pedido" | "avulsa">("os");
  const [cand, setCand] = useState<Candidatos | null>(null);
  const [erro, setErro] = useState("");
  const [escolha, setEscolha] = useState("");
  const [cliente, setCliente] = useState("");
  const [descricao, setDescricao] = useState("");
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void chamarLogistica<Candidatos>("/api/logistica/candidatos").then((r) => { if (!vivo) return; if (r.ok) setCand(r.data); else setErro(r.error); });
    return () => { vivo = false; };
  }, []);

  const trocarTipo = (t: typeof tipo) => { setTipo(t); setEscolha(""); setCliente(""); setDescricao(""); };
  const escolherOs = (id: string) => {
    const o = cand?.os.find((x) => x.id === id);
    setEscolha(id); setCliente(o?.customer_id ?? "");
    setDescricao(o ? [o.article_description, o.quantity ? `${o.quantity} peça(s)` : null].filter(Boolean).join(" · ") : "");
  };
  const escolherPedido = (id: string) => {
    const p = cand?.pedidos.find((x) => x.id === id);
    setEscolha(id); setCliente(p?.customer_id ?? "");
    setDescricao(p ? `Pedido ${p.numero}${p.pedidoCliente ? ` (pedido do cliente ${p.pedidoCliente})` : ""}` : "");
  };
  const filtrar = <T,>(lista: T[], texto: (x: T) => string) => { const b = busca.trim().toLowerCase(); return b ? lista.filter((x) => texto(x).toLowerCase().includes(b)) : lista; };
  const clienteSemEndereco = cand?.clientes.find((c) => c.id === cliente)?.semEndereco;

  const criar = async () => {
    setEnviando(true);
    const r = await chamarLogistica<Entrega>("/api/logistica/entregas", {
      method: "POST", body: JSON.stringify({ customer_id: cliente, origem_tipo: tipo, origem_id: tipo === "avulsa" ? null : escolha, descricao }),
    });
    setEnviando(false);
    if (!r.ok) { setErro(r.error); return; }
    onCriada(r.data);
  };

  return (
    <Modal eyebrow="LOGÍSTICA" title="Nova entrega" subtitle="A plataforma acha o endereço do cliente no mapa e manda a entrega para a frota." onClose={onFechar}>
      <div className="logi-form">
        <Segmented<typeof tipo> options={[{ value: "os", label: "De uma OS" }, { value: "pedido", label: "De um pedido" }, { value: "avulsa", label: "Avulsa" }]} value={tipo} onChange={trocarTipo} ariaLabel="Origem da entrega" />
        {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
        {!cand ? <p className="ti-nota">Carregando as OS e os pedidos…</p> : (
          <>
            {tipo !== "avulsa" && <input className="logi-busca" placeholder={tipo === "os" ? "Buscar pela OS, cliente ou peça…" : "Buscar pelo pedido ou cliente…"} value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />}
            {tipo === "os" && (
              <ul className="logi-escolhas" role="listbox" aria-label="OS abertas e em produção">
                {filtrar(cand.os, (o) => `${o.code} ${o.customer_name ?? ""} ${o.article_description ?? ""}`).slice(0, 80).map((o) => (
                  <li key={o.id}><button type="button" role="option" aria-selected={escolha === o.id} className={escolha === o.id ? "on" : ""} onClick={() => escolherOs(o.id)}>
                    <b>OS {o.code} · {o.customer_name ?? "—"}</b><small>{o.article_description ?? ""}{o.due_date ? ` · prazo ${new Date(o.due_date).toLocaleDateString("pt-BR")}` : ""}{o.semEndereco ? " · cliente sem endereço" : ""}</small>
                  </button></li>
                ))}
                {!cand.os.length && <li className="ti-nota">Nenhuma OS aberta sem entrega.</li>}
              </ul>
            )}
            {tipo === "pedido" && (
              <ul className="logi-escolhas" role="listbox" aria-label="Pedidos ganhos">
                {filtrar(cand.pedidos, (p) => `${p.numero} ${p.cliente}`).slice(0, 80).map((p) => (
                  <li key={p.id}><button type="button" role="option" aria-selected={escolha === p.id} className={escolha === p.id ? "on" : ""} onClick={() => escolherPedido(p.id)}>
                    <b>Pedido {p.numero} · {p.cliente}{p.treino ? " (treino)" : ""}</b>
                    <small>{p.freteNosso ? "frete nosso" : "frete do cliente ou sem frete: confira se o caminhão é nosso"}{p.prazo ? ` · prazo ${p.prazo}` : ""}{p.semEndereco ? " · cliente sem endereço" : ""}</small>
                  </button></li>
                ))}
                {!cand.pedidos.length && <li className="ti-nota">Nenhum pedido ganho sem entrega.</li>}
              </ul>
            )}
            {tipo === "avulsa" && (
              <label className="logi-campo"><span>Cliente</span>
                <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                  <option value="">Escolha o cliente…</option>
                  {cand.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.semEndereco ? " (sem endereço)" : ""}</option>)}
                </select>
              </label>
            )}
            <label className="logi-campo"><span>O que vai na entrega</span>
              <textarea rows={2} maxLength={500} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: 2 moldes da OS 1234, 1 caixa" />
            </label>
            {clienteSemEndereco && <Callout variant="warning" title="Cliente sem endereço completo">A entrega fica criada, mas só vai para a frota depois de completar o cadastro do cliente ou marcar o ponto no mapa.</Callout>}
          </>
        )}
        <div className="logi-rodape">
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          <Button disabled={enviando || !cliente || descricao.trim().length < 2 || (tipo !== "avulsa" && !escolha)} onClick={() => void criar()}>{enviando ? "Criando e enviando…" : "Criar e mandar à frota"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Cancelar({ entrega, onFechar, onFeito }: { entrega: Entrega; onFechar: () => void; onFeito: (aviso: string | null) => void }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const ir = async () => {
    setIndo(true);
    const r = await chamarLogistica<{ aviso: string | null }>(`/api/logistica/entregas/${entrega.id}`, { method: "POST", body: JSON.stringify({ acao: "cancelar", motivo }) });
    setIndo(false);
    if (!r.ok) { setErro(r.error); return; }
    onFeito(r.data.aviso);
  };
  return (
    <Modal eyebrow={`ENTREGA ${entrega.numero}`} title="Cancelar a entrega" subtitle={entrega.cliente_nome} onClose={onFechar}>
      <div className="logi-form">
        {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
        <label className="logi-campo"><span>Motivo</span><textarea rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente pediu para adiar" /></label>
        <div className="logi-rodape"><Button variant="secondary" onClick={onFechar}>Voltar</Button><Button disabled={indo || motivo.trim().length < 3} onClick={() => void ir()}>{indo ? "Cancelando…" : "Cancelar a entrega"}</Button></div>
      </div>
    </Modal>
  );
}

function MarcarPonto({ entrega, onFechar, onFeito }: { entrega: Entrega; onFechar: () => void; onFeito: () => void }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const m = texto.replace(/\s/g, "").match(/^(-?\d{1,2}(?:[.,]\d+)?)[,;](-?\d{1,3}(?:[.,]\d+)?)$/);
  const salvar = async () => {
    if (!m || !entrega.customer_id) return;
    const r = await chamarLogistica("/api/logistica/locais", { method: "POST", body: JSON.stringify({ customer_id: entrega.customer_id, lat: Number(m[1].replace(",", ".")), lng: Number(m[2].replace(",", ".")), endereco: entrega.destino_endereco ?? "" }) });
    if (!r.ok) { setErro(r.error); return; }
    onFeito();
  };
  return (
    <Modal eyebrow={`ENTREGA ${entrega.numero}`} title="Marcar o ponto do cliente" subtitle={entrega.cliente_nome} onClose={onFechar}>
      <div className="logi-form">
        <p className="ti-nota">No Google Maps ou no OpenStreetMap, clique no portão do cliente e copie a coordenada (ex.: -22.7395, -47.3317). Ela fica guardada para as próximas entregas.</p>
        {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
        <label className="logi-campo"><span>Coordenada (latitude, longitude)</span><input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="-22.7395, -47.3317" /></label>
        <div className="logi-rodape"><Button variant="secondary" onClick={onFechar}>Voltar</Button><Button disabled={!m} onClick={() => void salvar()}>Salvar o ponto</Button></div>
      </div>
    </Modal>
  );
}

/**
 * Link de rastreio para o cliente: sem conta, vale 3 dias, mostra a entrega e o caminhão a caminho, sem dados do
 * motorista. O código aparece só ao gerar (no banco fica o hash): gerar de novo troca o link e o anterior deixa de
 * valer. Mandar ou não o link ao cliente é decisão do Comercial.
 */
function LinkDoCliente({ entrega, atual, onFechar, onMudou }: { entrega: Entrega; atual: LinkCliente | null; onFechar: () => void; onMudou: () => void }) {
  const [gerado, setGerado] = useState<{ url: string; expira: string } | null>(null);
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const gerar = async () => {
    setIndo(true); setErro("");
    const r = await chamarLogistica<{ codigo: string; expira_em: string }>(`/api/logistica/entregas/${entrega.id}`, { method: "POST", body: JSON.stringify({ acao: "link" }) });
    setIndo(false);
    if (!r.ok) { setErro(r.error); return; }
    setGerado({ url: `${window.location.origin}/rastreio/${r.data.codigo}`, expira: r.data.expira_em });
    onMudou();
  };
  const cancelar = async () => {
    if (!atual) return;
    const r = await chamarLogistica(`/api/logistica/entregas/${entrega.id}`, { method: "POST", body: JSON.stringify({ acao: "cancelar_link", link: atual.id }) });
    if (!r.ok) { setErro(r.error); return; }
    setGerado(null); onMudou(); onFechar();
  };
  const copiar = async () => {
    if (!gerado) return;
    try { await navigator.clipboard.writeText(gerado.url); setCopiado(true); } catch { setCopiado(false); }
  };
  return (
    <Modal eyebrow={`ENTREGA ${entrega.numero}`} title="Link de rastreio para o cliente" subtitle={entrega.cliente_nome} onClose={onFechar}>
      <div className="logi-form">
        <p className="ti-nota">O cliente abre sem login e vê a entrega, a previsão de chegada e o caminhão no mapa enquanto está a caminho. Não aparece nome, telefone nem placa do motorista. O link vale 3 dias. Mandar ou não o link é decisão do Comercial.</p>
        {erro && <Callout variant="danger" title="Não deu">{erro}</Callout>}
        {atual && !gerado && <Callout variant="info" title="Já existe um link aberto">Aberto {atual.aberturas} vez(es) · vale até {dataHora(atual.expira_em)}. O endereço só aparece quando é gerado; gere de novo para ter o link (o anterior deixa de valer).</Callout>}
        {gerado && (
          <label className="logi-campo"><span>Link (vale até {dataHora(gerado.expira)})</span>
            <span className="logi-junto"><input readOnly value={gerado.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link de rastreio" />
              <Button variant="secondary" compact onClick={() => void copiar()}>{copiado ? "Copiado" : "Copiar"}</Button></span>
          </label>
        )}
        <div className="logi-rodape">
          {atual && <Button variant="ghost" onClick={() => void cancelar()}>Cancelar o link</Button>}
          <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          <Button disabled={indo} onClick={() => void gerar()}>{indo ? "Gerando…" : atual || gerado ? "Gerar um novo link" : "Gerar o link"}</Button>
        </div>
      </div>
    </Modal>
  );
}

