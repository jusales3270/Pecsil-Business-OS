"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Kpi, KpiGrid, Segmented } from "../../packages/design-system";
import { MANAGEMENT_TYPES, type ManagementType } from "../../lib/finance/plano-contas-core";

/**
 * Fluxo de caixa e gasto por conta do plano. Os números vêm somados do banco
 * (finance_cash_by_month e finance_expense_by_account): a tela não baixa os
 * milhares de títulos para somar aqui.
 */

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (value: number) => Math.round(value).toLocaleString("pt-BR");
const moneyShort = (value: number) =>
  Math.abs(value) >= 1_000_000 ? `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
  : Math.abs(value) >= 10_000 ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`
  : money(value);
const anoAtual = () => Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
const mesAtual = () => Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(5, 7));

function useAno<T>(url: (ano: number) => string, ano: number, extra = "") {
  const chave = `${ano}|${extra}`;
  const [estado, setEstado] = useState<{ chave: string; dados: T | null; erro: string } | null>(null);
  const endereco = url(ano);
  useEffect(() => {
    let ativo = true;
    fetch(endereco, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => null) }))
      .catch(() => ({ ok: false, body: null }))
      .then(({ ok, body }) => { if (ativo) setEstado({ chave, dados: ok ? (body as T) : null, erro: ok ? "" : body?.error === "FORBIDDEN" ? "Sem permissão para ver este relatório." : "Não foi possível carregar." }); });
    return () => { ativo = false; };
  }, [endereco, chave]);
  return { carregando: estado?.chave !== chave, dados: estado?.chave === chave ? estado.dados : null, erro: estado?.chave === chave ? estado.erro : "" };
}

function Ano({ ano, setAno }: { ano: number; setAno: (ano: number) => void }) {
  return (
    <div className="fin-ano">
      <button type="button" onClick={() => setAno(ano - 1)} aria-label="Ano anterior">‹</button>
      <b>{ano}</b>
      <button type="button" onClick={() => setAno(ano + 1)} disabled={ano >= anoAtual() + 1} aria-label="Próximo ano">›</button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Fluxo de caixa
   ------------------------------------------------------------------------- */

type CashRow = { month: number; direction: "payable" | "receivable"; realized: number; open: number; forecast: number };

export function FinanceCashFlow() {
  const [ano, setAno] = useState(anoAtual);
  const { carregando, dados, erro } = useAno<{ months: CashRow[] }>((year) => `/api/finance/fluxo?ano=${year}`, ano);
  const meses = useMemo(() => MESES.map((nome, index) => {
    const de = (direction: CashRow["direction"]) => dados?.months.find((row) => row.month === index + 1 && row.direction === direction) ?? { realized: 0, open: 0, forecast: 0 };
    const entra = de("receivable");
    const sai = de("payable");
    return { nome, mes: index + 1, entra, sai, realizado: entra.realized - sai.realized, previsto: entra.open - sai.open };
  }), [dados]);
  const soma = (pick: (m: (typeof meses)[number]) => number) => meses.reduce((acc, m) => acc + pick(m), 0);
  const max = Math.max(1, ...meses.flatMap((m) => [m.entra.realized + m.entra.open, m.sai.realized + m.sai.open]));
  const vazio = !carregando && meses.every((m) => !m.entra.realized && !m.entra.open && !m.sai.realized && !m.sai.open && !m.entra.forecast && !m.sai.forecast);
  const semEntradasRealizadas = !carregando && soma((m) => m.entra.realized) === 0 && soma((m) => m.sai.realized) > 0;
  const atual = ano === anoAtual() ? mesAtual() : 0;

  return (
    <>
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">FINANCEIRO · TESOURARIA</p>
          <h1>Fluxo de caixa</h1>
          <p>Por mês: o que já entrou e saiu (baixas) e o que está em aberto, pelo vencimento. Previsão aparece à parte.</p>
        </div>
        <Ano ano={ano} setAno={setAno} />
      </div>

      <KpiGrid>
        <Kpi label="Saídas realizadas" value={moneyShort(soma((m) => m.sai.realized))} caption={`Pago em ${ano}`} tone="amber" />
        <Kpi label="Entradas realizadas" value={moneyShort(soma((m) => m.entra.realized))} caption={`Recebido em ${ano}`} tone="green" />
        <Kpi label="A pagar em aberto" value={moneyShort(soma((m) => m.sai.open))} caption={`Vencimento em ${ano}, sem previsão`} tone="red" />
        <Kpi label="A receber em aberto" value={moneyShort(soma((m) => m.entra.open))} caption={`Vencimento em ${ano}, sem previsão`} tone="blue" />
      </KpiGrid>

      {semEntradasRealizadas && (
        <Callout variant="info" title="Entradas realizadas ainda sem histórico">
          O contas a receber veio do sistema antigo só com os títulos em aberto, sem o que já foi recebido. As entradas realizadas passam a aparecer conforme os recebimentos forem confirmados aqui.
        </Callout>
      )}

      <Card className="fin-fluxo">
        {erro ? <div className="finance-empty"><b>{erro}</b></div>
          : carregando ? <div className="finance-empty"><small>Calculando {ano}…</small></div>
          : vazio ? <div className="finance-empty"><b>Sem movimento em {ano}</b><small>O fluxo aparece quando houver títulos com vencimento ou baixa no ano.</small></div>
          : <>
            <div className="fin-fluxo-legenda"><span className="entra">Entradas</span><span className="sai">Saídas</span><span className="aberto">faixa clara = em aberto</span></div>
            <div className="fin-fluxo-barras" aria-hidden>
              {meses.map((m) => (
                <div key={m.mes} className={m.mes === atual ? "atual" : ""}>
                  <div>
                    <i className="entra" style={{ height: `${Math.round(((m.entra.realized + m.entra.open) / max) * 120)}px` }}><u style={{ height: `${m.entra.realized + m.entra.open ? Math.round((m.entra.open / (m.entra.realized + m.entra.open)) * 100) : 0}%` }} /></i>
                    <i className="sai" style={{ height: `${Math.round(((m.sai.realized + m.sai.open) / max) * 120)}px` }}><u style={{ height: `${m.sai.realized + m.sai.open ? Math.round((m.sai.open / (m.sai.realized + m.sai.open)) * 100) : 0}%` }} /></i>
                  </div>
                  <b>{m.nome}</b>
                </div>
              ))}
            </div>
            <div className="fin-tabela-rolagem">
              <table className="fin-tabela">
                <thead><tr><th>Mês</th><th>Recebido</th><th>Pago</th><th>Resultado realizado</th><th>A receber</th><th>A pagar</th><th>Saldo em aberto</th><th>Previsões a receber</th><th>Previsões a pagar</th></tr></thead>
                <tbody>
                  {meses.map((m) => (
                    <tr key={m.mes} className={m.mes === atual ? "atual" : ""}>
                      <th>{m.nome}</th><td>{inteiro(m.entra.realized)}</td><td>{inteiro(m.sai.realized)}</td><td className={m.realizado < 0 ? "neg" : ""}>{inteiro(m.realizado)}</td>
                      <td>{inteiro(m.entra.open)}</td><td>{inteiro(m.sai.open)}</td><td className={m.previsto < 0 ? "neg" : ""}>{inteiro(m.previsto)}</td>
                      <td className="fraco">{inteiro(m.entra.forecast)}</td><td className="fraco">{inteiro(m.sai.forecast)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th>Total</th><td>{inteiro(soma((m) => m.entra.realized))}</td><td>{inteiro(soma((m) => m.sai.realized))}</td><td>{inteiro(soma((m) => m.realizado))}</td><td>{inteiro(soma((m) => m.entra.open))}</td><td>{inteiro(soma((m) => m.sai.open))}</td><td>{inteiro(soma((m) => m.previsto))}</td><td className="fraco">{inteiro(soma((m) => m.entra.forecast))}</td><td className="fraco">{inteiro(soma((m) => m.sai.forecast))}</td></tr></tfoot>
              </table>
            </div>
            <p className="fin-nota">Valores em reais, sem centavos. Em aberto inclui o que já venceu e não foi baixado. Não há saldo bancário: as contas e os extratos ainda não estão cadastrados.</p>
          </>}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------------------
   Gasto por conta do plano
   ------------------------------------------------------------------------- */

type ExpenseRow = { month: number; code: string | null; name: string; type: ManagementType; total: number; titles: number };
type Base = "vencimento" | "lancamento" | "pagamento";
const BASES: { value: Base; label: string }[] = [{ value: "vencimento", label: "Por vencimento" }, { value: "lancamento", label: "Por lançamento" }, { value: "pagamento", label: "Só o que foi pago" }];
const ORDEM: ManagementType[] = ["custo_variavel", "custo_fixo", "despesa_variavel", "despesa_fixa", "investimento", "repasse", "receita"];

export function FinanceExpenseReport({ onBack }: { onBack: () => void }) {
  const [ano, setAno] = useState(anoAtual);
  const [base, setBase] = useState<Base>("vencimento");
  const [fechados, setFechados] = useState<Set<string>>(new Set(ORDEM));
  const { carregando, dados, erro } = useAno<{ rows: ExpenseRow[] }>((year) => `/api/finance/relatorios/gasto-por-conta?ano=${year}&base=${base}`, ano, base);

  const grupos = useMemo(() => {
    const rows = dados?.rows ?? [];
    return ORDEM.map((tipo) => {
      const contas = new Map<string, { code: string | null; name: string; meses: number[]; total: number }>();
      for (const row of rows.filter((r) => r.type === tipo)) {
        const chave = `${row.code ?? ""}|${row.name}`;
        const conta = contas.get(chave) ?? { code: row.code, name: row.name, meses: Array(12).fill(0) as number[], total: 0 };
        conta.meses[row.month - 1] += row.total;
        conta.total += row.total;
        contas.set(chave, conta);
      }
      const lista = [...contas.values()].sort((a, b) => b.total - a.total);
      return { tipo, contas: lista, meses: Array.from({ length: 12 }, (_, i) => lista.reduce((acc, c) => acc + c.meses[i], 0)), total: lista.reduce((acc, c) => acc + c.total, 0) };
    }).filter((grupo) => grupo.contas.length);
  }, [dados]);
  const totalMeses = Array.from({ length: 12 }, (_, i) => grupos.reduce((acc, g) => acc + g.meses[i], 0));
  const total = grupos.reduce((acc, g) => acc + g.total, 0);
  const de = (tipos: ManagementType[]) => grupos.filter((g) => tipos.includes(g.tipo)).reduce((acc, g) => acc + g.total, 0);
  const alternar = (tipo: string) => setFechados((atual) => {
    const novo = new Set(atual);
    if (novo.has(tipo)) novo.delete(tipo); else novo.add(tipo);
    return novo;
  });

  return (
    <>
      <div className="finance-page-head">
        <div>
          <p className="eyebrow">FINANCEIRO · RELATÓRIOS</p>
          <h1>Gasto por conta do plano</h1>
          <p>Contas a pagar de {ano} pelo rateio em cada conta, sem previsões e sem títulos cancelados.</p>
        </div>
        <Button variant="secondary" onClick={onBack}>Voltar aos relatórios</Button>
      </div>

      <div className="fin-filtros">
        <Ano ano={ano} setAno={setAno} />
        <Segmented<Base> ariaLabel="Data de referência" value={base} onChange={setBase} options={BASES} compact />
      </div>

      <KpiGrid>
        <Kpi label="Total no ano" value={moneyShort(total)} caption={BASES.find((b) => b.value === base)!.label} tone="blue" />
        <Kpi label="Custos" value={moneyShort(de(["custo_variavel", "custo_fixo"]))} caption="Variáveis e fixos" tone="amber" />
        <Kpi label="Despesas" value={moneyShort(de(["despesa_variavel", "despesa_fixa"]))} caption="Variáveis e fixas" tone="red" />
        <Kpi label="Investimentos e repasses" value={moneyShort(de(["investimento", "repasse"]))} caption="Fora do custo e da despesa" tone="purple" />
      </KpiGrid>

      <Card className="fin-fluxo">
        {erro ? <div className="finance-empty"><b>{erro}</b></div>
          : carregando ? <div className="finance-empty"><small>Calculando {ano}…</small></div>
          : !grupos.length ? <div className="finance-empty"><b>Sem contas a pagar em {ano}</b><small>O relatório aparece quando houver títulos lançados no ano.</small></div>
          : <>
            <div className="fin-tabela-rolagem">
              <table className="fin-tabela contas">
                <thead><tr><th>Conta</th>{MESES.map((m) => <th key={m}>{m}</th>)}<th>Total</th></tr></thead>
                {grupos.map((grupo) => (
                  <tbody key={grupo.tipo}>
                    <tr className="grupo">
                      <th><button type="button" onClick={() => alternar(grupo.tipo)} aria-expanded={!fechados.has(grupo.tipo)}><span className={fechados.has(grupo.tipo) ? "" : "aberto"}>›</span> {MANAGEMENT_TYPES[grupo.tipo]} <small>{grupo.contas.length} {grupo.contas.length === 1 ? "conta" : "contas"}</small></button></th>
                      {grupo.meses.map((valor, i) => <td key={i}>{valor ? inteiro(valor) : "—"}</td>)}<td>{inteiro(grupo.total)}</td>
                    </tr>
                    {!fechados.has(grupo.tipo) && grupo.contas.map((conta) => (
                      <tr key={`${conta.code}|${conta.name}`}>
                        <th><code>{conta.code ?? "s/ código"}</code> {conta.name}</th>
                        {conta.meses.map((valor, i) => <td key={i}>{valor ? inteiro(valor) : "—"}</td>)}<td>{inteiro(conta.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
                <tfoot><tr><th>Total</th>{totalMeses.map((valor, i) => <td key={i}>{valor ? inteiro(valor) : "—"}</td>)}<td>{inteiro(total)}</td></tr></tfoot>
              </table>
            </div>
            <p className="fin-nota">Valores em reais, sem centavos. Clique num tipo para ver as contas. Título pago a maior soma também os juros e tarifas, nas contas em que foram rateados.</p>
          </>}
      </Card>
    </>
  );
}
