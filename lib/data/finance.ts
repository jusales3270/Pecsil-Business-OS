export type FinanceDirection = "payable" | "receivable";
export type FinanceTitleStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "partially_settled"
  | "settled"
  | "overdue"
  | "cancelled";

export type FinanceInstallment = {
  id: string;
  number: number;
  dueDate: string;
  amount: number;
  settledAmount: number;
  status: "pending" | "partially_settled" | "settled" | "overdue" | "cancelled";
};

export type FinanceTitle = {
  id: string;
  direction: FinanceDirection;
  counterparty: string;
  documentNumber: string | null;
  description: string;
  issueDate: string;
  originalAmount: number;
  status: FinanceTitleStatus;
  costCenter: string | null;
  chartAccount: string | null;
  installments: FinanceInstallment[];
  /** Previsão (orçamento sem nota ou duplicata já antecipada): fora do "A receber". */
  isForecast: boolean;
  /** Apelido do grupo do cliente (ex.: FILIAL VIDROS, O-I / SP). */
  group: string | null;
  documentType: string | null;
  notes: string | null;
  /** Motivo para a equipe conferir o título; nulo quando não há nada a revisar. */
  reviewReason: string | null;
  /** "legado" = veio da carga do sistema antigo. */
  source: string | null;
  /** Rateio por conta do plano (vazio quando o título tem uma conta só). */
  allocations: FinanceAllocation[];
};

export type FinanceAllocation = { code: string | null; name: string; amount: number };

export type FinanceBankAccount = {
  id: string;
  name: string;
  bankCode: string;
  branch: string;
  accountNumber: string;
  balance: number;
  active: boolean;
};

export type FinanceCostCenter = { id: string; code: string | null; name: string };
export type FinanceChartAccount = { id: string; code: string; name: string; type: string; allowsPosting: boolean };

export type FinanceSummary = {
  availableBalance: number;
  payableOpen: number;
  receivableOpen: number;
  /** Previsões a receber em aberto — nunca somadas em receivableOpen. */
  receivableForecast: number;
  pendingApprovals: number;
  unreconciledEntries: number;
};

export type FinanceSnapshot = {
  source: "demo" | "supabase";
  organizationId: string | null;
  summary: FinanceSummary;
  titles: FinanceTitle[];
  bankAccounts: FinanceBankAccount[];
  costCenters: FinanceCostCenter[];
  chartAccounts: FinanceChartAccount[];
  loadedAt: string;
};

// Sem sessão ou sem conexão: vazio, nunca título ou saldo fictício.
export const demoFinanceSnapshot: FinanceSnapshot = {
  source: "demo",
  organizationId: null,
  summary: {
    availableBalance: 0,
    payableOpen: 0,
    receivableOpen: 0,
    receivableForecast: 0,
    pendingApprovals: 0,
    unreconciledEntries: 0,
  },
  titles: [],
  bankAccounts: [],
  costCenters: [],
  chartAccounts: [],
  loadedAt: new Date(0).toISOString(),
};

