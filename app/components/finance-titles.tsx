"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../packages/design-system";
import type { FinanceChartAccount, FinanceTitle } from "../../lib/data/finance";
import { agruparRecebiveis, emAberto, resumoRecebiveis, situacaoRecebivel, type SituacaoRecebivel } from "../../lib/finance/recebiveis-core";

/**
 * Contas a pagar e Contas a receber: a mesma tela, com os nomes de cada lado.
 *
 * Três listas que nunca se somam:
 *   - em aberto (nota emitida / conta lançada);
 *   - previsões (orçamento ou ordem de compra ainda sem nota, duplicata antecipada);
 *   - quitados, buscados por mês (o histórico não vem junto com o módulo).
 * Agrupado por cliente ou fornecedor, como nos relatórios que a equipe usa.
 */

type Direction = "payable" | "receivable";
type Aba = "aberto" | "previsoes" | "historico" | "quitados";
type Filtro = "Em aberto" | "Vencidos" | "A vencer" | "Em aprovação" | "Revisar" | "Cancelados";

const TEXTO = {
  payable: {
    eyebrow: "FINANCEIRO · OBRIGAÇÕES", titulo: "Contas a pagar", parte: "fornecedor", Parte: "Fornecedor",
    descricao: "Títulos por fornecedor, vencimentos e pagamentos. Previsão fica separada do que já é conta.",
    novo: "+ Nova conta", abaAberto: "A pagar", abaQuitados: "Pagas", quitado: "Pago", quitados: "pagos",
    baixar: "Registrar pagamento", baixado: "Pagamento registrado", dataBaixa: "Pagamento", valorBaixa: "Valor pago",
    previsaoTitulo: "Previsão não é conta a pagar ainda",
    previsao: "Aqui ficam os compromissos previstos que ainda não viraram conta (ordem de compra sem nota, despesa estimada). Não entram no total a pagar, no painel nem no fluxo de caixa.",
    vazio: "Nenhuma conta a pagar lançada", eyebrowTitulo: "Conta a pagar", eyebrowPrevisao: "Previsão de pagamento",
  },
  receivable: {
    eyebrow: "FINANCEIRO · RECEITAS", titulo: "Contas a receber", parte: "cliente", Parte: "Cliente",
    descricao: "Títulos por cliente, vencimentos e recebimentos. Previsão fica separada do que já tem nota.",
    novo: "+ Novo recebível", abaAberto: "A receber", abaQuitados: "Recebidas", quitado: "Recebido", quitados: "recebidos",
    baixar: "Confirmar recebimento", baixado: "Recebimento confirmado", dataBaixa: "Recebimento", valorBaixa: "Valor recebido",
    previsaoTitulo: "Previsão não é dinheiro a receber",
    previsao: "Aqui ficam os orçamentos ainda sem nota e as duplicatas já antecipadas (empréstimo, troca de duplicata). Não entram no total a receber, no painel nem no fluxo de caixa. Um pedido pode aparecer aqui e também em A receber, nas notas já emitidas.",
    vazio: "Nenhuma conta a receber lançada", eyebrowTitulo: "Conta a receber", eyebrowPrevisao: "Previsão de recebimento",
  },
} as const;

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const moneyShort = (value: number) =>
  value >= 1_000_000 ? `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
  : value >= 10_000 ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`
  : money(value);
const date = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split("-").reverse().join("/") : "—");
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLabel = (month: string) => `${MESES[Number(month.slice(5, 7)) - 1]}/${month.slice(0, 4)}`;
const vencimento = (t: FinanceTitle) => t.installments[0]?.dueDate ?? t.issueDate;
const TONE: Record<SituacaoRecebivel, "success" | "attention" | "danger" | "info" | "neutral"> = {
  "Em aberto": "info", Vencido: "danger", Parcial: "attention", Recebido: "success", Cancelado: "neutral", "Em aprovação": "attention",
};
const EM_ABERTO: SituacaoRecebivel[] = ["Em aberto", "Vencido", "Parcial", "Em aprovação"];

function Seta({ aberto }: { aberto: boolean }) {
  return <svg className={aberto ? "aberto" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>;
}

async function chamar(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error === "FORBIDDEN" || data.error === "FINANCE_MUTATION_DENIED" ? "Sem permissão para esta alteração." : data.error || "Não foi possível concluir.";
  } catch {
    return "Sem conexão com o servidor.";
  }
}

export function FinanceTitles({ direction, titles, accounts, canCreate, canSettle, openCreate, onChanged }: {
  direction: Direction;
  /** Títulos desta direção que não estão quitados (em aberto, previsões e cancelados). */
  titles: FinanceTitle[];
  /** Contas do plano, para a edição do título. */
  accounts: FinanceChartAccount[];
  canCreate: boolean;
  /** Quem aprova: registra baixa, aprova, cancela e exclui. */
  canSettle: boolean;
  openCreate: () => void;
  /** Depois de qualquer alteração: recarrega os títulos e avisa. */
  onChanged: (message: string) => Promise<void> | void;
}) {
  const texto = TEXTO[direction];
  const today = hoje();
  const [aba, setAba] = useState<Aba>("aberto");
  const [filtro, setFiltro] = useState<Filtro>("Em aberto");
  const [grupo, setGrupo] = useState("Todos");
  const [mes, setMes] = useState("Todos");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // Quitados: um mês por vez, buscado no servidor.
  const [mesQuitados, setMesQuitados] = useState(today.slice(0, 7));
  const [quitados, setQuitados] = useState<{ chave: string; titulos: FinanceTitle[]; erro: string } | null>(null);
  const chaveQuitados = `${direction}|${mesQuitados}`;

  const buscarQuitados = useCallback(async (chave: string) => {
    const [dir, month] = chave.split("|");
    try {
      const res = await fetch(`/api/finance/titulos?direction=${dir}&mes=${month}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      setQuitados({ chave, titulos: res.ok ? body.titles ?? [] : [], erro: res.ok ? "" : "Não foi possível carregar este mês." });
    } catch {
      setQuitados({ chave, titulos: [], erro: "Sem conexão com o servidor." });
    }
  }, []);
  useEffect(() => {
    if (aba !== "quitados") return;
    let ativo = true;
    fetch(`/api/finance/titulos?direction=${direction}&mes=${mesQuitados}`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .catch(() => ({ ok: false, body: {} as { titles?: FinanceTitle[] } }))
      .then(({ ok, body }) => { if (ativo) setQuitados({ chave: `${direction}|${mesQuitados}`, titulos: ok ? body.titles ?? [] : [], erro: ok ? "" : "Não foi possível carregar este mês." }); });
    return () => { ativo = false; };
  }, [aba, direction, mesQuitados]);
  const carregandoQuitados = aba === "quitados" && quitados?.chave !== chaveQuitados;

  const reais = useMemo(() => titles.filter((t) => !t.isForecast && !t.historical), [titles]);
  const previsoes = useMemo(() => titles.filter((t) => t.isForecast && !t.historical), [titles]);
  // Títulos antigos que o sistema antigo ainda mostrava em aberto: à parte, para a equipe conferir.
  const historico = useMemo(() => titles.filter((t) => t.historical), [titles]);
  const daAba = useMemo(() => (aba === "aberto" ? reais : aba === "previsoes" ? previsoes : aba === "historico" ? historico : quitados?.chave === chaveQuitados ? quitados.titulos : []), [aba, reais, previsoes, historico, quitados, chaveQuitados]);
  const resumo = useMemo(() => resumoRecebiveis(daAba, today), [daAba, today]);
  const grupos = useMemo(() => [...new Set(daAba.map((t) => t.group ?? t.counterparty))].sort((a, b) => a.localeCompare(b, "pt-BR")), [daAba]);
  const meses = useMemo(() => [...new Set(daAba.filter((t) => EM_ABERTO.includes(situacaoRecebivel(t, today))).map((t) => vencimento(t).slice(0, 7)))].sort(), [daAba, today]);
  const emAprovacao = useMemo(() => reais.filter((t) => situacaoRecebivel(t, today) === "Em aprovação").length, [reais, today]);
  const filtros: Filtro[] = ["Em aberto", "Vencidos", "A vencer", ...(direction === "payable" ? ["Em aprovação" as Filtro] : []), "Revisar", "Cancelados"];

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return daAba.filter((t) => {
      if (aba !== "quitados") {
        const situacao = situacaoRecebivel(t, today);
        const aberto = EM_ABERTO.includes(situacao);
        const passa =
          filtro === "Em aberto" ? aberto
          : filtro === "Vencidos" ? situacao === "Vencido"
          : filtro === "A vencer" ? aberto && vencimento(t) >= today
          : filtro === "Em aprovação" ? situacao === "Em aprovação"
          : filtro === "Revisar" ? aberto && Boolean(t.reviewReason)
          : situacao === "Cancelado";
        if (!passa) return false;
        if (mes !== "Todos" && vencimento(t).slice(0, 7) !== mes) return false;
      }
      if (grupo !== "Todos" && (t.group ?? t.counterparty) !== grupo) return false;
      return !q || `${t.group ?? ""} ${t.counterparty} ${t.documentNumber ?? ""} ${t.description} ${t.chartAccount ?? ""}`.toLowerCase().includes(q);
    });
  }, [daAba, aba, filtro, grupo, mes, busca, today]);

  // Quitado não tem "em aberto": o total do grupo é o que foi pago/recebido.
  const blocos = useMemo(() => {
    const lista = agruparRecebiveis(visiveis, today);
    if (aba !== "quitados") return lista;
    return lista
      .map((bloco) => ({ ...bloco, aberto: bloco.titulos.reduce((acc, t) => acc + t.paidAmount, 0), vencido: 0, titulos: [...bloco.titulos].sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? "")) }))
      .sort((a, b) => b.aberto - a.aberto);
  }, [visiveis, today, aba]);
  const totalVisivel = blocos.reduce((acc, bloco) => acc + bloco.aberto, 0);
  // Com busca ou um grupo escolhido, tudo que sobrou aparece aberto.
  const tudoAberto = busca.trim().length > 0 || grupo !== "Todos" || blocos.length === 1;
  const alternar = (nome: string) => setAbertos((atual) => {
    const novo = new Set(atual);
    if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
    return novo;
  });
  const titulo = selecionado ? daAba.find((t) => t.id === selecionado) ?? titles.find((t) => t.id === selecionado) ?? null : null;
  const trocarAba = (nova: Aba) => { setAba(nova); setGrupo("Todos"); setMes("Todos"); setFiltro("Em aberto"); setAbertos(new Set()); };
  const alterado = async (mensagem: string) => {
    await onChanged(mensagem);
    if (aba === "quitados") await buscarQuitados(chaveQuitados);
  };
  const conta = (lista: FinanceTitle[]) => lista.filter((t) => EM_ABERTO.includes(situacaoRecebivel(t, today))).length;
  const pagoNoMes = daAba.reduce((acc, t) => acc + t.paidAmount, 0);
  const jurosNoMes = daAba.reduce((acc, t) => acc + Math.max(0, t.paidAmount - t.originalAmount), 0);

  return (
    <>
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">{texto.eyebrow}</p>
          <h1>{texto.titulo}</h1>
          <p>{texto.descricao}</p>
        </div>
        {canCreate && <Button onClick={openCreate}>{texto.novo}</Button>}
      </div>

      <div className="receber-abas">
        <Segmented<Aba>
          ariaLabel="Tipo de título"
          value={aba}
          onChange={trocarAba}
          options={[
            { value: "aberto", label: `${texto.abaAberto} · ${conta(reais)}` },
            { value: "previsoes", label: `Previsões · ${conta(previsoes)}` },
            ...(historico.length || aba === "historico" ? [{ value: "historico" as const, label: `Histórico a conferir · ${conta(historico)}` }] : []),
            { value: "quitados", label: texto.abaQuitados },
          ]}
        />
      </div>

      {aba === "previsoes" && <Callout variant="info" title={texto.previsaoTitulo}>{texto.previsao}</Callout>}
      {aba === "historico" && (
        <Callout variant="warning" title="Títulos antigos para conferir com o financeiro">
          O sistema antigo ainda mostrava estes títulos em aberto, com vencimento anterior a 2026. Muitos provavelmente já foram {texto.quitados} e nunca baixados lá. Eles não entram no total, no painel nem no fluxo de caixa. Para cada um: {texto.baixar.toLowerCase()} (com a data real), cancelar, ou Manter em aberto se a dívida existe mesmo.
        </Callout>
      )}

      {aba === "quitados" ? (
        <KpiGrid>
          <Kpi label={`${texto.quitado} em ${mesLabel(mesQuitados)}`} value={moneyShort(pagoNoMes)} caption={carregandoQuitados ? "Carregando…" : plural(daAba.length, "título", "títulos")} tone="green" />
          <Kpi label="Juros e tarifas" value={money(jurosNoMes)} caption={`${texto.quitado} acima do valor do título`} tone="amber" />
          <Kpi label={direction === "payable" ? "Fornecedores" : "Clientes"} value={String(grupos.length)} caption={`Com título ${texto.quitado.toLowerCase()} no mês`} tone="blue" />
        </KpiGrid>
      ) : (
        <KpiGrid>
          <Kpi label={aba === "aberto" ? "Em aberto" : aba === "historico" ? "A conferir" : "Previsto em aberto"} value={moneyShort(resumo.aberto)} caption={plural(resumo.quantidade, "título", "títulos")} tone={aba === "aberto" ? (direction === "payable" ? "amber" : "green") : "purple"} />
          <Kpi label={aba === "aberto" || aba === "historico" ? "Vencido" : "Com data já passada"} value={moneyShort(resumo.vencido)} caption={plural(resumo.quantidadeVencida, "título", "títulos")} tone="red" onOpen={() => setFiltro("Vencidos")} />
          <Kpi label={aba === "aberto" || aba === "historico" ? "A vencer" : "Com data futura"} value={moneyShort(resumo.aVencer)} caption={resumo.proximo ? `Próximo: ${date(resumo.proximo)}` : "Nenhum vencimento futuro"} tone="blue" onOpen={() => setFiltro("A vencer")} />
          {direction === "payable" && aba === "aberto" && emAprovacao > 0
            ? <Kpi label="Em aprovação" value={String(emAprovacao)} caption="Contas novas aguardando aprovação" tone="amber" onOpen={() => setFiltro("Em aprovação")} />
            : <Kpi label="Para revisar" value={String(resumo.revisar)} caption="Lançamentos que pedem conferência" tone="amber" onOpen={() => setFiltro("Revisar")} />}
        </KpiGrid>
      )}

      <div className="receber-toolbar">
        <label className="receber-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder={`Buscar ${texto.parte}, documento, histórico ou conta…`} aria-label="Buscar título" />
        </label>
        {aba === "quitados" ? (
          <label><span>Mês</span>
            <input type="month" value={mesQuitados} max={today.slice(0, 7)} onChange={(event) => { if (event.target.value) { setMesQuitados(event.target.value); setGrupo("Todos"); } }} aria-label="Mês da baixa" />
          </label>
        ) : (
          <>
            <label><span>Situação</span>
              <select value={filtro} onChange={(event) => setFiltro(event.target.value as Filtro)} aria-label="Situação">
                {filtros.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label><span>Vencimento</span>
              <select value={mes} onChange={(event) => setMes(event.target.value)} aria-label="Mês de vencimento">
                <option value="Todos">Todos os meses</option>
                {meses.map((item) => <option key={item} value={item}>{mesLabel(item)}</option>)}
              </select>
            </label>
          </>
        )}
        <label><span>{texto.Parte}</span>
          <select value={grupo} onChange={(event) => setGrupo(event.target.value)} aria-label={`Filtrar por ${texto.parte}`}>
            <option>Todos</option>
            {grupos.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <span className="receber-total">{plural(visiveis.length, "título", "títulos")} · <b>{money(totalVisivel)}</b></span>
      </div>

      <div className="receber-lista">
        {carregandoQuitados && <div className="finance-empty"><small>Carregando {mesLabel(mesQuitados)}…</small></div>}
        {!carregandoQuitados && aba === "quitados" && quitados?.erro && <div className="finance-empty"><b>{quitados.erro}</b></div>}
        {!carregandoQuitados && !blocos.length && !(aba === "quitados" && quitados?.erro) && (
          <div className="finance-empty">
            <b>{aba === "quitados" ? `Nenhum título ${texto.quitado.toLowerCase()} em ${mesLabel(mesQuitados)}` : titles.length ? "Nenhum título neste filtro" : texto.vazio}</b>
            <small>{aba === "quitados" ? "Escolha outro mês." : titles.length ? "Troque a situação, o mês, o nome ou a busca." : "Os títulos aparecem aqui quando forem lançados."}</small>
          </div>
        )}
        {!carregandoQuitados && blocos.map((bloco) => {
          const aberto = tudoAberto || abertos.has(bloco.nome);
          return (
            <section key={bloco.nome} className="receber-grupo">
              <button type="button" className="receber-grupo-head" onClick={() => alternar(bloco.nome)} aria-expanded={aberto}>
                <Seta aberto={aberto} />
                <span className="nome"><b>{bloco.nome}</b>{bloco.cliente && bloco.cliente !== bloco.nome && <small>{bloco.cliente}</small>}</span>
                <span className="qtd">{plural(bloco.titulos.length, "título", "títulos")}</span>
                {bloco.vencido > 0 && <Status tone="danger">{aba === "aberto" ? "Vencido" : "Data passada"} {moneyShort(bloco.vencido)}</Status>}
                <strong>{money(bloco.aberto)}</strong>
              </button>
              {aberto && (
                <div className="receber-tabela" role="table">
                  <div className="cabeca" role="row"><span>{aba === "quitados" ? texto.dataBaixa : "Vencimento"}</span><span>Histórico</span><span>Documento</span><span>Conta</span><span>{aba === "quitados" ? texto.valorBaixa : "Valor"}</span><span>Situação</span></div>
                  {bloco.titulos.map((t) => {
                    const situacao = situacaoRecebivel(t, today);
                    return (
                      <button type="button" role="row" key={t.id} onClick={() => setSelecionado(t.id)}>
                        <span className="venc">{date(aba === "quitados" ? t.paidAt : vencimento(t))}</span>
                        <span className="hist">{t.description}{t.reviewReason && <em title={t.reviewReason}>revisar</em>}</span>
                        <span className="doc">{t.documentNumber ?? "—"}</span>
                        <span className="conta">{t.allocations.length > 1 ? `${t.allocations.length} contas` : t.chartAccount ?? "—"}</span>
                        <span className="valor">{money(aba === "quitados" ? t.paidAmount : t.originalAmount)}</span>
                        <span><Status tone={TONE[situacao]}>{situacao === "Recebido" ? texto.quitado : situacao}</Status></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {titulo && <Detalhe key={titulo.id} direction={direction} titulo={titulo} hoje={today} accounts={accounts} canEdit={canCreate} canSettle={canSettle} onClose={() => setSelecionado(null)} onChanged={alterado} />}
    </>
  );
}

/* ---------------------------------------------------------------------------
   Detalhe do título: baixa, aprovação, cancelamento, edição e exclusão
   ------------------------------------------------------------------------- */

const TIPOS = ["BOL", "TRA", "DEP", "DIN", "CRE", "DEB", "CHE", "GUI", "TAR", "ENC"];

function Detalhe({ direction, titulo, hoje: today, accounts, canEdit, canSettle, onClose, onChanged }: {
  direction: Direction;
  titulo: FinanceTitle;
  hoje: string;
  accounts: FinanceChartAccount[];
  canEdit: boolean;
  canSettle: boolean;
  onClose: () => void;
  onChanged: (message: string) => Promise<void> | void;
}) {
  const texto = TEXTO[direction];
  const [modo, setModo] = useState<"ver" | "editar" | "baixar">("ver");
  const [confirmar, setConfirmar] = useState<"cancelar" | "excluir" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const situacao = situacaoRecebivel(titulo, today);
  const aberto = EM_ABERTO.includes(situacao);
  const saldo = emAberto(titulo);
  const quem = `${titulo.counterparty} · ${money(titulo.originalAmount)}`;
  const operar = async (acao: () => Promise<string | null>, mensagem: string) => {
    setOcupado(true);
    setErro("");
    const falha = await acao();
    setOcupado(false);
    if (falha) { setErro(falha); return; }
    await onChanged(mensagem);
    onClose();
  };
  const cabecalho = { title: titulo.counterparty, subtitle: titulo.group && titulo.group !== titulo.counterparty ? `Grupo ${titulo.group}` : undefined };

  if (modo === "editar") {
    return (
      <Modal {...cabecalho} eyebrow={`Editar ${texto.eyebrowTitulo.toLowerCase()}`} onClose={onClose}>
        <Edicao direction={direction} titulo={titulo} accounts={accounts} onVoltar={() => setModo("ver")} onSalvo={async () => { await onChanged(`${texto.eyebrowTitulo} alterada: ${titulo.counterparty}.`); setModo("ver"); }} />
      </Modal>
    );
  }
  if (modo === "baixar") {
    return (
      <Modal {...cabecalho} eyebrow={texto.baixar} onClose={onClose}>
        <Baixa direction={direction} titulo={titulo} saldo={saldo} hoje={today} onVoltar={() => setModo("ver")} onFeito={async (valor) => { await onChanged(`${texto.baixado}: ${titulo.counterparty} · ${money(valor)}.`); onClose(); }} />
      </Modal>
    );
  }
  return (
    <Modal {...cabecalho} eyebrow={titulo.isForecast ? texto.eyebrowPrevisao : texto.eyebrowTitulo} onClose={onClose}>
      <div className="receber-detalhe">
        {titulo.reviewReason && <Callout variant="warning" title="Conferir este lançamento">{titulo.reviewReason}.</Callout>}
        <dl>
          <div><dt>Valor</dt><dd><b>{money(titulo.originalAmount)}</b></dd></div>
          <div><dt>Situação</dt><dd><Status tone={TONE[situacao]}>{situacao === "Recebido" ? texto.quitado : situacao}</Status>{titulo.isForecast && <Status tone="purple">Previsão</Status>}{titulo.historical && <Status tone="attention">Histórico a conferir</Status>}</dd></div>
          <div><dt>Vencimento</dt><dd>{date(titulo.installments[0]?.dueDate)}</dd></div>
          <div><dt>Lançamento</dt><dd>{date(titulo.issueDate)}</dd></div>
          <div><dt>Documento</dt><dd>{titulo.documentNumber ?? "—"}{titulo.documentType ? ` · ${titulo.documentType}` : ""}</dd></div>
          {titulo.paidAmount > 0 && <div><dt>{texto.quitado}</dt><dd>{money(titulo.paidAmount)} em {date(titulo.paidAt)}{titulo.paidAmount > titulo.originalAmount && aberto === false ? ` · ${money(titulo.paidAmount - titulo.originalAmount)} de juros/tarifa` : ""}</dd></div>}
          {titulo.costCenter && <div><dt>Centro de custo</dt><dd>{titulo.costCenter}</dd></div>}
          <div className="largo"><dt>Histórico</dt><dd>{titulo.description}</dd></div>
          <div className="largo"><dt>{titulo.allocations.length > 1 ? "Rateio por conta" : "Conta do plano"}</dt>
            <dd>{titulo.allocations.length > 1
              ? <ul>{titulo.allocations.map((a) => <li key={a.code ?? a.name}><span>{a.code} {a.name}</span><b>{money(a.amount)}</b></li>)}</ul>
              : titulo.chartAccount ?? "—"}</dd></div>
          {titulo.notes && <div className="largo"><dt>Observação</dt><dd className="obs">{titulo.notes}</dd></div>}
          {titulo.source === "legado" && <div className="largo"><dt>Origem</dt><dd>Carga do sistema antigo (relatório de 30/09/2026)</dd></div>}
        </dl>
        {erro && <p className="receber-erro" role="alert">{erro}</p>}
        {confirmar ? (
          <footer>
            <p>{confirmar === "cancelar" ? "Cancelar este título? Ele sai do total em aberto e fica em Cancelados."
              : `Excluir este título? O registro é apagado de vez, com parcela, rateio${titulo.paidAmount > 0 ? " e a baixa já registrada" : ""}. Para só tirar do total, prefira Cancelar.`}</p>
            <Button type="button" variant="secondary" onClick={() => { setConfirmar(null); setErro(""); }} disabled={ocupado}>Voltar</Button>
            <Button type="button" className="perigo" disabled={ocupado} onClick={() => confirmar === "cancelar"
              ? operar(() => chamar("/api/finance", "PATCH", { type: "cancel", titleId: titulo.id }), `${texto.eyebrowTitulo} cancelada: ${quem}.`)
              : operar(() => chamar(`/api/finance/titulos/${titulo.id}`, "DELETE"), `${texto.eyebrowTitulo} excluída: ${quem}.`)}>
              {ocupado ? "Gravando…" : confirmar === "cancelar" ? "Cancelar título" : "Excluir título"}
            </Button>
          </footer>
        ) : (
          <footer>
            {canSettle && <Button type="button" variant="ghost" className="perigo-texto esquerda" onClick={() => setConfirmar("excluir")}>Excluir</Button>}
            {canEdit && <Button type="button" variant="secondary" onClick={() => setModo("editar")}>Editar</Button>}
            {canEdit && titulo.historical && aberto && <Button type="button" variant="secondary" disabled={ocupado} onClick={() => operar(() => chamar(`/api/finance/titulos/${titulo.id}`, "PATCH", { historical: false }), `Histórico conferido, volta para ${texto.abaAberto}: ${quem}.`)}>Manter em aberto</Button>}
            {canSettle && aberto && <Button type="button" variant="secondary" className="perigo-texto" onClick={() => setConfirmar("cancelar")}>Cancelar título</Button>}
            {canSettle && situacao === "Em aprovação" && <Button type="button" disabled={ocupado} onClick={() => operar(() => chamar("/api/finance", "PATCH", { type: "approve", titleId: titulo.id }), `Conta a pagar aprovada: ${quem}.`)}>Aprovar</Button>}
            {canSettle && aberto && situacao !== "Em aprovação" && <Button type="button" className="sucesso" onClick={() => setModo("baixar")}>{titulo.isForecast ? "Dar baixa" : texto.baixar}</Button>}
            {!(canSettle && aberto) && <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>}
          </footer>
        )}
      </div>
    </Modal>
  );
}

function Baixa({ direction, titulo, saldo, hoje: today, onVoltar, onFeito }: { direction: Direction; titulo: FinanceTitle; saldo: number; hoje: string; onVoltar: () => void; onFeito: (valor: number) => Promise<void> }) {
  const texto = TEXTO[direction];
  const [quando, setQuando] = useState(today);
  const [valor, setValor] = useState(saldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const numero = Number(valor.replace(/[^0-9,]/g, "").replace(",", "."));
  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quando) { setErro("Informe a data."); return; }
    if (!numero || numero <= 0) { setErro("Informe um valor maior que zero."); return; }
    setSalvando(true);
    const falha = await chamar("/api/finance", "PATCH", { type: "settle", titleId: titulo.id, date: quando, amount: numero, notes: observacao });
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    await onFeito(numero);
  };
  return (
    <form className="receber-form" onSubmit={salvar}>
      <p className="largo receber-form-info">Saldo do título: <b>{money(saldo)}</b> · vencimento {date(titulo.installments[0]?.dueDate)}</p>
      <label><span>Data *</span><input type="date" value={quando} max={today} onChange={(e) => setQuando(e.target.value)} /></label>
      <label><span>{texto.valorBaixa} (R$) *</span><input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" /></label>
      <p className="largo receber-form-info">
        {numero > saldo + 0.004 ? `${money(numero - saldo)} acima do saldo entram como juros, multa ou tarifa.`
          : numero > 0 && numero < saldo - 0.004 ? `Baixa parcial: ficam ${money(saldo - numero)} em aberto.`
          : "Quita o título."}
      </p>
      <label className="largo"><span>Observação</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" /></label>
      {erro && <p className="receber-erro largo" role="alert">{erro}</p>}
      <footer className="largo">
        <Button type="button" variant="secondary" onClick={onVoltar} disabled={salvando}>Voltar</Button>
        <Button type="submit" className="sucesso" disabled={salvando}>{salvando ? "Gravando…" : texto.baixar}</Button>
      </footer>
    </form>
  );
}

function Edicao({ direction, titulo, accounts, onVoltar, onSalvo }: { direction: Direction; titulo: FinanceTitle; accounts: FinanceChartAccount[]; onVoltar: () => void; onSalvo: () => Promise<void> }) {
  const texto = TEXTO[direction];
  const [parte, setParte] = useState(titulo.counterparty);
  const [grupo, setGrupo] = useState(titulo.group ?? "");
  const [documento, setDocumento] = useState(titulo.documentNumber ?? "");
  const [tipo, setTipo] = useState(titulo.documentType ?? "");
  const [lancamento, setLancamento] = useState(titulo.issueDate.slice(0, 10));
  const [venc, setVenc] = useState(titulo.installments[0]?.dueDate.slice(0, 10) ?? "");
  const [valor, setValor] = useState(titulo.originalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  const [conta, setConta] = useState(titulo.chartAccountId ?? "");
  const [historico, setHistorico] = useState(titulo.description);
  const [observacao, setObservacao] = useState(titulo.notes ?? "");
  const [previsao, setPrevisao] = useState(titulo.isForecast);
  const [conferido, setConferido] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const contas = accounts.filter((account) => account.allowsPosting || account.id === titulo.chartAccountId);
  // Valor e vencimento ficam travados quando há mais de uma parcela ou quando o título já tem baixa.
  const travado = titulo.installments.length > 1 || titulo.paidAmount > 0;

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    const numero = Number(valor.replace(/[^0-9,]/g, "").replace(",", "."));
    if (!parte.trim()) { setErro(`Informe o ${texto.parte}.`); return; }
    if (!historico.trim()) { setErro("Informe o histórico."); return; }
    if (!numero || numero <= 0) { setErro("Informe um valor maior que zero."); return; }
    setSalvando(true);
    const falha = await chamar(`/api/finance/titulos/${titulo.id}`, "PATCH", {
      counterparty: parte, group: grupo, documentNumber: documento, documentType: tipo, issueDate: lancamento,
      ...(travado ? {} : { dueDate: venc, amount: numero }),
      ...(conta ? { chartAccountId: conta } : {}), description: historico, notes: observacao, isForecast: previsao, reviewed: conferido,
    });
    setSalvando(false);
    if (falha) { setErro(falha); return; }
    await onSalvo();
  };

  return (
    <form className="receber-form" onSubmit={salvar}>
      <label className="largo"><span>{texto.Parte} *</span><input value={parte} onChange={(e) => setParte(e.target.value)} /></label>
      <label><span>Grupo</span><input value={grupo} onChange={(e) => setGrupo(e.target.value)} placeholder="Apelido do grupo (opcional)" /></label>
      <label><span>Documento</span><input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="NF-parcela" /></label>
      <label><span>Tipo</span><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">—</option>{[...new Set([...TIPOS, ...(tipo ? [tipo] : [])])].map((t) => <option key={t}>{t}</option>)}</select></label>
      <label><span>Valor (R$) *</span><input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" disabled={travado} /></label>
      <label><span>Lançamento</span><input type="date" value={lancamento} onChange={(e) => setLancamento(e.target.value)} /></label>
      <label><span>Vencimento</span><input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} disabled={travado} /></label>
      {travado && <p className="largo receber-form-info">{titulo.paidAmount > 0 ? "Título com baixa registrada: valor e vencimento não mudam. Para corrigir, exclua e lance de novo." : "Título com mais de uma parcela: valor e vencimento são das parcelas."}</p>}
      <label className="largo"><span>Conta do plano</span>
        <select value={conta} onChange={(e) => setConta(e.target.value)}>
          {!conta && <option value="">—</option>}
          {contas.map((account) => <option key={account.id} value={account.id}>{account.code} {account.name}</option>)}
        </select>
        {titulo.allocations.length > 1 && <small>Este título está rateado em {titulo.allocations.length} contas. Trocar a conta ou o valor deixa o título inteiro em uma conta só.</small>}
      </label>
      <label className="largo"><span>Histórico *</span><textarea rows={2} value={historico} onChange={(e) => setHistorico(e.target.value)} /></label>
      <label className="largo"><span>Observação</span><textarea rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} /></label>
      <label className="marca largo"><input type="checkbox" checked={previsao} onChange={(e) => setPrevisao(e.target.checked)} /> Previsão: fica fora do total {direction === "payable" ? "a pagar" : "a receber"}</label>
      {titulo.reviewReason && <label className="marca largo"><input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} /> Já conferi este lançamento: tirar o aviso “revisar”</label>}
      {erro && <p className="receber-erro largo" role="alert">{erro}</p>}
      <footer className="largo">
        <Button type="button" variant="secondary" onClick={onVoltar} disabled={salvando}>Voltar</Button>
        <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar alterações"}</Button>
      </footer>
    </form>
  );
}
