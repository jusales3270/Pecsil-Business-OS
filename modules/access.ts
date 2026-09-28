import type { ModuleManifest, ModuleScope } from "./types";
import { hasAnyPermission, hasPermission } from "./access-policy";
import { getDepartmentAreas } from "./registry";
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
 * Acesso ao módulo pelas funcionalidades liberadas. Um departamento também abre
 * pelas áreas que abriga: quem só tem `compras.*` entra pelo Comercial.
 */
export function canAccessModule(context: ModuleAccessContext, manifest: ModuleManifest) {
  if (!manifest.enabled) return false;
  if (hasModuleAccess(context, manifest.code)) return true;
  return getDepartmentAreas(manifest.id).some(area => area.enabled && hasModuleAccess(context, area.code));
}

/** Só departamentos e módulos soltos aparecem no menu; as áreas abrem dentro deles. */
export function getVisibleModules(context: ModuleAccessContext, manifests: readonly ModuleManifest[]) {
  return manifests.filter(manifest => !manifest.department && manifest.menu.enabled && canAccessModule(context, manifest));
}

export function getCatalogModules(context: ModuleAccessContext, manifests: readonly ModuleManifest[]) {
  const topLevel = manifests.filter(manifest => !manifest.department);
  if (context.isOwner) return topLevel;
  return topLevel.filter(manifest => canAccessModule(context, manifest));
}
