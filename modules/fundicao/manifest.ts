import { defineModule } from "../types";
import { FUNDICAO_PERMISSIONS } from "./permissions";

export const FundicaoModuleManifest = defineModule({
  id: "fundicao",
  code: "fundicao",
  name: "Fundição",
  short: "FD",
  description: "Biblioteca de desenhos (da Forja e da pasta física) e pedidos de material da Fundição ao Compras.",
  desc: "Biblioteca de desenhos (da Forja e da pasta física) e pedidos de material da Fundição ao Compras.",
  route: "/modules/fundicao",
  version: "1.0.0",
  icon: "factory",
  color: "orange",
  status: "Integrado",
  tone: "success",
  progress: 40,
  enabled: true,
  menu: { enabled: true, order: 46 },
  access: {
    entryPermission: FUNDICAO_PERMISSIONS.view,
    permissions: Object.values(FUNDICAO_PERMISSIONS),
    scopes: ["company", "unit"],
  },
  sharedServices: ["identity", "organization", "notifications", "audit", "search"],
  auditEvents: [
    "fundicao.pedido.criado", "fundicao.pedido.cancelado",
    "fundicao.desenho.baixado", "fundicao.nota.gravada", "fundicao.nota.apagada", "fundicao.acervo.enviado", "fundicao.acervo.apagado",
  ],
});
