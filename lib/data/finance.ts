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
};

export type FinanceBankAccount = {
  id: string;
  name: string;
  bankCode: string;
  branch: string;
  accountNumber: string;
  balance: number;
  active: boolean;
};

export type FinanceSummary = {
  availableBalance: number;
  payableOpen: number;
  receivableOpen: number;
  pendingApprovals: number;
  unreconciledEntries: number;
};

export type FinanceSnapshot = {
  source: "demo" | "supabase";
  organizationId: string | null;
  summary: FinanceSummary;
  titles: FinanceTitle[];
  bankAccounts: FinanceBankAccount[];
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
    pendingApprovals: 0,
    unreconciledEntries: 0,
  },
  titles: [],
  bankAccounts: [],
  loadedAt: new Date(0).toISOString(),
};

