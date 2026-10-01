import { defineModule } from "../types";
import { FISCAL_PERMISSIONS } from "./permissions";

export const fiscalModuleManifest = defineModule({
  id: "fiscal",
  code: "fiscal",
  name: "Fiscal",
  short: "FI",
  description: "Painel do ICMS: notas de entrada do mês, crédito de ICMS e IPI por centro e livro de apuração.",
  desc: "Painel do ICMS: notas de entrada do mês, crédito de ICMS e IPI por centro e livro de apuração.",
  route: "/modules/fiscal",
  version: "1.0.0",
  icon: "file",
  color: "teal",
  status: "Integrado",
  tone: "success",
  progress: 30,
  enabled: true,
  menu: { enabled: true, order: 25 },
  access: {
    entryPermission: FISCAL_PERMISSIONS.view,
    permissions: Object.values(FISCAL_PERMISSIONS),
    scopes: ["company"],
  },
  sharedServices: ["identity", "organization", "notifications", "audit", "search"],
  auditEvents: [],
});
