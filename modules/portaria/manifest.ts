import { defineModule } from "../types";
import { PORTARIA_PERMISSIONS } from "./permissions";

export const portariaModuleManifest = defineModule({
  id: "portaria",
  code: "portaria",
  name: "Portaria & Acesso",
  short: "PA",
  description: "Controle de portaria, visitas, reconhecimento facial, terceiros, frota e encomendas.",
  desc: "Controle de portaria, visitas, reconhecimento facial, terceiros, frota e encomendas.",
  route: "/modules/portaria",
  version: "1.0.0",
  icon: "shield",
  color: "blue",
  status: "Integrado",
  tone: "success",
  progress: 100,
  enabled: true,
  menu: { enabled: true, order: 40 },
  access: {
    entryPermission: PORTARIA_PERMISSIONS.view,
    permissions: Object.values(PORTARIA_PERMISSIONS),
    scopes: ["company", "unit"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: [
    "portaria.visita.create",
    "portaria.visita.exit",
    "portaria.frota.saida",
    "portaria.frota.retorno",
    "portaria.encomenda.create",
  ],
});
