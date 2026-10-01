import { defineModule } from "../types";
import { ALMOXARIFADO_PERMISSIONS } from "./permissions";

export const almoxarifadoModuleManifest = defineModule({
  id: "almoxarifado",
  code: "almoxarifado",
  name: "Almoxarifado",
  short: "AL",
  description: "Pedido de material, acompanhamento da compra e recebimento com a nota fiscal, ligado ao Compras e ao Financeiro.",
  desc: "Pedido de material, acompanhamento da compra e recebimento com a nota fiscal, ligado ao Compras e ao Financeiro.",
  route: "/modules/almoxarifado",
  version: "1.0.0",
  icon: "box",
  color: "purple",
  status: "Integrado",
  tone: "success",
  progress: 60,
  enabled: true,
  menu: { enabled: true, order: 45 },
  access: {
    entryPermission: ALMOXARIFADO_PERMISSIONS.view,
    permissions: Object.values(ALMOXARIFADO_PERMISSIONS),
    scopes: ["company", "unit"],
  },
  sharedServices: ["identity", "organization", "notifications", "audit", "search"],
  auditEvents: ["almoxarifado.solicitacao.criada", "almoxarifado.solicitacao.cancelada", "almoxarifado.recebimento.confirmado"],
});
