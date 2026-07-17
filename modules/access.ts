import type { ModuleManifest, ModuleScope } from "./types";
import { hasAnyPermission, hasPermission } from "./access-policy";

export type ModuleAccessContext = {
  userId: string;
  name: string;
  initials: string;
  role: string;
  scopeLabel: string;
  permissions: readonly string[];
  scopes: readonly {
    type: ModuleScope;
    referenceId?: string;
    moduleCode?: string;
  }[];
};

export const demoOwnerAccess: ModuleAccessContext = {
  userId: "demo-owner",
  name: "Júnior Sales",
  initials: "JS",
  role: "Proprietário",
  scopeLabel: "Toda a empresa",
  permissions: ["*"],
  scopes: [{ type:"company" }],
};

export { hasAnyPermission, hasPermission };

export function canAccessModule(context: ModuleAccessContext, manifest: ModuleManifest) {
  if (!manifest.enabled) return false;
  if (!hasPermission(context, manifest.access.entryPermission)) return false;
  return context.scopes.some(scope => scope.type !== "module" || !scope.moduleCode || scope.moduleCode === manifest.code);
}

export function getVisibleModules(context: ModuleAccessContext, manifests: readonly ModuleManifest[]) {
  return manifests.filter(manifest => manifest.menu.enabled && canAccessModule(context, manifest));
}

export function getCatalogModules(context: ModuleAccessContext, manifests: readonly ModuleManifest[]) {
  if (context.role === "Proprietário" || context.permissions.includes("platform.modules.view")) return [...manifests];
  return manifests.filter(manifest => canAccessModule(context, manifest));
}
