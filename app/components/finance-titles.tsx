"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../packages/design-system";
import type { FinanceChartAccount, FinanceTitle } from "../../lib/data/finance";
import { FinanceRevisao, useRevisaoCount } from "./finance-revisao";
import { agruparRecebiveis, emAberto, resumoRecebiveis, situacaoRecebivel, type SituacaoRecebivel } from "../../lib/finance/recebiveis-core";
import { executarLote, ORDEM_LOTE, PERMISSAO_LOTE, resumoFora, separar, type AcaoLote } from "../../lib/finance/lote-core";
import { ouvirRegistro, tomarRegistro } from "../../lib/abrir-registro";
import { definirRegistroAberto } from "../../lib/tela-atual";

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
type Aba = "aberto" | "previsoes" | "revisar" | "quitados";
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

type EstadoMarca = "todos" | "alguns" | "nenhum";

/** Caixa de marcar de um título, de um fornecedor inteiro ou de todos do filtro (com o "alguns" do meio). */
function Marca({ estado, onChange, rotulo, children }: { estado: EstadoMarca; onChange: (marcar: boolean) => void; rotulo: string; children?: React.ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = estado === "alguns"; }, [estado]);
  return (
    <label className="receber-marca" title={rotulo}>
      <input ref={ref} type="checkbox" checked={estado === "todos"} onChange={(event) => onChange(event.target.checked)} aria-label={rotulo} />
      {children}
    </label>
  );
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
  // Data específica (AAAA-MM-DD): vencimento nas abas em aberto, data da baixa em Pagas/Recebidas.
  const [dia, setDia] = useState("");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // Seleção em lote (marcar vários títulos e escolher uma ação).
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [acaoLote, setAcaoLote] = useState<AcaoLote | "">("");
  const [loteAberto, setLoteAberto] = useState(false);
  // Quitados: um mês por vez, buscado no servidor.
  const [mesQuitados, setMesQuitados] = useState(today.slice(0, 7));
  const [quitados, setQuitados] = useState<{ chave: string; titulos: FinanceTitle[]; erro: string } | null>(null);
  const chaveQuitados = `${direction}|${mesQuitados}`;

  // A SARA pediu para abrir um título exato: vai para a aba onde ele está e abre o detalhe.
  useEffect(() => {
    const aplicar = () => {
      const p = tomarRegistro((x) => x.tipo === "titulo" && x.direcao === direction);
      if (p?.tipo !== "titulo") return;
      setAba(p.aba);
      if (p.mes) setMesQuitados(p.mes);
      setSelecionado(p.id);
    };
    const t = setTimeout(aplicar, 0);
    const parar = ouvirRegistro(aplicar);
    return () => { clearTimeout(t); parar(); };
  }, [direction]);

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
  // Parcelamentos e lançamentos antigos do sistema antigo: revisados série a série (aba própria).
  const revisao = useRevisaoCount(direction === "payable");
  const daAba = useMemo(() => (aba === "aberto" ? reais : aba === "previsoes" ? previsoes : aba === "quitados" && quitados?.chave === chaveQuitados ? quitados.titulos : []), [aba, reais, previsoes, quitados, chaveQuitados]);
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
        if (dia && vencimento(t) !== dia) return false;
      } else if (dia && (t.paidAt ?? "").slice(0, 10) !== dia) return false;
      if (grupo !== "Todos" && (t.group ?? t.counterparty) !== grupo) return false;
      return !q || `${t.group ?? ""} ${t.counterparty} ${t.documentNumber ?? ""} ${t.description} ${t.chartAccount ?? ""}`.toLowerCase().includes(q);
    });
  }, [daAba, aba, filtro, grupo, mes, dia, busca, today]);

  // Quitado não tem "em aberto": o total do grupo é o que foi pago/recebido.
  const blocos = useMemo(() => {
    const lista = agruparRecebiveis(visiveis, today);
    if (aba !== "quitados") return lista;
    return lista
      .map((bloco) => ({ ...bloco, aberto: bloco.titulos.reduce((acc, t) => acc + t.paidAmount, 0), vencido: 0, titulos: [...bloco.titulos].sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? "")) }))
      .sort((a, b) => b.aberto - a.aberto);
  }, [visiveis, today, aba]);
  const totalVisivel = blocos.reduce((acc, bloco) => acc + bloco.aberto, 0);
  const podeLote = (aba === "aberto" || aba === "previsoes") && (canCreate || canSettle);
  const acoesLote = ORDEM_LOTE.filter((a) => (PERMISSAO_LOTE[a] === "aprovar" ? canSettle : canCreate));
  // Só o que está à vista entra no lote: título escondido pelo filtro nunca é alterado.
  const escolhidos = useMemo(() => (podeLote ? visiveis.filter((t) => marcados.has(t.id)) : []), [podeLote, visiveis, marcados]);
  const estadoDe = (ids: string[]): EstadoMarca => {
    const n = ids.filter((id) => marcados.has(id)).length;
    return n === 0 ? "nenhum" : n === ids.length ? "todos" : "alguns";
  };
  const marcar = (ids: string[], sim: boolean) => setMarcados((atual) => {
    const novo = new Set(atual);
    for (const id of ids) { if (sim) novo.add(id); else novo.delete(id); }
    return novo;
  });
  // Com busca ou um grupo escolhido, tudo que sobrou aparece aberto.
  const tudoAberto = busca.trim().length > 0 || grupo !== "Todos" || blocos.length === 1;
  const alternar = (nome: string) => setAbertos((atual) => {
    const novo = new Set(atual);
    if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
    return novo;
  });
  useEffect(() => { definirRegistroAberto(selecionado ? { tipo: "titulo", id: selecionado } : null); return () => definirRegistroAberto(null); }, [selecionado]);
  const titulo = selecionado ? daAba.find((t) => t.id === selecionado) ?? titles.find((t) => t.id === selecionado) ?? null : null;
  const trocarAba = (nova: Aba) => { setAba(nova); setGrupo("Todos"); setMes("Todos"); setDia(""); setFiltro("Em aberto"); setAbertos(new Set()); setMarcados(new Set()); setAcaoLote(""); };
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
            ...(direction === "payable" && (revisao.total || aba === "revisar") ? [{ value: "revisar" as const, label: `Histórico a revisar · ${revisao.total ?? "…"}` }] : []),
            { value: "quitados", label: texto.abaQuitados },
          ]}
        />
      </div>

      {aba === "previsoes" && <Callout variant="info" title={texto.previsaoTitulo}>{texto.previsao}</Callout>}
      {aba === "revisar" ? (
        <FinanceRevisao accounts={accounts} onChanged={async (mensagem) => { await onChanged(mensagem); await revisao.recarregar(); }} />
      ) : (<>
      {aba === "quitados" ? (
        <KpiGrid>
          <Kpi label={`${texto.quitado} em ${mesLabel(mesQuitados)}`} value={moneyShort(pagoNoMes)} caption={carregandoQuitados ? "Carregando…" : plural(daAba.length, "título", "títulos")} tone="green" />
          <Kpi label="Juros e tarifas" value={money(jurosNoMes)} caption={`${texto.quitado} acima do valor do título`} tone="amber" />
          <Kpi label={direction === "payable" ? "Fornecedores" : "Clientes"} value={String(grupos.length)} caption={`Com título ${texto.quitado.toLowerCase()} no mês`} tone="blue" />
        </KpiGrid>
      ) : (
        <KpiGrid>
          <Kpi label={aba === "aberto" ? "Em aberto" : "Previsto em aberto"} value={moneyShort(resumo.aberto)} caption={plural(resumo.quantidade, "título", "títulos")} tone={aba === "aberto" ? (direction === "payable" ? "amber" : "green") : "purple"} />
          <Kpi label={aba === "aberto" ? "Vencido" : "Com data já passada"} value={moneyShort(resumo.vencido)} caption={plural(resumo.quantidadeVencida, "título", "títulos")} tone="red" onOpen={() => setFiltro("Vencidos")} />
          <Kpi label={aba === "aberto" ? "A vencer" : "Com data futura"} value={moneyShort(resumo.aVencer)} caption={resumo.proximo ? `Próximo: ${date(resumo.proximo)}` : "Nenhum vencimento futuro"} tone="blue" onOpen={() => setFiltro("A vencer")} />
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
            <input type="month" value={mesQuitados} max={today.slice(0, 7)} onChange={(event) => { if (event.target.value) { setMesQuitados(event.target.value); setGrupo("Todos"); setDia(""); } }} aria-label="Mês da baixa" />
          </label>
        ) : (
          <>
            <label><span>Situação</span>
              <select value={filtro} onChange={(event) => setFiltro(event.target.value as Filtro)} aria-label="Situação">
                {filtros.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label><span>Vencimento</span>
              <select value={mes} onChange={(event) => { setMes(event.target.value); setDia(""); }} aria-label="Mês de vencimento">
                <option value="Todos">Todos os meses</option>
                {meses.map((item) => <option key={item} value={item}>{mesLabel(item)}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="receber-dia"><span>{aba === "quitados" ? `Data ${texto.dataBaixa === "Pagamento" ? "do pagamento" : "do recebimento"}` : "Data de vencimento"}</span>
          <div className="receber-dia-campo">
            <input type="date" value={dia} max={aba === "quitados" ? today : undefined} onChange={(event) => {
              const valor = event.target.value;
              setDia(valor);
              if (!valor) return;
              if (aba === "quitados") { if (valor.slice(0, 7) !== mesQuitados) setMesQuitados(valor.slice(0, 7)); }
              else setMes("Todos");
            }} aria-label={aba === "quitados" ? "Data da baixa" : "Data de vencimento"} />
            {dia && <button type="button" onClick={() => setDia("")} aria-label="Limpar data" title="Limpar data">×</button>}
          </div>
        </label>
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
        {!carregandoQuitados && podeLote && blocos.length > 0 && (
          <div className={`receber-lote${escolhidos.length ? " ativo" : ""}`} role="region" aria-label="Seleção em lote">
            <Marca estado={estadoDe(visiveis.map((t) => t.id))} onChange={(sim) => marcar(visiveis.map((t) => t.id), sim)} rotulo={`Selecionar todos os ${visiveis.length} títulos do filtro`}>
              Selecionar todos ({visiveis.length})
            </Marca>
            {escolhidos.length > 0 ? (
              <>
                <span className="receber-lote-qtd"><b>{plural(escolhidos.length, "selecionado", "selecionados")}</b> · {money(escolhidos.reduce((acc, t) => acc + emAberto(t), 0))} em aberto</span>
                <span className="receber-lote-acoes">
                  <select value={acaoLote} onChange={(event) => setAcaoLote(event.target.value as AcaoLote | "")} aria-label="Ação para os selecionados">
                    <option value="">Escolha a ação…</option>
                    {acoesLote.map((a) => {
                      const n = separar(a, escolhidos, today).entram.length;
                      return <option key={a} value={a} disabled={!n}>{rotuloLote(a, direction)} ({n})</option>;
                    })}
                  </select>
                  <Button compact disabled={!acaoLote || !separar(acaoLote, escolhidos, today).entram.length} onClick={() => setLoteAberto(true)}>Continuar</Button>
                  <Button compact variant="ghost" onClick={() => { setMarcados(new Set()); setAcaoLote(""); }}>Limpar seleção</Button>
                </span>
              </>
            ) : (
              <span>Marque os títulos, ou um {texto.parte} inteiro, para executar uma ação em todos de uma vez.</span>
            )}
          </div>
        )}
        {!carregandoQuitados && blocos.map((bloco) => {
          const aberto = tudoAberto || abertos.has(bloco.nome);
          const ids = bloco.titulos.map((t) => t.id);
          return (
            <section key={bloco.nome} className="receber-grupo">
              <div className="receber-grupo-topo">
                {podeLote && <Marca estado={estadoDe(ids)} onChange={(sim) => marcar(ids, sim)} rotulo={`Selecionar os títulos de ${bloco.nome}`} />}
                <button type="button" className="receber-grupo-head" onClick={() => alternar(bloco.nome)} aria-expanded={aberto}>
                  <Seta aberto={aberto} />
                  <span className="nome"><b>{bloco.nome}</b>{bloco.cliente && bloco.cliente !== bloco.nome && <small>{bloco.cliente}</small>}</span>
                  <span className="qtd">{plural(bloco.titulos.length, "título", "títulos")}</span>
                  {bloco.vencido > 0 && <Status tone="danger">{aba === "aberto" ? "Vencido" : "Data passada"} {moneyShort(bloco.vencido)}</Status>}
                  <strong>{money(bloco.aberto)}</strong>
                </button>
              </div>
              {aberto && (
                <div className={`receber-tabela${podeLote ? " com-marca" : ""}`} role="table">
                  <div className="cabeca" role="row">{podeLote && <span aria-hidden />}<span className="venc">{aba === "quitados" ? texto.dataBaixa : "Vencimento"}</span><span>Histórico</span><span className="doc">Documento</span><span>Conta</span><span className="r">{aba === "quitados" ? texto.valorBaixa : "Valor"}</span><span>Situação</span></div>
                  {bloco.titulos.map((t) => {
                    const situacao = situacaoRecebivel(t, today);
                    const marcado = podeLote && marcados.has(t.id);
                    return (
                      <div role="row" key={t.id} className={`linha${marcado ? " marcada" : ""}`}>
                        {podeLote && <Marca estado={marcado ? "todos" : "nenhum"} onChange={(sim) => marcar([t.id], sim)} rotulo={`Selecionar ${t.description}`} />}
                        <button type="button" onClick={() => setSelecionado(t.id)}>
                          <span className="venc">{date(aba === "quitados" ? t.paidAt : vencimento(t))}</span>
                          <span className="hist">{t.description}{t.reviewReason && <em title={t.reviewReason}>revisar</em>}</span>
                          <span className="doc">{t.documentNumber ?? "—"}</span>
                          <span className="conta">{t.allocations.length > 1 ? `${t.allocations.length} contas` : t.chartAccount ?? "—"}</span>
                          <span className="valor">{money(aba === "quitados" ? t.paidAmount : t.originalAmount)}</span>
                          <span><Status tone={TONE[situacao]}>{situacao === "Recebido" ? texto.quitado : situacao}</Status></span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      </>)}

      {titulo && <Detalhe key={titulo.id} direction={direction} titulo={titulo} hoje={today} accounts={accounts} canEdit={canCreate} canSettle={canSettle} onClose={() => setSelecionado(null)} onChanged={alterado} />}
      {loteAberto && acaoLote && (
        <Lote
          direction={direction}
          acao={acaoLote}
          titulos={escolhidos}
          hoje={today}
          accounts={accounts}
          onClose={() => setLoteAberto(false)}
          onFeito={async (mensagem, falharam) => {
            // Os que falharam continuam marcados, para tentar de novo; os outros saem da seleção.
            setMarcados(new Set(falharam));
            if (!falharam.length) setAcaoLote("");
            await alterado(mensagem);
          }}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
   Ação em lote: a mesma ação de cada título, em todos os marcados
   ------------------------------------------------------------------------- */

function rotuloLote(acao: AcaoLote, direction: Direction): string {
  return {
    baixar: TEXTO[direction].baixar, aprovar: "Aprovar", conta: "Trocar a conta do plano", vencimento: "Mudar o vencimento",
    conferido: "Marcar como conferido", cancelar: "Cancelar títulos", excluir: "Excluir títulos",
  }[acao];
}

const centavos = (valor: number) => Math.round(valor * 100) / 100;

function Lote({ direction, acao, titulos, hoje: today, accounts, onClose, onFeito }: {
  direction: Direction;
  acao: AcaoLote;
  titulos: FinanceTitle[];
  hoje: string;
  accounts: FinanceChartAccount[];
  onClose: () => void;
  onFeito: (mensagem: string, falharam: string[]) => Promise<void>;
}) {
  const texto = TEXTO[direction];
  // A separação fica congelada ao abrir: a lista recarrega depois de gravar e não pode mudar o lote no meio.
  const [{ entram, fora }] = useState(() => separar(acao, titulos, today));
  const [quando, setQuando] = useState(today);
  const [observacao, setObservacao] = useState("");
  const [conta, setConta] = useState("");
  const [venc, setVenc] = useState("");
  const [ciente, setCiente] = useState(false);
  const [feitos, setFeitos] = useState<number | null>(null);
  const [falhas, setFalhas] = useState<{ titulo: FinanceTitle; erro: string }[] | null>(null);
  const [erro, setErro] = useState("");
  const rodando = feitos !== null && falhas === null;
  const valor = (t: FinanceTitle) => (acao === "baixar" ? emAberto(t) : t.originalAmount);
  const total = entram.reduce((acc, t) => acc + valor(t), 0);
  const rotulo = rotuloLote(acao, direction);
  const contas = accounts.filter((a) => a.allowsPosting);
  const rateados = acao === "conta" ? entram.filter((t) => t.allocations.length > 1).length : 0;
  const comBaixa = acao === "excluir" ? entram.filter((t) => t.paidAmount > 0).length : 0;

  const uma = (t: FinanceTitle): Promise<string | null> => {
    switch (acao) {
      case "baixar": return chamar("/api/finance", "PATCH", { type: "settle", titleId: t.id, date: quando, amount: centavos(emAberto(t)), notes: observacao });
      case "aprovar": return chamar("/api/finance", "PATCH", { type: "approve", titleId: t.id });
      case "cancelar": return chamar("/api/finance", "PATCH", { type: "cancel", titleId: t.id });
      case "excluir": return chamar(`/api/finance/titulos/${t.id}`, "DELETE");
      case "conta": return chamar(`/api/finance/titulos/${t.id}`, "PATCH", { chartAccountId: conta });
      case "vencimento": return chamar(`/api/finance/titulos/${t.id}`, "PATCH", { dueDate: venc });
      case "conferido": return chamar(`/api/finance/titulos/${t.id}`, "PATCH", { reviewed: true });
    }
  };

  const executar = async () => {
    if (acao === "baixar" && !quando) { setErro("Informe a data."); return; }
    if (acao === "conta" && !conta) { setErro("Escolha a conta do plano."); return; }
    if (acao === "vencimento" && !venc) { setErro("Informe o novo vencimento."); return; }
    setErro("");
    setFeitos(0);
    const resultado = await executarLote(entram, uma, setFeitos);
    setFalhas(resultado);
    const certos = entram.length - resultado.length;
    const feito = {
      baixar: texto.baixado, aprovar: "Aprovação registrada", conta: "Conta do plano trocada", vencimento: "Vencimento alterado",
      conferido: "Marcados como conferidos", cancelar: "Títulos cancelados", excluir: "Títulos excluídos",
    }[acao];
    const mensagem = certos
      ? `${feito}: ${plural(certos, "título", "títulos")}${resultado.length ? `; ${plural(resultado.length, "falhou", "falharam")}` : ""}.`
      : `Nenhum título alterado: ${plural(resultado.length, "falhou", "falharam")}.`;
    await onFeito(mensagem, resultado.map((f) => f.titulo.id));
    if (!resultado.length) onClose();
  };

  const linhaTitulo = (t: FinanceTitle) => `${t.counterparty} · ${t.documentNumber ?? t.description} · ${money(valor(t))}`;

  return (
    <Modal title={rotulo} subtitle={`${plural(entram.length, "título", "títulos")} · ${money(total)}`} eyebrow="Ação em lote" onClose={rodando ? () => undefined : onClose}>
      <div className="receber-lote-form">
        {falhas ? (
          <>
            <p>{entram.length - falhas.length > 0 ? `${plural(entram.length - falhas.length, "título gravado", "títulos gravados")}.` : "Nenhum título gravado."} {plural(falhas.length, "título não foi alterado", "títulos não foram alterados")} e continuam marcados:</p>
            <ul className="receber-lote-falhas">
              {falhas.map((f) => <li key={f.titulo.id}><span>{linhaTitulo(f.titulo)}</span><small>{f.erro}</small></li>)}
            </ul>
            <footer><Button type="button" onClick={onClose}>Fechar</Button></footer>
          </>
        ) : (
          <>
            {fora.length > 0 && <p className="fora">Ficam fora {plural(fora.length, "título marcado", "títulos marcados")}: {resumoFora(fora)}. {fora.length === 1 ? "Ele não muda" : "Eles não mudam"}.</p>}

            {acao === "baixar" && (
              <>
                <p>Cada título é quitado pelo saldo em aberto, na mesma data. Para pagar valor diferente (parcial ou com juros), faça a baixa no título.</p>
                <label><span>Data do {direction === "payable" ? "pagamento" : "recebimento"} *</span><input type="date" value={quando} max={today} onChange={(e) => setQuando(e.target.value)} /></label>
                <label><span>Observação</span><input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional, vai em todas as baixas" /></label>
              </>
            )}
            {acao === "aprovar" && <p>Registra a sua aprovação em cada título. Quem tem mais de um nível na alçada segue esperando o próximo nível.</p>}
            {acao === "conta" && (
              <>
                <label><span>Nova conta do plano *</span>
                  <select value={conta} onChange={(e) => setConta(e.target.value)}>
                    <option value="">Escolha a conta…</option>
                    {contas.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                  </select>
                </label>
                {rateados > 0 && <p className="fora">{plural(rateados, "título está rateado", "títulos estão rateados")} em mais de uma conta: {rateados === 1 ? "ele passa" : "eles passam"} a ficar inteiro{rateados === 1 ? "" : "s"} na conta escolhida.</p>}
              </>
            )}
            {acao === "vencimento" && <label><span>Novo vencimento *</span><input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} /></label>}
            {acao === "conferido" && <p>Tira o aviso “revisar” dos títulos. Valor, conta e vencimento não mudam.</p>}
            {acao === "cancelar" && <p>Os títulos saem do total em aberto e ficam em Cancelados.</p>}
            {acao === "excluir" && (
              <>
                <p>Os títulos são apagados de vez, com parcelas e rateio{comBaixa ? `, e ${plural(comBaixa, "deles tem baixa registrada, que também é apagada", "deles têm baixa registrada, que também é apagada")}` : ""}. Para só tirar do total, prefira Cancelar títulos.</p>
                <label className="marca"><input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} /> Entendi: excluir {plural(entram.length, "título", "títulos")} de vez</label>
              </>
            )}

            {erro && <p className="receber-erro" role="alert">{erro}</p>}
            <footer>
              <Button type="button" variant="secondary" onClick={onClose} disabled={rodando}>Voltar</Button>
              <Button
                type="button"
                className={acao === "baixar" ? "sucesso" : acao === "excluir" || acao === "cancelar" ? "perigo" : undefined}
                disabled={rodando || (acao === "excluir" && !ciente)}
                onClick={() => void executar()}
              >
                {rodando ? `Gravando ${feitos} de ${entram.length}…` : `${rotulo} (${entram.length})`}
              </Button>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
   Detalhe do título: baixa, aprovação, cancelamento, edição e exclusão
   ------------------------------------------------------------------------- */

const TIPOS = ["BOL", "TRA", "DEP", "DIN", "CRE", "DEB", "CHE", "GUI", "TAR", "ENC"];

type Historico = {
  aprovacao: {
    niveis: { nivel: number; regra: string; quem: string; aprovadoPor: string | null; aprovadoEm: string | null }[];
    recusas: { nivel: number; por: string | null; em: string | null; motivo: string | null }[];
    aprovadoPor: string | null;
    aprovadoEm: string | null;
  };
  baixas: { id: string; data: string; valor: number; juros: number; observacao: string | null; por: string | null; estornadaEm: string | null; estornadaPor: string | null; motivoEstorno: string | null; conciliada: boolean }[];
};
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

/** Alçada (níveis e quem decidiu) e baixas do título, inclusive as estornadas. */
function HistoricoTitulo({ hist, canSettle, onEstornar }: { hist: Historico; canSettle: boolean; onEstornar: (b: Historico["baixas"][number]) => void }) {
  const { niveis, recusas } = hist.aprovacao;
  return (
    <>
      {niveis.length > 0 && (
        <section className="fin-historico" aria-label="Aprovação por alçada">
          <h3>Aprovação por alçada</h3>
          <ol>
            {niveis.map((n) => (
              <li key={n.nivel}>
                <span className="fin-historico-marca">{n.aprovadoPor ? "✓" : n.nivel}</span>
                <span><b>Nível {n.nivel} · {n.regra}</b><small>{n.aprovadoPor ? `Aprovado por ${n.aprovadoPor} em ${dataHora(n.aprovadoEm)}` : `Aguardando: ${n.quem}`}</small></span>
                <Status tone={n.aprovadoPor ? "success" : "attention"}>{n.aprovadoPor ? "Aprovado" : "Pendente"}</Status>
              </li>
            ))}
          </ol>
          {recusas.map((r, i) => <p key={i} className="fin-historico-recusa">Recusado no nível {r.nivel} por {r.por} em {dataHora(r.em)}: {r.motivo}</p>)}
        </section>
      )}
      {hist.baixas.length > 0 && (
        <section className="fin-historico" aria-label="Baixas">
          <h3>Baixas</h3>
          <ol>
            {hist.baixas.map((b) => (
              <li key={b.id} className={b.estornadaEm ? "estornada" : undefined}>
                <span className="fin-historico-marca">{b.estornadaEm ? "↺" : "$"}</span>
                <span>
                  <b>{money(b.valor)}</b> em {date(b.data)}{b.por ? ` · ${b.por}` : ""}{b.observacao ? ` · ${b.observacao}` : ""}
                  {b.estornadaEm && <small>Estornada por {b.estornadaPor} em {dataHora(b.estornadaEm)}: {b.motivoEstorno}</small>}
                  {!b.estornadaEm && b.conciliada && <small>Conciliada com o extrato: para estornar, desfaça a conciliação em Bancos e conciliação.</small>}
                </span>
                {b.estornadaEm
                  ? <Status tone="neutral">Estornada</Status>
                  : canSettle && !b.conciliada
                    ? <Button type="button" variant="secondary" compact className="perigo-texto" onClick={() => onEstornar(b)}>Estornar</Button>
                    : <Status tone="success">Ativa</Status>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

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
  const [motivoDe, setMotivoDe] = useState<{ tipo: "recusar" } | { tipo: "estornar"; id: string; valor: number } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [hist, setHist] = useState<Historico | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    fetch(`/api/finance/titulos/${titulo.id}/historico`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setHist(d as Historico); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [titulo.id]);
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
        {hist && <HistoricoTitulo hist={hist} canSettle={canSettle} onEstornar={(b) => { setMotivo(""); setErro(""); setMotivoDe({ tipo: "estornar", id: b.id, valor: b.valor }); }} />}
        {erro && <p className="receber-erro" role="alert">{erro}</p>}
        {motivoDe ? (
          <footer>
            <p>{motivoDe.tipo === "recusar"
              ? "Recusar a aprovação deste título? Quem lançou é avisado com o motivo; o título continua em aprovação até ser corrigido ou cancelado."
              : `Estornar a baixa de ${money(motivoDe.valor)}? Ela fica guardada como estornada e o valor volta a ficar em aberto. O valor original do título não muda.`}</p>
            <label className="fin-motivo"><span>Motivo *</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} autoFocus placeholder={motivoDe.tipo === "recusar" ? "Ex.: valor diferente do pedido" : "Ex.: pagamento em duplicidade"} /></label>
            <Button type="button" variant="secondary" onClick={() => { setMotivoDe(null); setErro(""); }} disabled={ocupado}>Voltar</Button>
            <Button type="button" className="perigo" disabled={ocupado || !motivo.trim()} onClick={() => motivoDe.tipo === "recusar"
              ? operar(() => chamar("/api/finance", "PATCH", { type: "reject", titleId: titulo.id, reason: motivo.trim() }), `Aprovação recusada: ${quem}.`)
              : operar(() => chamar("/api/finance", "PATCH", { type: "reverse", settlementId: motivoDe.id, reason: motivo.trim() }), `Baixa estornada: ${titulo.counterparty} · ${money(motivoDe.valor)}.`)}>
              {ocupado ? "Gravando…" : motivoDe.tipo === "recusar" ? "Recusar" : "Estornar baixa"}
            </Button>
          </footer>
        ) : confirmar ? (
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
            {canSettle && situacao === "Em aprovação" && (hist?.aprovacao.niveis.length ?? 0) > 0 && <Button type="button" variant="secondary" className="perigo-texto" disabled={ocupado} onClick={() => { setMotivo(""); setErro(""); setMotivoDe({ tipo: "recusar" }); }}>Recusar</Button>}
            {canSettle && situacao === "Em aprovação" && <Button type="button" disabled={ocupado} onClick={() => operar(() => chamar("/api/finance", "PATCH", { type: "approve", titleId: titulo.id }), (hist?.aprovacao.niveis.filter((n) => !n.aprovadoPor).length ?? 0) > 1 ? `Nível aprovado; falta o próximo nível: ${quem}.` : `${texto.eyebrowTitulo} aprovada: ${quem}.`)}>Aprovar</Button>}
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
