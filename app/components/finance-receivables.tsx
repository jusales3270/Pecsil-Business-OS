"use client";

import { useMemo, useState } from "react";
import { Button, Callout, Kpi, KpiGrid, Modal, Segmented, Status } from "../../packages/design-system";
import type { FinanceTitle } from "../../lib/data/finance";
import { agruparRecebiveis, resumoRecebiveis, situacaoRecebivel, type SituacaoRecebivel } from "../../lib/finance/recebiveis-core";

/**
 * Contas a receber do Financeiro.
 *
 * Duas listas que nunca se somam: "A receber" (nota emitida) e "Previsões"
 * (orçamento sem nota ou duplicata já antecipada). Agrupado pelo grupo do
 * cliente, como no relatório que a equipe usa.
 */

type Aba = "A receber" | "Previsões";
type Filtro = "Em aberto" | "Vencidos" | "A vencer" | "Revisar" | "Recebidos" | "Cancelados";
const FILTROS: Filtro[] = ["Em aberto", "Vencidos", "A vencer", "Revisar", "Recebidos", "Cancelados"];

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const moneyShort = (value: number) =>
  value >= 1_000_000 ? `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
  : value >= 10_000 ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`
  : money(value);
const date = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split("-").reverse().join("/") : "—");
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const TONE: Record<SituacaoRecebivel, "success" | "attention" | "danger" | "info" | "neutral"> = {
  "Em aberto": "info", Vencido: "danger", Parcial: "attention", Recebido: "success", Cancelado: "neutral",
};

function Seta({ aberto }: { aberto: boolean }) {
  return <svg className={aberto ? "aberto" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>;
}

export function FinanceReceivables({ titles, canCreate, canSettle, openCreate, onReceive, onCancel }: {
  titles: FinanceTitle[];
  canCreate: boolean;
  canSettle: boolean;
  openCreate: () => void;
  onReceive: (id: string) => Promise<void> | void;
  onCancel: (id: string) => Promise<void> | void;
}) {
  const [aba, setAba] = useState<Aba>("A receber");
  const [filtro, setFiltro] = useState<Filtro>("Em aberto");
  const [grupo, setGrupo] = useState("Todos");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const today = hoje();

  const reais = useMemo(() => titles.filter((t) => !t.isForecast), [titles]);
  const previsoes = useMemo(() => titles.filter((t) => t.isForecast), [titles]);
  const daAba = aba === "A receber" ? reais : previsoes;
  const resumo = useMemo(() => resumoRecebiveis(daAba, today), [daAba, today]);
  const grupos = useMemo(() => [...new Set(daAba.map((t) => t.group ?? t.counterparty))].sort((a, b) => a.localeCompare(b, "pt-BR")), [daAba]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return daAba.filter((t) => {
      const situacao = situacaoRecebivel(t, today);
      const aberto = situacao === "Em aberto" || situacao === "Vencido" || situacao === "Parcial";
      const passa =
        filtro === "Em aberto" ? aberto
        : filtro === "Vencidos" ? situacao === "Vencido"
        : filtro === "A vencer" ? situacao === "Em aberto" || (situacao === "Parcial" && (t.installments[0]?.dueDate ?? "") >= today)
        : filtro === "Revisar" ? aberto && Boolean(t.reviewReason)
        : filtro === "Recebidos" ? situacao === "Recebido"
        : situacao === "Cancelado";
      if (!passa) return false;
      if (grupo !== "Todos" && (t.group ?? t.counterparty) !== grupo) return false;
      return !q || `${t.group ?? ""} ${t.counterparty} ${t.documentNumber ?? ""} ${t.description} ${t.chartAccount ?? ""}`.toLowerCase().includes(q);
    });
  }, [daAba, filtro, grupo, busca, today]);

  const blocos = useMemo(() => agruparRecebiveis(visiveis, today), [visiveis, today]);
  const totalVisivel = blocos.reduce((acc, bloco) => acc + bloco.aberto, 0);
  // Com busca ou um grupo escolhido, tudo que sobrou aparece aberto.
  const tudoAberto = busca.trim().length > 0 || grupo !== "Todos" || blocos.length === 1;
  const alternar = (nome: string) => setAbertos((atual) => {
    const novo = new Set(atual);
    if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
    return novo;
  });
  const titulo = selecionado ? titles.find((t) => t.id === selecionado) ?? null : null;
  const trocarAba = (nova: Aba) => { setAba(nova); setGrupo("Todos"); setAbertos(new Set()); };

  return (
    <>
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">FINANCEIRO · RECEITAS</p>
          <h1>Contas a receber</h1>
          <p>Títulos por cliente, vencimentos e recebimentos. Previsão fica separada do que já tem nota.</p>
        </div>
        {canCreate && <Button onClick={openCreate}>+ Novo recebível</Button>}
      </div>

      <div className="receber-abas">
        <Segmented<Aba>
          ariaLabel="Tipo de título"
          value={aba}
          onChange={trocarAba}
          options={[{ value: "A receber", label: `A receber · ${reais.filter((t) => ["Em aberto", "Vencido", "Parcial"].includes(situacaoRecebivel(t, today))).length}` }, { value: "Previsões", label: `Previsões · ${previsoes.filter((t) => ["Em aberto", "Vencido", "Parcial"].includes(situacaoRecebivel(t, today))).length}` }]}
        />
      </div>

      {aba === "Previsões" && (
        <Callout variant="info" title="Previsão não é dinheiro a receber">
          Aqui ficam os orçamentos ainda sem nota e as duplicatas já antecipadas (empréstimo, troca de duplicata). Não entram no total a receber, no painel nem no fluxo de caixa. Um pedido pode aparecer aqui e também em A receber, nas notas já emitidas.
        </Callout>
      )}

      <KpiGrid>
        <Kpi label={aba === "A receber" ? "Em aberto" : "Previsto em aberto"} value={moneyShort(resumo.aberto)} caption={plural(resumo.quantidade, "título", "títulos")} tone={aba === "A receber" ? "green" : "purple"} />
        <Kpi label={aba === "A receber" ? "Vencido" : "Com data já passada"} value={moneyShort(resumo.vencido)} caption={plural(resumo.quantidadeVencida, "título", "títulos")} tone="red" onOpen={() => setFiltro("Vencidos")} />
        <Kpi label={aba === "A receber" ? "A vencer" : "Com data futura"} value={moneyShort(resumo.aVencer)} caption={resumo.proximo ? `Próximo: ${date(resumo.proximo)}` : "Nenhum vencimento futuro"} tone="blue" onOpen={() => setFiltro("A vencer")} />
        <Kpi label="Para revisar" value={String(resumo.revisar)} caption="Lançamentos que pedem conferência" tone="amber" onOpen={() => setFiltro("Revisar")} />
      </KpiGrid>

      <div className="receber-toolbar">
        <label className="receber-busca">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
          <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar cliente, documento, histórico ou conta…" aria-label="Buscar título" />
        </label>
        <label><span>Situação</span>
          <select value={filtro} onChange={(event) => setFiltro(event.target.value as Filtro)} aria-label="Situação">
            {FILTROS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label><span>Grupo</span>
          <select value={grupo} onChange={(event) => setGrupo(event.target.value)} aria-label="Grupo de cliente">
            <option>Todos</option>
            {grupos.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <span className="receber-total">{plural(visiveis.length, "título", "títulos")} · <b>{money(totalVisivel)}</b></span>
      </div>

      <div className="receber-lista">
        {!blocos.length && (
          <div className="finance-empty">
            <b>{titles.length ? "Nenhum título neste filtro" : "Nenhuma conta a receber lançada"}</b>
            <small>{titles.length ? "Troque a situação, o grupo ou a busca." : "Os títulos aparecem aqui quando forem lançados."}</small>
          </div>
        )}
        {blocos.map((bloco) => {
          const aberto = tudoAberto || abertos.has(bloco.nome);
          return (
            <section key={bloco.nome} className="receber-grupo">
              <button type="button" className="receber-grupo-head" onClick={() => alternar(bloco.nome)} aria-expanded={aberto}>
                <Seta aberto={aberto} />
                <span className="nome"><b>{bloco.nome}</b>{bloco.cliente && bloco.cliente !== bloco.nome && <small>{bloco.cliente}</small>}</span>
                <span className="qtd">{plural(bloco.titulos.length, "título", "títulos")}</span>
                {bloco.vencido > 0 && <Status tone="danger">{aba === "A receber" ? "Vencido" : "Data passada"} {moneyShort(bloco.vencido)}</Status>}
                <strong>{money(bloco.aberto)}</strong>
              </button>
              {aberto && (
                <div className="receber-tabela" role="table">
                  <div className="cabeca" role="row"><span>Vencimento</span><span>Histórico</span><span>Documento</span><span>Conta</span><span>Valor</span><span>Situação</span></div>
                  {bloco.titulos.map((t) => {
                    const situacao = situacaoRecebivel(t, today);
                    return (
                      <button type="button" role="row" key={t.id} onClick={() => setSelecionado(t.id)}>
                        <span className="venc">{date(t.installments[0]?.dueDate ?? t.issueDate)}</span>
                        <span className="hist">{t.description}{t.reviewReason && <em title={t.reviewReason}>revisar</em>}</span>
                        <span className="doc">{t.documentNumber ?? "—"}</span>
                        <span className="conta">{t.allocations.length > 1 ? `${t.allocations.length} contas` : t.chartAccount ?? "—"}</span>
                        <span className="valor">{money(t.originalAmount)}</span>
                        <span><Status tone={TONE[situacao]}>{situacao}</Status></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {titulo && <Detalhe titulo={titulo} hoje={today} canSettle={canSettle} onClose={() => setSelecionado(null)} onReceive={onReceive} onCancel={onCancel} />}
    </>
  );
}

function Detalhe({ titulo, hoje: today, canSettle, onClose, onReceive, onCancel }: {
  titulo: FinanceTitle;
  hoje: string;
  canSettle: boolean;
  onClose: () => void;
  onReceive: (id: string) => Promise<void> | void;
  onCancel: (id: string) => Promise<void> | void;
}) {
  const [confirmar, setConfirmar] = useState<"receber" | "cancelar" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const situacao = situacaoRecebivel(titulo, today);
  const aberto = situacao === "Em aberto" || situacao === "Vencido" || situacao === "Parcial";
  const recebido = titulo.installments.reduce((acc, parcela) => acc + parcela.settledAmount, 0);
  const executar = async () => {
    setOcupado(true);
    await (confirmar === "receber" ? onReceive(titulo.id) : onCancel(titulo.id));
    setOcupado(false);
    onClose();
  };
  return (
    <Modal eyebrow={titulo.isForecast ? "Previsão de recebimento" : "Conta a receber"} title={titulo.counterparty} subtitle={titulo.group && titulo.group !== titulo.counterparty ? `Grupo ${titulo.group}` : undefined} onClose={onClose}>
      <div className="receber-detalhe">
        {titulo.reviewReason && <Callout variant="warning" title="Conferir este lançamento">{titulo.reviewReason}.</Callout>}
        <dl>
          <div><dt>Valor</dt><dd><b>{money(titulo.originalAmount)}</b></dd></div>
          <div><dt>Situação</dt><dd><Status tone={TONE[situacao]}>{situacao}</Status>{titulo.isForecast && <Status tone="purple">Previsão</Status>}</dd></div>
          <div><dt>Vencimento</dt><dd>{date(titulo.installments[0]?.dueDate ?? "")}</dd></div>
          <div><dt>Lançamento</dt><dd>{date(titulo.issueDate)}</dd></div>
          <div><dt>Documento</dt><dd>{titulo.documentNumber ?? "—"}{titulo.documentType ? ` · ${titulo.documentType}` : ""}</dd></div>
          {recebido > 0 && <div><dt>Recebido</dt><dd>{money(recebido)}</dd></div>}
          <div className="largo"><dt>Histórico</dt><dd>{titulo.description}</dd></div>
          <div className="largo"><dt>{titulo.allocations.length > 1 ? "Rateio por conta" : "Conta do plano"}</dt>
            <dd>{titulo.allocations.length > 1
              ? <ul>{titulo.allocations.map((a) => <li key={a.code ?? a.name}><span>{a.code} {a.name}</span><b>{money(a.amount)}</b></li>)}</ul>
              : titulo.chartAccount ?? "—"}</dd></div>
          {titulo.notes && <div className="largo"><dt>Observação</dt><dd className="obs">{titulo.notes}</dd></div>}
          {titulo.source === "legado" && <div className="largo"><dt>Origem</dt><dd>Carga do sistema antigo (relatório de 30/09/2026)</dd></div>}
        </dl>
        {confirmar ? (
          <footer>
            <p>{confirmar === "receber" ? `Confirmar o recebimento integral de ${money(titulo.originalAmount - recebido)}?` : "Cancelar este título? Ele sai do total em aberto e fica em Cancelados."}</p>
            <Button type="button" variant="secondary" onClick={() => setConfirmar(null)} disabled={ocupado}>Voltar</Button>
            <Button type="button" className={confirmar === "cancelar" ? "perigo" : "sucesso"} onClick={executar} disabled={ocupado}>{ocupado ? "Gravando…" : confirmar === "receber" ? "Confirmar recebimento" : "Cancelar título"}</Button>
          </footer>
        ) : (
          <footer>
            <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
            {canSettle && aberto && <Button type="button" variant="secondary" className="perigo-texto" onClick={() => setConfirmar("cancelar")}>Cancelar título</Button>}
            {canSettle && aberto && <Button type="button" className="sucesso" onClick={() => setConfirmar("receber")}>{titulo.isForecast ? "Dar baixa" : "Confirmar recebimento"}</Button>}
          </footer>
        )}
      </div>
    </Modal>
  );
}
