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

export const demoFinanceSnapshot: FinanceSnapshot = {
  source: "demo",
  organizationId: null,
  summary: {
    availableBalance: 842350,
    payableOpen: 33553.5,
    receivableOpen: 194900,
    pendingApprovals: 1,
    unreconciledEntries: 3,
  },
  titles: [
    {
      id: "demo-payable-egr",
      direction: "payable",
      counterparty: "EGR Moldes",
      documentNumber: "NF 230 · 4/6",
      description: "Ferramentais para Produção",
      issueDate: "2026-04-29",
      originalAmount: 6000,
      status: "approved",
      costCenter: "Produção",
      chartAccount: "Ferramentais",
      installments: [{ id:"demo-installment-egr", number:4, dueDate:"2026-07-30", amount:6000, settledAmount:0, status:"pending" }],
    },
    {
      id: "demo-payable-rcm",
      direction: "payable",
      counterparty: "RCM Importadora de Ferramentas Ltda.",
      documentNumber: "NF 80603 · 9/20",
      description: "Baixa parcial preservando o saldo",
      issueDate: "2025-09-30",
      originalAmount: 6000,
      status: "partially_settled",
      costCenter: "Produção",
      chartAccount: "Matéria-prima",
      installments: [{ id:"demo-installment-rcm", number:9, dueDate:"2026-06-30", amount:6000, settledAmount:3000, status:"partially_settled" }],
    },
    {
      id: "demo-receivable-cristal",
      direction: "receivable",
      counterparty: "Cristal Forte",
      documentNumber: "NF-e 10.851",
      description: "Venda de moldes",
      issueDate: "2026-06-10",
      originalAmount: 68400,
      status: "overdue",
      costCenter: "Comercial",
      chartAccount: "Receita de vendas",
      installments: [{ id:"demo-installment-cristal", number:1, dueDate:"2026-07-14", amount:68400, settledAmount:0, status:"overdue" }],
    },
  ],
  bankAccounts: [
    { id:"demo-bb", name:"Banco do Brasil", bankCode:"001", branch:"4521", accountNumber:"4521-7", balance:428650, active:true },
    { id:"demo-itau", name:"Itaú", bankCode:"341", branch:"8830", accountNumber:"88304-2", balance:296180, active:true },
    { id:"demo-santander", name:"Santander", bankCode:"033", branch:"1029", accountNumber:"10298-4", balance:117520, active:true },
  ],
  loadedAt: new Date(0).toISOString(),
};

