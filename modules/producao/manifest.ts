import { defineModule } from "../types";
import { PRODUCAO_PERMISSIONS } from "./permissions";

export const producaoModuleManifest = defineModule({
  id: "producao",
  code: "producao",
  name: "Produção",
  short: "PR",
  description: "Acompanhamento em tempo real da linha de produção, OPs, paradas e OEE via Forja.",
  desc: "Acompanhamento em tempo real da linha de produção, OPs, paradas e OEE via Forja.",
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
