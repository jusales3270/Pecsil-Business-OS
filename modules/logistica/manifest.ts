import { defineModule } from "../types";
import { LOGISTICA_PERMISSIONS } from "./permissions";

export const LogisticaModuleManifest = defineModule({
  id: "logistica",
  code: "logistica",
  name: "Logística",
  short: "LG",
  description: "Entregas com a frota própria: da OS ou do pedido ao cliente, com os caminhões no mapa em tempo real.",
  desc: "Entregas com a frota própria: da OS ou do pedido ao cliente, com os caminhões no mapa em tempo real.",
  route: "/modules/logistica",
  version: "1.0.0",
  icon: "truck",
  color: "teal",
  status: "Integrado",
  tone: "success",
  progress: 25,
  enabled: true,
  menu: { enabled: true, order: 6 },
  access: {
    entryPermission: LOGISTICA_PERMISSIONS.view,
    permissions: Object.values(LOGISTICA_PERMISSIONS),
    scopes: ["company"],
  },
  sharedServices: ["identity", "organization", "audit", "search"],
  auditEvents: [],
});
