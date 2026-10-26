/**
 * Do Financeiro para eventos contábeis (N-04). Puro: recebe as linhas já lidas do banco.
 * - Título (a pagar ou a receber) entra na data de competência, rateado pelas contas gerenciais.
 * - Baixa entra na data do pagamento. Principal quitado = valor + desconto; o que passa pelo banco =
 *   valor + juros + multa (é a mesma conta da conciliação com o extrato, lib/finance/extrato-carga.ts).
 * Previsão, título arquivado ou cancelado e baixa estornada não entram. Variação cambial fica para lançar à mão.
 */
import { r2, type Evento, type Pendencia } from "./regras";

export type LinhaTitulo = {
  id: string; direction: "payable" | "receivable"; counterparty_name: string | null; document_number: string | null; description: string | null;
  competence_date: string | null; issue_date: string | null; original_amount: number | string; chart_account_id: string | null; cost_center_id: string | null;
  is_forecast: boolean | null; archived_at: string | null; cancelled_at: string | null;
};
export type LinhaRateio = { title_id: string; chart_account_id: string; amount: number | string };
export type LinhaBaixa = {
  id: string; settlement_date: string; amount: number | string; discount: number | string | null; interest: number | string | null; penalty: number | string | null;
  exchange_difference: number | string | null; bank_account_id: string | null; reversed_at: string | null;
  titulo: { id: string; direction: "payable" | "receivable"; counterparty_name: string | null; document_number: string | null; cost_center_id: string | null } | null;
};

const n = (v: number | string | null | undefined) => r2(Number(v ?? 0) || 0);
const quem = (nome: string | null, doc: string | null) => [doc ? `nº ${doc}` : "", nome ?? ""].filter(Boolean).join(" · ") || "sem identificação";

export function eventoDoTitulo(t: LinhaTitulo, rateios: readonly LinhaRateio[]): Evento | null {
  if (t.is_forecast || t.archived_at || t.cancelled_at) return null;
  const data = t.competence_date ?? t.issue_date;
  if (!data) return null;
  const valor = n(t.original_amount);
  const alocacoes = rateios.length
    ? rateios.map((r) => ({ contaGerencial: r.chart_account_id, valor: n(r.amount) }))
    : t.chart_account_id ? [{ contaGerencial: t.chart_account_id, valor }] : [];
  const pagar = t.direction === "payable";
  return {
    tipo: pagar ? "titulo_pagar" : "titulo_receber", origemTipo: "titulo", origemId: t.id, data,
    historico: `${pagar ? "Título a pagar" : "Título a receber"} ${quem(t.counterparty_name, t.document_number)}${t.description ? ` · ${t.description}` : ""}`.slice(0, 500),
    valores: { valor, principal: valor, juros: 0, multa: 0, desconto: 0, caixa: 0 },
    alocacoes, contaBancaria: null, centroCusto: t.cost_center_id,
  };
}

/** `bancoDaConciliacao`: a conta do extrato com que a baixa foi conciliada, para quando a baixa não diz o banco. */
export function eventoDaBaixa(b: LinhaBaixa, bancoDaConciliacao: string | null): Evento | { pendencia: Pendencia } | null {
  if (b.reversed_at || !b.titulo) return null;
  if (n(b.exchange_difference) !== 0) return { pendencia: { motivo: "desequilibrado", detalhe: "Baixa com variação cambial: lance à mão." } };
  const valor = n(b.amount), desconto = n(b.discount), juros = n(b.interest), multa = n(b.penalty);
  const pagar = b.titulo.direction === "payable";
  return {
    tipo: pagar ? "baixa_pagar" : "baixa_receber", origemTipo: "baixa", origemId: b.id, data: b.settlement_date,
    historico: `${pagar ? "Pagamento" : "Recebimento"} ${quem(b.titulo.counterparty_name, b.titulo.document_number)}`.slice(0, 500),
    valores: { valor, principal: r2(valor + desconto), juros, multa, desconto, caixa: r2(valor + juros + multa) },
    alocacoes: [], contaBancaria: b.bank_account_id ?? bancoDaConciliacao, centroCusto: b.titulo.cost_center_id,
  };
}
