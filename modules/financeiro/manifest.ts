import { defineModule } from "../types";
import { FINANCE_PERMISSIONS } from "./permissions";

export const financeModuleManifest = defineModule({
  id: "financeiro",
  code: "financeiro",
  name: "Financeiro",
  short: "FN",
  description: "Contas a pagar e receber, caixa, bancos, conciliação e resultado.",
  desc: "Contas a pagar e receber, caixa, bancos, conciliação e resultado.",
  route: "/modules/financeiro",
  version: "1.0.0",
  icon: "chart",
  color: "red",
  status: "Integrado",
  tone: "success",
  progress: 100,
  enabled: true,
  menu: { enabled: true, order: 20 },
  access: {
    entryPermission: FINANCE_PERMISSIONS.view,
    permissions: Object.values(FINANCE_PERMISSIONS),
    scopes: ["company", "unit", "department"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: ["financeiro.payable.create", "financeiro.payable.approve", "financeiro.payable.settle", "financeiro.receivable.create", "financeiro.receivable.settle", "financeiro.bank.reconcile", "financeiro.report.export", "financeiro.module.homologate"],
});
