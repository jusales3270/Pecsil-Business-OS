import { defineModule, type ModuleManifest } from "./types";

const planned = (manifest: Pick<ModuleManifest, "id" | "code" | "name" | "short" | "description" | "route" | "icon" | "color" | "status">) => defineModule({
  ...manifest,
  desc: manifest.description,
  version: "0.0.0",
  tone: "neutral",
  progress: 0,
  enabled: false,
  menu: { enabled: false, order: 100 },
  access: {
    entryPermission: `${manifest.code}.view`,
    permissions: [`${manifest.code}.view`, `${manifest.code}.create`, `${manifest.code}.edit`, `${manifest.code}.approve`, `${manifest.code}.export`, `${manifest.code}.admin`],
    scopes: ["company", "unit", "department", "team"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: [`${manifest.code}.record.view`, `${manifest.code}.record.update`, `${manifest.code}.report.export`],
});

export const plannedModuleManifests = [
  planned({ id:"estoque", code:"estoque", name:"Estoque", short:"ES", description:"Saldos, lotes, movimentações, rastreabilidade e inventário.", route:"/modules/estoque", icon:"box", color:"purple", status:"Planejado" }),
  planned({ id:"qualidade", code:"qualidade", name:"Qualidade", short:"QL", description:"Inspeções, não conformidades, planos de ação e indicadores.", route:"/modules/qualidade", icon:"check", color:"green", status:"Planejado" }),
] as const;
