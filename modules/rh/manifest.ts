import { defineModule } from "../types";
import { RH_PERMISSIONS } from "./permissions";

export const rhModuleManifest = defineModule({
  id: "rh",
  code: "rh",
  name: "Recursos Humanos",
  short: "RH",
  description: "Pessoas, jornada, férias, benefícios, SST e documentos.",
  desc: "Pessoas, jornada, férias, benefícios, SST e documentos.",
  route: "/modules/rh",
  version: "1.1.0",
  icon: "users",
  color: "blue",
  status: "Integrado",
  tone: "success",
  progress: 100,
  enabled: true,
  menu: { enabled: true, order: 10 },
  access: {
    entryPermission: RH_PERMISSIONS.view,
    permissions: Object.values(RH_PERMISSIONS),
    scopes: ["company", "unit", "department", "team", "self"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: ["rh.employee.view", "rh.employee.create", "rh.employee.update", "rh.journey.adjust", "rh.absence.approve", "rh.benefit.change", "rh.sst.conclude", "rh.document.approve", "rh.report.export", "rh.module.homologate"],
});
