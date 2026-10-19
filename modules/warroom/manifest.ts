import { defineModule } from "../types";
import { WARROOM_PERMISSIONS } from "./permissions";

export const WarRoomModuleManifest = defineModule({
  id: "warroom",
  code: "warroom",
  name: "War Room",
  short: "WR",
  description: "O conselho da PecSil: o Segundo Cérebro (o grafo da empresa) e, depois, o conselho com a SARA principal.",
  desc: "O conselho da PecSil: o Segundo Cérebro (o grafo da empresa) e, depois, o conselho com a SARA principal.",
  route: "/modules/warroom",
  version: "1.0.0",
  icon: "rede",
  color: "purple",
  status: "Integrado",
  tone: "success",
  progress: 20,
  enabled: true,
  menu: { enabled: true, order: 5 },
  access: {
    entryPermission: WARROOM_PERMISSIONS.view,
    permissions: Object.values(WARROOM_PERMISSIONS),
    scopes: ["company"],
  },
  sharedServices: ["identity", "organization", "audit", "search"],
  auditEvents: [],
});
