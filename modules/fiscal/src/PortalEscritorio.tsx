"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Callout, EscolherArquivo, Status } from "../../../packages/design-system";
import { CREDOR_GUIA, TIPOS_GUIA, valorDigitado, type GuiaLida, type TipoGuia } from "../../../lib/fiscal/guia-parser";
import { api, curto, dataHora, date, hoje, money, nomeMes } from "./comum";

/**
 * Portal do escritório de contabilidade (Fiscal). Uma tela, dois lados:
 *   empresa    — "Escritório contábil": prepara o fechamento do mês, registra o malote, responde;
 *   escritorio — "Portal do contador": acompanha, confirma o malote, abre e responde pendências,
 *                envia anexos e guias e confere a competência.
 * As guias de imposto viram contas a pagar em aprovação no Financeiro (F-09).
 * O malote continua levando o papel; o andamento fica aqui. O escritório vê só os totais do mês.
 */

type Lado = "empresa" | "escritorio";
type Situacao = "em_preparacao" | "enviada" | "conferida" | "fechada";
type Competencia = { id: string; competencia: string; situacao: Situacao; enviada_em: string | null; enviada_por_nome: string | null; conferida_em: string | null; conferida_por_nome: string | null; fechada_em: string | null; fechada_por_nome: string | null };
type Item = { id: string; codigo: string; rotulo: string; descricao: string | null; indicador: string | null; situacao: "pendente" | "pronto" | "nao_se_aplica"; observacao: string | null; marcado_por_nome: string | null; marcado_em: string | null };
type Malote = { id: string; numero: number; enviado_em: string; conteudo: string; observacao: string | null; enviado_por_nome: string | null; recebido_em: string | null; recebido_por_nome: string | null; recebido_obs: string | null };
type Pendencia = { id: string; competencia_id: string | null; assunto: string; aberta_por_lado: Lado; aberta_por_nome: string | null; situacao: "aguardando_empresa" | "aguardando_escritorio" | "resolvida"; resolvida_por_nome: string | null; updated_at: string };
type Mensagem = { id: string; pendencia_id: string; lado: Lado; autor_nome: string | null; texto: string; created_at: string };
type Anexo = { id: string; document_id: string; competencia_id: string | null; pendencia_id: string | null; lado: Lado; nome: string; tamanho: number; enviado_por_nome: string | null; created_at: string };
type Guia = {
  id: string; tipo: TipoGuia; credor: string; valor: number; vencimento: string; linha_digitavel: string | null; observacao: string | null; situacao: "enviada" | "cancelada";
  pagamento: "em_aprovacao" | "aprovada" | "paga" | "paga_em_parte" | "cancelada"; pago_em: string | null; cancelada_motivo: string | null; cancelada_por_nome: string | null;
  document_id: string; nome_arquivo: string | null; lado: Lado; enviado_por_nome: string | null; created_at: string;
};
type Indicadores = {
  notas_entrada: { quantidade: number; valor: number; icms: number; sem_xml: number };
  notas_sefaz: { quantidade: number; fora_do_painel: number; canceladas: number };
  livro_icms: { linhas: number; credito: number; debito: number };
  malote: { enviados: number; recebidos: number };
};
type Dados =
  | { lado: Lado; precisaAceite: true; termo: { versao: string; itens: string[] } }
  | {
    lado: Lado; precisaAceite: false; mes: string; podeOperar: boolean;
    competencias: { id: string; competencia: string; situacao: Situacao }[]; competencia: Competencia | null; itens: Item[]; indicadores: Indicadores;
    malotes: Malote[]; pendencias: Pendencia[]; mensagens: Mensagem[]; anexos: Anexo[]; guias: Guia[];
  };

const ETAPAS: { id: Situacao; rotulo: string }[] = [
  { id: "em_preparacao", rotulo: "Em preparação" }, { id: "enviada", rotulo: "Enviada ao escritório" },
  { id: "conferida", rotulo: "Conferida pelo escritório" }, { id: "fechada", rotulo: "Fechada" },
];
const ITEM: Record<Item["situacao"], [string, "success" | "attention" | "neutral"]> = { pronto: ["Pronto", "success"], pendente: ["Pendente", "attention"], nao_se_aplica: ["Não se aplica", "neutral"] };
const tamanho = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

function numeroDoItem(i: Item, ind: Indicadores): string | null {
  if (i.indicador === "notas_entrada") { const n = ind.notas_entrada; return `${n.quantidade} ${n.quantidade === 1 ? "nota" : "notas"} · ${curto(Number(n.valor))} · ICMS ${curto(Number(n.icms))}${n.sem_xml ? ` · ${n.sem_xml} sem XML` : ""}`; }
  if (i.indicador === "notas_sefaz") { const n = ind.notas_sefaz; return n.quantidade ? `${n.quantidade} na SEFAZ · ${n.fora_do_painel} fora do painel${n.canceladas ? ` · ${n.canceladas} cancelada(s)` : ""}` : "Nenhuma nota da SEFAZ no mês"; }
  if (i.indicador === "livro_icms") { const n = ind.livro_icms; return n.linhas ? `${n.linhas} lançamento(s) · crédito ${money(Number(n.credito))} · débito ${money(Number(n.debito))}` : "Livro sem lançamentos"; }
  if (i.indicador === "malote") { const n = ind.malote; return n.enviados ? `${n.enviados} malote(s) · ${n.recebidos} recebido(s)` : "Nenhum malote registrado"; }
  return null;
}

export function PortalEscritorio({ notify }: { notify: (m: string) => void }) {
  const [mes, setMes] = useState(hoje().slice(0, 7));
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async (alvo: string) => {
    const r = await api<Dados>(`/api/fiscal/portal?mes=${alvo}`);
    if (!r.ok) { setErro(r.error); return; }
    setErro(""); setDados(r.data);
  }, []);
  useEffect(() => { const t = setTimeout(() => { void carregar(mes); }, 0); return () => clearTimeout(t); }, [carregar, mes]);

  const agir = async (chave: string, corpo: Record<string, unknown>, ok?: string) => {
    setOcupado(chave);
    const r = await api<{ ok: true }>("/api/fiscal/portal", { method: "POST", body: JSON.stringify(corpo) });
    setOcupado(null);
    if (!r.ok) { notify(r.error); return false; }
    if (ok) notify(ok);
    await carregar(mes);
    return true;
  };

  if (erro) return <div className="finance-empty almox-vazio"><b>{erro}</b></div>;
  if (!dados) return <div className="finance-empty almox-vazio"><small>Carregando…</small></div>;

  const doEscritorio = dados.lado === "escritorio";
  const cabecalho = (
    <div className="finance-page-head">
      <div>
        <p className="eyebrow">{doEscritorio ? "FISCAL · PORTAL DO CONTADOR" : "FISCAL · ESCRITÓRIO CONTÁBIL"}</p>
        <h1>{doEscritorio ? "Portal do contador" : "Escritório contábil"}</h1>
        <p>{doEscritorio
          ? "Andamento do fechamento de cada mês, malotes, pendências e documentos trocados com a empresa."
          : "O fechamento do mês com o escritório: checklist, malote (o papel continua indo), pendências e documentos."}</p>
      </div>
      {!dados.precisaAceite && <div className="icms-acoes"><label className="almox-mes"><span>Competência</span><input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></label></div>}
    </div>
  );

  if (dados.precisaAceite) {
    return (
      <div className="icms-modulo">
        {cabecalho}
        <section className="almox-bloco fiscal-config-bloco portal-termo">
          <header><h2>Termo de confidencialidade</h2><Status tone="info">{dados.termo.versao}</Status></header>
          <ol>{dados.termo.itens.map((t) => <li key={t}>{t}</li>)}</ol>
          <footer><Button onClick={() => void agir("aceitar", { acao: "aceitar", versao: dados.termo.versao }, "Termo aceito. Bem-vindo ao portal.")} disabled={ocupado === "aceitar"}>{ocupado === "aceitar" ? "Registrando…" : "Li e aceito"}</Button></footer>
        </section>
      </div>
    );
  }

  const c = dados.competencia;
  const pode = dados.podeOperar;
  // Fechada: todas as etapas concluídas.
  const etapa = !c ? -1 : c.situacao === "fechada" ? ETAPAS.length : ETAPAS.findIndex((e) => e.id === c.situacao);
  // O PDF de cada guia aparece na própria guia, não repetido nos documentos do mês.
  const docsDeGuia = new Set(dados.guias.map((g) => g.document_id));
  const anexosComp = dados.anexos.filter((a) => a.competencia_id && a.competencia_id === c?.id && !a.pendencia_id && !docsDeGuia.has(a.document_id));
  const abertas = dados.pendencias.filter((p) => p.situacao !== "resolvida");
  const resolvidas = dados.pendencias.filter((p) => p.situacao === "resolvida");
  const prontos = dados.itens.filter((i) => i.situacao !== "pendente").length;

  return (
    <div className="icms-modulo">
      {cabecalho}
      {!doEscritorio && <Callout variant="info" title="O que o escritório vê">Só esta tela: a situação do mês, o checklist com os totais (nunca as notas uma a uma), os malotes, as pendências e os documentos anexados aqui. O que mais ele puder ver, o proprietário libera em Pessoas e Acessos.</Callout>}

      {!c ? (
        <section className="almox-bloco">
          <div className="finance-empty">
            <b>{nomeMes(mes)} ainda não foi aberta</b>
            <small>{doEscritorio ? "A empresa abre a competência quando começa a preparar o fechamento. As pendências abertas aparecem abaixo." : "Abra a competência para montar o checklist do fechamento e acompanhar com o escritório."}</small>
            {!doEscritorio && pode && <Button onClick={() => void agir("abrir", { acao: "abrir", mes }, `Competência ${nomeMes(mes)} aberta.`)} disabled={ocupado === "abrir"}>Abrir {nomeMes(mes)}</Button>}
          </div>
        </section>
      ) : (
        <>
          <section className="almox-bloco portal-etapas" aria-label="Situação da competência">
            <ol>
              {ETAPAS.map((e, i) => (
                <li key={e.id} className={i < etapa ? "feita" : i === etapa ? "atual" : ""}>
                  <span>{i < etapa ? "✓" : i + 1}</span>
                  <b>{e.rotulo}</b>
                  <small>{e.id === "enviada" && c.enviada_em ? `${c.enviada_por_nome ?? ""} · ${dataHora(c.enviada_em)}` : e.id === "conferida" && c.conferida_em ? `${c.conferida_por_nome ?? ""} · ${dataHora(c.conferida_em)}` : e.id === "fechada" && c.fechada_em ? `${c.fechada_por_nome ?? ""} · ${dataHora(c.fechada_em)}` : ""}</small>
                </li>
              ))}
            </ol>
            {pode && (
              <div className="portal-etapas-acoes">
                {!doEscritorio && c.situacao === "em_preparacao" && <Button onClick={() => void agir("sit", { acao: "situacao", competencia: c.id, situacao: "enviada" }, "Competência enviada ao escritório.")} disabled={ocupado === "sit"}>Enviar ao escritório</Button>}
                {!doEscritorio && c.situacao === "conferida" && <Button onClick={() => void agir("sit", { acao: "situacao", competencia: c.id, situacao: "fechada" }, "Competência fechada.")} disabled={ocupado === "sit"}>Fechar competência</Button>}
                {!doEscritorio && (c.situacao === "enviada" || c.situacao === "conferida") && <Button variant="ghost" onClick={() => void agir("sit", { acao: "situacao", competencia: c.id, situacao: "em_preparacao" }, "Competência reaberta para ajustes.")} disabled={ocupado === "sit"}>Reabrir para ajustes</Button>}
                {doEscritorio && c.situacao === "enviada" && <Button onClick={() => void agir("sit", { acao: "situacao", competencia: c.id, situacao: "conferida" }, "Competência marcada como conferida.")} disabled={ocupado === "sit"}>Marcar como conferida</Button>}
                {doEscritorio && c.situacao === "conferida" && <Button variant="ghost" onClick={() => void agir("sit", { acao: "situacao", competencia: c.id, situacao: "enviada" }, "Conferência desfeita.")} disabled={ocupado === "sit"}>Desfazer conferência</Button>}
              </div>
            )}
          </section>

          <section className="almox-bloco fiscal-config-bloco">
            <header><h2>Fechamento de {nomeMes(mes)}</h2><Status tone={prontos === dados.itens.length ? "success" : "attention"}>{prontos} de {dados.itens.length}</Status></header>
            <div className="portal-checklist">
              {dados.itens.map((i) => (
                <div key={i.id} className="portal-item">
                  <div>
                    <b>{i.rotulo}</b>
                    {i.descricao && <small>{i.descricao}</small>}
                    {numeroDoItem(i, dados.indicadores) && <span className="portal-numero">{numeroDoItem(i, dados.indicadores)}</span>}
                    {(i.observacao || i.marcado_por_nome) && <small>{i.observacao ? `${i.observacao} · ` : ""}{i.marcado_por_nome ? `${i.marcado_por_nome}, ${dataHora(i.marcado_em)}` : ""}</small>}
                  </div>
                  {!doEscritorio && pode && c.situacao !== "fechada"
                    ? <select className="icms-select" value={i.situacao} aria-label={`Situação: ${i.rotulo}`} disabled={ocupado === i.id} onChange={(e) => void agir(i.id, { acao: "item", item: i.id, situacao: e.target.value })}>
                      <option value="pendente">Pendente</option><option value="pronto">Pronto</option><option value="nao_se_aplica">Não se aplica</option>
                    </select>
                    : <Status tone={ITEM[i.situacao][1]}>{ITEM[i.situacao][0]}</Status>}
                </div>
              ))}
            </div>
            <Anexos titulo="Documentos do mês" anexos={anexosComp} pode={pode && c.situacao !== "fechada"} alvo={{ competencia: c.id }} notify={notify} onMudou={() => void carregar(mes)} />
          </section>

          <Malotes competencia={c} malotes={dados.malotes} lado={dados.lado} pode={pode} ocupado={ocupado} agir={agir} />
          <Guias competencia={c} mes={mes} guias={dados.guias} lado={dados.lado} pode={pode} ocupado={ocupado} agir={agir} notify={notify} onMudou={() => void carregar(mes)} />
        </>
      )}

      <Pendencias competencia={c} abertas={abertas} resolvidas={resolvidas} mensagens={dados.mensagens} anexos={dados.anexos} lado={dados.lado} pode={pode} ocupado={ocupado} agir={agir} notify={notify} onMudou={() => void carregar(mes)} />
    </div>
  );
}

type Agir = (chave: string, corpo: Record<string, unknown>, ok?: string) => Promise<boolean>;

function Malotes({ competencia, malotes, lado, pode, ocupado, agir }: { competencia: Competencia; malotes: Malote[]; lado: Lado; pode: boolean; ocupado: string | null; agir: Agir }) {
  const [conteudo, setConteudo] = useState("");
  const [data, setData] = useState(hoje());
  const [obs, setObs] = useState<Record<string, string>>({});
  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await agir("malote", { acao: "malote", competencia: competencia.id, enviadoEm: data, conteudo }, "Malote registrado. O escritório foi avisado.")) setConteudo("");
  };
  return (
    <section className="almox-bloco fiscal-config-bloco">
      <header><h2>Malote</h2><small className="portal-sub">O papel continua indo; aqui fica o registro do que foi e do que chegou.</small></header>
      {malotes.length ? (
        <div className="portal-lista">
          {malotes.map((m) => (
            <div key={m.id} className="portal-malote">
              <div>
                <b>Malote nº {m.numero} · {m.enviado_em.split("-").reverse().join("/")}</b>
                <p>{m.conteudo}</p>
                <small>Enviado por {m.enviado_por_nome ?? "—"}{m.recebido_em ? ` · recebido por ${m.recebido_por_nome ?? "—"} em ${dataHora(m.recebido_em)}` : ""}{m.recebido_obs ? ` · "${m.recebido_obs}"` : ""}</small>
              </div>
              {m.recebido_em ? <Status tone="success">Recebido</Status> : lado === "escritorio" && pode ? (
                <div className="portal-receber">
                  <input value={obs[m.id] ?? ""} onChange={(e) => setObs((x) => ({ ...x, [m.id]: e.target.value }))} placeholder="Observação (opcional): faltou algo?" aria-label="Observação do recebimento" maxLength={500} />
                  <Button compact onClick={() => void agir(m.id, { acao: "receber", malote: m.id, observacao: obs[m.id] ?? "" }, "Recebimento confirmado.")} disabled={ocupado === m.id}>Confirmar recebimento</Button>
                </div>
              ) : <Status tone="attention">A caminho</Status>}
            </div>
          ))}
        </div>
      ) : <p className="fiscal-nota-ajuda">Nenhum malote registrado nesta competência.</p>}
      {lado === "empresa" && pode && competencia.situacao !== "fechada" && (
        <form className="portal-form" onSubmit={registrar}>
          <label className="largo"><span>O que vai no malote</span><textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={2} maxLength={2000} placeholder="Ex.: notas de entrada de setembro, extratos Itaú e Santander, guias pagas" /></label>
          <label><span>Enviado em</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></label>
          <Button type="submit" disabled={conteudo.trim().length < 2 || ocupado === "malote"}>Registrar malote</Button>
        </form>
      )}
    </section>
  );
}

function Pendencias({ competencia, abertas, resolvidas, mensagens, anexos, lado, pode, ocupado, agir, notify, onMudou }: {
  competencia: Competencia | null; abertas: Pendencia[]; resolvidas: Pendencia[]; mensagens: Mensagem[]; anexos: Anexo[]; lado: Lado; pode: boolean;
  ocupado: string | null; agir: Agir; notify: (m: string) => void; onMudou: () => void;
}) {
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [nova, setNova] = useState(false);
  const abrir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await agir("pend", { acao: "pendencia", competencia: competencia?.id ?? null, assunto, texto }, "Pendência aberta. O outro lado foi avisado.")) { setAssunto(""); setTexto(""); setNova(false); }
  };
  // "Sua vez" só para quem pode responder; quem só acompanha vê de quem é a vez.
  const minhaVez = (p: Pendencia) => pode && (lado === "empresa" ? p.situacao === "aguardando_empresa" : p.situacao === "aguardando_escritorio");
  return (
    <section className="almox-bloco fiscal-config-bloco">
      <header>
        <h2>Pendências {abertas.length ? <small>({abertas.length} em aberto)</small> : null}</h2>
        {pode && !nova && <Button variant="secondary" compact onClick={() => setNova(true)}>+ Nova pendência</Button>}
      </header>
      {nova && (
        <form className="portal-form" onSubmit={abrir}>
          <label className="largo"><span>Assunto</span><input value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={160} placeholder="Ex.: Falta o extrato do Bradesco de setembro" /></label>
          <label className="largo"><span>Mensagem</span><textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={4000} /></label>
          <div className="portal-form-acoes">
            <Button type="button" variant="ghost" onClick={() => setNova(false)}>Cancelar</Button>
            <Button type="submit" disabled={assunto.trim().length < 3 || !texto.trim() || ocupado === "pend"}>Abrir pendência</Button>
          </div>
        </form>
      )}
      {!abertas.length && !resolvidas.length && !nova && <p className="fiscal-nota-ajuda">Nenhuma pendência. Use para pedir um documento ou tirar uma dúvida: fica tudo registrado, no lugar de e-mail e WhatsApp.</p>}
      <div className="portal-lista">
        {[...abertas, ...resolvidas].map((p) => (
          <PendenciaCartao key={p.id} p={p} mensagens={mensagens.filter((m) => m.pendencia_id === p.id)} anexos={anexos.filter((a) => a.pendencia_id === p.id)}
            lado={lado} pode={pode} minhaVez={minhaVez(p)} ocupado={ocupado} agir={agir} notify={notify} onMudou={onMudou} />
        ))}
      </div>
    </section>
  );
}

function PendenciaCartao({ p, mensagens, anexos, lado, pode, minhaVez, ocupado, agir, notify, onMudou }: {
  p: Pendencia; mensagens: Mensagem[]; anexos: Anexo[]; lado: Lado; pode: boolean; minhaVez: boolean; ocupado: string | null; agir: Agir; notify: (m: string) => void; onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(minhaVez);
  const [resposta, setResposta] = useState("");
  const resolvida = p.situacao === "resolvida";
  const quem = (l: Lado) => (l === "empresa" ? "Empresa" : "Escritório");
  return (
    <article className={`portal-pendencia${resolvida ? " resolvida" : ""}`}>
      <button type="button" className="portal-pendencia-topo" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <span><b>{p.assunto}</b><small>Aberta por {quem(p.aberta_por_lado)}{p.aberta_por_nome ? ` (${p.aberta_por_nome})` : ""} · {mensagens.length} mensagem(ns){anexos.length ? ` · ${anexos.length} anexo(s)` : ""}</small></span>
        {resolvida ? <Status tone="neutral">Resolvida</Status> : minhaVez ? <Status tone="attention">Sua vez</Status> : <Status tone="info">{p.situacao === "aguardando_empresa" ? "Aguardando a empresa" : "Aguardando o escritório"}</Status>}
      </button>
      {aberto && (
        <div className="portal-pendencia-corpo">
          {mensagens.map((m) => (
            <div key={m.id} className={`portal-msg ${m.lado === lado ? "minha" : ""}`}>
              <small>{quem(m.lado)} · {m.autor_nome ?? "—"} · {dataHora(m.created_at)}</small>
              <p>{m.texto}</p>
            </div>
          ))}
          <Anexos titulo="Anexos" anexos={anexos} pode={pode && !resolvida} alvo={{ pendencia: p.id }} notify={notify} onMudou={onMudou} />
          {pode && !resolvida && (
            <form className="portal-responder" onSubmit={async (e) => { e.preventDefault(); if (await agir(`r${p.id}`, { acao: "responder", pendencia: p.id, texto: resposta })) setResposta(""); }}>
              <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={2} maxLength={4000} placeholder="Responder…" aria-label="Resposta" />
              <div className="portal-form-acoes">
                <Button type="button" variant="ghost" onClick={() => void agir(`s${p.id}`, { acao: "resolver", pendencia: p.id }, "Pendência resolvida.")} disabled={ocupado === `s${p.id}`}>Marcar como resolvida</Button>
                <Button type="submit" compact disabled={!resposta.trim() || ocupado === `r${p.id}`}>Responder</Button>
              </div>
            </form>
          )}
          {resolvida && p.resolvida_por_nome && <small className="portal-sub">Resolvida por {p.resolvida_por_nome}.</small>}
        </div>
      )}
    </article>
  );
}

function Anexos({ titulo, anexos, pode, alvo, notify, onMudou }: { titulo: string; anexos: Anexo[]; pode: boolean; alvo: { competencia?: string; pendencia?: string }; notify: (m: string) => void; onMudou: () => void }) {
  const [enviando, setEnviando] = useState(false);
  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setEnviando(true);
    const corpo = new FormData();
    corpo.append("arquivo", arquivo);
    if (alvo.competencia) corpo.append("competencia", alvo.competencia);
    if (alvo.pendencia) corpo.append("pendencia", alvo.pendencia);
    const r = await api("/api/fiscal/portal/anexo", { method: "POST", body: corpo });
    setEnviando(false);
    notify(r.ok ? `${arquivo.name} anexado.` : r.error);
    if (r.ok) onMudou();
  };
  if (!anexos.length && !pode) return null;
  return (
    <div className="portal-anexos">
      <span className="almox-rotulo">{titulo}</span>
      {anexos.map((a) => (
        <a key={a.id} className="portal-anexo" href={`/api/fiscal/portal/anexo/${a.document_id}`} target="_blank" rel="noreferrer">
          <b>{a.nome}</b><small>{tamanho(a.tamanho)} · {a.lado === "empresa" ? "empresa" : "escritório"}{a.enviado_por_nome ? ` · ${a.enviado_por_nome}` : ""} · {dataHora(a.created_at)}</small>
        </a>
      ))}
      {pode && <EscolherArquivo rotulo="Anexar arquivo" compacto ocupado={enviando} textoOcupado="Enviando o arquivo…" onEscolher={(a) => void enviar(a[0])} />}
    </div>
  );
}

const PAGAMENTO: Record<Guia["pagamento"], [string, "success" | "attention" | "neutral" | "info"]> = {
  em_aprovacao: ["Em aprovação no Financeiro", "attention"], aprovada: ["Aprovada, a pagar", "info"], paga: ["Paga", "success"],
  paga_em_parte: ["Paga em parte", "attention"], cancelada: ["Cancelada", "neutral"],
};
const linhaFormatada = (l: string | null) => (l && l.length === 48 ? l.match(/.{12}/g)!.map((b) => `${b.slice(0, 11)}-${b[11]}`).join(" ") : l ?? "");
type Rascunho = { arquivo: File; tipo: TipoGuia | ""; valor: string; vencimento: string; linha: string; observacao: string; lida: GuiaLida; erro?: string };

/**
 * Guias de imposto (F-09). Quem envia escolhe o PDF, a plataforma lê por regra e mostra os campos para
 * conferir; ao enviar, a guia vira conta a pagar EM APROVAÇÃO no Financeiro (quem aprova contas a pagar
 * é avisado). Guia errada se cancela enquanto não foi paga; paga, só o Financeiro estorna.
 */
function Guias({ competencia, mes, guias, lado, pode, ocupado, agir, notify, onMudou }: {
  competencia: Competencia; mes: string; guias: Guia[]; lado: Lado; pode: boolean; ocupado: string | null; agir: Agir; notify: (m: string) => void; onMudou: () => void;
}) {
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const ativas = guias.filter((g) => g.situacao !== "cancelada");
  const total = ativas.reduce((s, g) => s + Number(g.valor), 0);

  const ler = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    const corpo = new FormData();
    corpo.append("acao", "ler");
    corpo.append("arquivo", arquivo);
    const r = await api<{ guia: GuiaLida }>("/api/fiscal/portal/guia", { method: "POST", body: corpo });
    setLendo(false);
    if (!r.ok) { notify(r.error); return; }
    const g = r.data.guia;
    setRascunho({ arquivo, tipo: g.tipo ?? "", valor: g.valor === null ? "" : g.valor.toFixed(2).replace(".", ","), vencimento: g.vencimento ?? "", linha: g.linhaDigitavel ?? "", observacao: "", lida: g });
  };
  const enviar = async () => {
    if (!rascunho) return;
    setEnviando(true);
    const corpo = new FormData();
    corpo.append("acao", "enviar");
    corpo.append("arquivo", rascunho.arquivo);
    corpo.append("competencia", competencia.id);
    corpo.append("tipo", rascunho.tipo);
    corpo.append("valor", rascunho.valor);
    corpo.append("vencimento", rascunho.vencimento);
    corpo.append("linha", rascunho.linha);
    corpo.append("observacao", rascunho.observacao);
    const r = await api<{ guia: string }>("/api/fiscal/portal/guia", { method: "POST", body: corpo });
    setEnviando(false);
    // O erro fica no formulário (o aviso some em segundos): guia repetida, competência, arquivo.
    if (!r.ok) { notify(r.error); setRascunho({ ...rascunho, erro: r.error }); return; }
    notify(`Guia ${rascunho.tipo} enviada: virou conta a pagar em aprovação no Financeiro.`);
    setRascunho(null);
    onMudou();
  };
  const cancelar = async (g: Guia) => {
    if (await agir(`guia-${g.id}`, { acao: "cancelar_guia", guia: g.id, motivo }, `Guia ${g.tipo} cancelada; a conta a pagar foi cancelada junto.`)) { setCancelando(null); setMotivo(""); }
  };

  const avisos = rascunho ? [
    ...rascunho.lida.avisos,
    ...(rascunho.lida.competencia && rascunho.lida.competencia !== mes ? [`O PDF diz competência ${nomeMes(rascunho.lida.competencia)}, mas a tela está em ${nomeMes(mes)}: a guia entra em ${nomeMes(mes)}. Se for de outro mês, troque a competência no alto.`] : []),
    ...(!rascunho.lida.tipo ? ["Não reconheci o tipo da guia: escolha abaixo."] : []),
  ] : [];
  const valorNum = rascunho ? valorDigitado(rascunho.valor) : NaN;
  const linhaDig = rascunho?.linha.replace(/\D/g, "") ?? "";
  const completo = Boolean(rascunho && rascunho.tipo && valorNum > 0 && /^\d{4}-\d{2}-\d{2}$/.test(rascunho.vencimento) && (!linhaDig || linhaDig.length === 44 || linhaDig.length === 48));

  if (!guias.length && !pode) return null;
  return (
    <section className="almox-bloco fiscal-config-bloco" aria-label="Guias de imposto">
      <header>
        <h2>Guias de imposto</h2>
        {ativas.length > 0 && <Status tone="info">{ativas.length} {ativas.length === 1 ? "guia" : "guias"} · {money(total)}</Status>}
      </header>
      <p className="fiscal-nota-ajuda">{lado === "escritorio"
        ? "Envie aqui o PDF de cada guia do mês (DARF, DCTFWeb, DAS, GARE, FGTS, ISS). A guia vira conta a pagar no Financeiro da empresa, que aprova e paga; a situação do pagamento aparece abaixo."
        : "As guias que o escritório envia (ou que você envia daqui) viram contas a pagar em aprovação no Financeiro. Quem aprova contas a pagar é avisado."}</p>

      {guias.length > 0 && (
        <div className="portal-guias" role="table" aria-label="Guias da competência">
          <div className="cabeca" role="row"><span>Guia</span><span className="r">Valor</span><span>Vencimento</span><span>Pagamento</span><span /></div>
          {guias.map((g) => (
            <div role="row" key={g.id} className={g.situacao === "cancelada" ? "cancelada" : ""}>
              <span className="nome">
                {g.tipo} · {g.credor}
                <small>{g.lado === "escritorio" ? "Escritório" : "Empresa"}{g.enviado_por_nome ? ` · ${g.enviado_por_nome}` : ""} · {dataHora(g.created_at)}</small>
                {g.linha_digitavel && <small className="portal-linha" title={g.linha_digitavel}>{linhaFormatada(g.linha_digitavel)}</small>}
                {g.situacao === "cancelada" && <small>Cancelada{g.cancelada_por_nome ? ` por ${g.cancelada_por_nome}` : ""}: {g.cancelada_motivo}</small>}
              </span>
              <span className="r">{money(Number(g.valor))}</span>
              <span>{date(g.vencimento)}</span>
              <span><Status tone={PAGAMENTO[g.pagamento][1]}>{PAGAMENTO[g.pagamento][0]}{g.pagamento === "paga" && g.pago_em ? ` em ${date(g.pago_em)}` : ""}</Status></span>
              <span className="fiscal-dfe-acoes">
                <a className="almox-link" href={`/api/fiscal/portal/anexo/${g.document_id}`} target="_blank" rel="noreferrer">PDF</a>
                {pode && g.situacao === "enviada" && (g.pagamento === "em_aprovacao" || g.pagamento === "aprovada") && cancelando !== g.id && (
                  <button type="button" className="almox-link" onClick={() => { setCancelando(g.id); setMotivo(""); }}>Cancelar</button>
                )}
              </span>
              {cancelando === g.id && (
                <div className="portal-guia-cancelar">
                  <label><span>Motivo do cancelamento</span><input value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: valor errado, guia reemitida" autoFocus /></label>
                  <Button variant="ghost" onClick={() => setCancelando(null)}>Voltar</Button>
                  <Button onClick={() => void cancelar(g)} disabled={!motivo.trim() || ocupado === `guia-${g.id}`}>{ocupado === `guia-${g.id}` ? "Cancelando…" : "Cancelar guia e conta"}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pode && !rascunho && (
        <div className="portal-anexos">
          <EscolherArquivo rotulo="Enviar guia (PDF)" aceita=".pdf,application/pdf" compacto ocupado={lendo} textoOcupado="Lendo a guia…" onEscolher={(a) => void ler(a[0])} />
        </div>
      )}

      {rascunho && (
        <div className="portal-guia-form">
          <span className="almox-rotulo">Confira a guia antes de enviar · {rascunho.arquivo.name}</span>
          {avisos.length > 0 && <Callout variant="warning" title="Confira">{avisos.map((a) => <span key={a} className="portal-aviso">{a}</span>)}</Callout>}
          <div className="fiscal-campos">
            <label><span>Tipo</span>
              <select className="icms-select" value={rascunho.tipo} onChange={(e) => setRascunho({ ...rascunho, tipo: e.target.value as TipoGuia })}>
                <option value="">Escolha…</option>
                {TIPOS_GUIA.map((t) => <option key={t} value={t}>{t === "Outra" ? "Outra guia" : `${t} · ${CREDOR_GUIA[t]}`}</option>)}
              </select>
            </label>
            <label><span>Valor (R$)</span><input inputMode="decimal" placeholder="0,00" value={rascunho.valor} onChange={(e) => setRascunho({ ...rascunho, valor: e.target.value })} /></label>
            <label><span>Vencimento</span><input type="date" value={rascunho.vencimento} onChange={(e) => setRascunho({ ...rascunho, vencimento: e.target.value })} /></label>
            <label className="fiscal-inteiro"><span>Linha digitável <small>(48 dígitos; pode ficar em branco se a guia não tiver)</small></span><input inputMode="numeric" value={rascunho.linha} onChange={(e) => setRascunho({ ...rascunho, linha: e.target.value })} /></label>
            <label className="fiscal-inteiro"><span>Observação para o Financeiro <small>(opcional)</small></span><input maxLength={500} value={rascunho.observacao} onChange={(e) => setRascunho({ ...rascunho, observacao: e.target.value })} /></label>
          </div>
          {rascunho.lida.valorDoCodigo !== null && Math.abs(rascunho.lida.valorDoCodigo - valorNum) > 0.009 && valorNum > 0 && (
            <small className="fiscal-erro">O código de barras diz {money(rascunho.lida.valorDoCodigo)}; o valor digitado é {money(valorNum)}.</small>
          )}
          {rascunho.erro && <small className="fiscal-erro" role="alert">{rascunho.erro}</small>}
          <footer>
            <Button variant="ghost" onClick={() => setRascunho(null)} disabled={enviando}>Descartar</Button>
            <Button onClick={() => void enviar()} disabled={!completo || enviando}>{enviando ? "Enviando…" : "Enviar ao Financeiro"}</Button>
          </footer>
        </div>
      )}
    </section>
  );
}
