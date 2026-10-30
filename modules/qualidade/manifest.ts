import { defineModule } from "../types";
import { QUALIDADE_PERMISSIONS } from "./permissions";

export const QualidadeModuleManifest = defineModule({
  id: "qualidade",
  code: "qualidade",
  name: "Qualidade",
  short: "QL",
  description: "Não conformidades registradas pela SARA, com foto e histórico. As próximas seções entram aqui.",
  desc: "Não conformidades registradas pela SARA, com foto e histórico. As próximas seções entram aqui.",
  route: "/modules/qualidade",
  version: "0.1.0",
  icon: "check",
  color: "green",
  status: "Integrado",
  tone: "success",
  progress: 15,
  enabled: true,
  menu: { enabled: true, order: 60 },
  access: {
    entryPermission: QUALIDADE_PERMISSIONS.view,
    permissions: Object.values(QUALIDADE_PERMISSIONS),
    scopes: ["company", "unit"],
  },
  sharedServices: ["identity", "organization", "notifications", "audit", "search"],
  auditEvents: ["qualidade.nc.registrada", "qualidade.nc.comentada", "qualidade.nc.corrigida", "qualidade.nc.encerrada", "qualidade.nc.cancelada", "qualidade.nc.reaberta", "qualidade.regras.alteradas"],
});
