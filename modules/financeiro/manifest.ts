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
  version: "1.3.0",
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
  auditEvents: ["financeiro.payable.create", "financeiro.payable.approve", "financeiro.payable.settle", "financeiro.payable.partial_settle", "financeiro.settlement.reverse", "financeiro.receivable.create", "financeiro.receivable.settle", "financeiro.bank.import", "financeiro.bank.reconcile", "financeiro.approval.decide", "financeiro.report.export", "financeiro.tax_report.review", "financeiro.module.homologate"],
});
