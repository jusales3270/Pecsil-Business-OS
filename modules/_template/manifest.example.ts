import { defineModule } from "../types";

export const exampleModuleManifest = defineModule({
  id: "example",
  code: "example",
  name: "Módulo Exemplo",
  short: "EX",
  description: "Descrição funcional do novo domínio.",
  desc: "Descrição funcional do novo domínio.",
  version: "0.1.0",
  route: "/modules/example",
  icon: "modules",
  color: "blue",
  status: "Planejado",
  tone: "neutral",
  progress: 0,
  enabled: false,
  menu: { enabled:false, order:100 },
  access: {
    entryPermission: "example.view",
    permissions: ["example.view", "example.create", "example.edit", "example.approve", "example.export", "example.admin"],
    scopes: ["company", "unit", "department", "team"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: ["example.record.view", "example.record.update", "example.report.export"],
});
