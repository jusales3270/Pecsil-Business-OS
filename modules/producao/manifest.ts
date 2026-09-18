import { defineModule } from "../types";
import { PRODUCAO_PERMISSIONS } from "./permissions";

export const producaoModuleManifest = defineModule({
  id: "producao",
  code: "producao",
  name: "Produção",
  short: "PR",
  description: "Acompanhamento em tempo real da linha de produção via Forja: OS, lotes por etapa, paradas, pontualidade e envios externos.",
  desc: "Acompanhamento em tempo real da linha de produção via Forja: OS, lotes por etapa, paradas, pontualidade e envios externos.",
  route: "/modules/producao",
  version: "1.0.0",
  icon: "factory",
  color: "orange",
  status: "Integrado",
  tone: "success",
  progress: 100,
  enabled: true,
  menu: { enabled: true, order: 50 },
  access: {
    entryPermission: PRODUCAO_PERMISSIONS.view,
    permissions: Object.values(PRODUCAO_PERMISSIONS),
    scopes: ["company", "unit", "department", "team"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: [
    "producao.dashboard.view",
    "producao.os.view",
    "producao.parada.inspect",
    "producao.inspecao.view",
    "producao.report.export",
  ],
});
