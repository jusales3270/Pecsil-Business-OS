export const FINANCE_PERMISSIONS = {
  view: "financeiro.view",
  create: "financeiro.create",
  edit: "financeiro.edit",
  approve: "financeiro.approve",
  settle: "financeiro.settle",
  reconcile: "financeiro.reconcile",
  export: "financeiro.export",
  admin: "financeiro.admin",
} as const;

export type FinancePermission = (typeof FINANCE_PERMISSIONS)[keyof typeof FINANCE_PERMISSIONS];
