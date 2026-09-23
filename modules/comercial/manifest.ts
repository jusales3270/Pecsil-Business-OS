import { defineModule } from "../types";
import { COMERCIAL_PERMISSIONS } from "./permissions";

/**
 * Comercial é um DEPARTAMENTO: ele abriga áreas. Hoje abriga o Compras (que
 * continua sendo o módulo `compras`, com as mesmas funcionalidades e eventos)
 * e vai abrigar o CRM. Quem decide o que cada pessoa vê continua sendo o
 * credenciamento por funcionalidade — o departamento só organiza a navegação.
 */
export const comercialModuleManifest = defineModule({
  id: "comercial",
  code: "comercial",
  name: "Comercial",
  short: "CM",
  description: "Relacionamento com clientes e compras: pedidos, cobrança, funil e cotações com fornecedores.",
  desc: "Relacionamento com clientes e compras: pedidos, cobrança, funil e cotações com fornecedores.",
  route: "/modules/comercial",
  version: "1.0.0",
  icon: "handshake",
  color: "teal",
  status: "Integrado",
  tone: "success",
  progress: 40,
  enabled: true,
  menu: { enabled: true, order: 30 },
  access: {
    entryPermission: COMERCIAL_PERMISSIONS.view,
    permissions: Object.values(COMERCIAL_PERMISSIONS),
    scopes: ["company", "unit", "department"],
  },
  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],
  auditEvents: [
    "comercial.email.classify",
    "comercial.card.create",
    "comercial.card.move",
    "comercial.cobranca.send",
  ],
});
