import { defineModule } from "../types";
import { FISCAL_PERMISSIONS } from "./permissions";

export const fiscalModuleManifest = defineModule({
  id: "fiscal",
  code: "fiscal",
  name: "Fiscal",
  short: "FI",
  description: "Painel do ICMS, notas recebidas da SEFAZ e configuração fiscal (base da emissão de NF-e).",
  desc: "Painel do ICMS, notas recebidas da SEFAZ e configuração fiscal (base da emissão de NF-e).",
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
