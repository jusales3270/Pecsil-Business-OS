import type { ModuleManifest, ModuleScope } from "./types";
import { hasAnyPermission, hasPermission } from "./access-policy";
import { hasFeature, hasModuleAccess, type AccessGrants, type AccessLevel } from "./access-catalog";

export type ModuleAccessContext = {
  userId: string;
  name: string;
  initials: string;
  /** Rótulo exibido: "Proprietário" ou "Usuário". O acesso vem de `grants`. */
  role: string;
  roleCode?: string | null;
  scopeLabel: string;
  /** Proprietário: acesso total e exclusivo a Pessoas e Acessos. */
  isOwner: boolean;
  /** Funcionalidades liberadas ao usuário, com o nível (ver/operar/aprovar). */
  grants: AccessGrants;
  /** Formato antigo (`modulo.acao`), derivado de `grants`. */
  permissions: readonly string[];
  scopes: readonly {
    type: ModuleScope;
    referenceId?: string;
    moduleCode?: string;
  }[];
};

/**
 * Identidade de espera: usada só enquanto /api/me responde, ou quando o servidor
 * de identidade está inacessível. Não concede nada e não inventa nome.
 */
export const demoOwnerAccess: ModuleAccessContext = {
  userId: "",
  name: "Carregando conta…",
  initials: "--",
  role: "Sem perfil",
  roleCode: null,
  scopeLabel: "Escopo não carregado",
  isOwner: false,
  grants: {},
  permissions: [],
  scopes: [],
};

export { hasAnyPermission, hasPermission };

export function canUseFeature(context: ModuleAccessContext, code: string, level: AccessLevel = "ver") {
  return hasFeature(context, code, level);
}

/**
 * Mostra o atalho de volta ao ecossistema: o proprietário, ou quem tem mais de
 * um módulo liberado (precisa trocar de módulo).
 */
export function hasMultipleModules(context: ModuleAccessContext) {
  if (context.isOwner) return true;
  const modules = new Set(Object.keys(context.grants).map((code) => code.split(".")[0]).filter((code) => code !== "fundacao"));
  return modules.size > 1;
}

export function canAccessModule(context: ModuleAccessContext, manifest: ModuleManifest) {
  if (!manifest.enabled) return false;
  return hasModuleAccess(context, manifest.code);
}

export function getVisibleModules(context: ModuleAccessContext, manifests: readonly ModuleManifest[]) {
  return manifests.filter(manifest => manifest.menu.enabled && canAccessModule(context, manifest));
}

export function getCatalogModules(context: ModuleAccessContext, manifests: readonly ModuleManifest[]) {
  if (context.isOwner) return [...manifests];
  return manifests.filter(manifest => canAccessModule(context, manifest));
}
