import { defineModule } from "../types";
import { TI_PERMISSIONS } from "./permissions";

export const TiModuleManifest = defineModule({
  id: "ti",
  code: "ti",
  name: "TI",
  short: "TI",
  description: "Saúde do servidor e do backup, histórico de quedas, inventário de equipamentos e chamados de TI.",
  desc: "Saúde do servidor e do backup, histórico de quedas, inventário de equipamentos e chamados de TI.",
  route: "/modules/ti",
  version: "1.0.0",
  icon: "server",
  color: "blue",
  status: "Integrado",
  tone: "success",
  progress: 35,
  enabled: true,
  menu: { enabled: true, order: 48 },
  access: {
    entryPermission: TI_PERMISSIONS.view,
    permissions: Object.values(TI_PERMISSIONS),
    scopes: ["company", "unit"],
  },
  sharedServices: ["identity", "organization", "notifications", "audit", "search"],
  auditEvents: ["ti.ativo.cadastrado", "ti.ativo.alterado", "ti.incidente.registrado", "ti.incidente.confirmado", "ti.chamado.aberto", "ti.chamado.resolvido", "ti.regras.alteradas"],
});
