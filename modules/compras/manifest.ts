import { defineModule } from "../types";
import { COMPRAS_PERMISSIONS } from "./permissions";

export const comprasModuleManifest = defineModule({
  id: "compras",
  code: "compras",
  name: "Compras",
  short: "CP",
  description: "Cotações, solicitações, aprovações de gestor e compras de fornecedores.",
  desc: "Cotações, solicitações, aprovações de gestor e compras de fornecedores.",
  route: "/modules/compras",
  version: "1.0.0",
  icon: "cart",
  color: "teal",
  status: "Integrado",
  tone: "success",
  progress: 100,
  enabled: true,
  menu: { enabled: true, order: 30 },
  access: {
    entryPermission: COMPRAS_PERMISSIONS.view,
    permissions: Object.values(COMPRAS_PERMISSIONS),
    scopes: ["company", "unit", "department"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: [
    "compras.cotacao.create",
    "compras.cotacao.approve",
    "compras.cotacao.reject",
    "compras.order.create",
    "compras.order.complete",
  ],
});
