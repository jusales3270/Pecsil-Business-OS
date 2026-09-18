export { moduleRegistry, getModuleById } from "./registry";
export { canAccessModule, demoOwnerAccess, getCatalogModules, getVisibleModules, hasAnyPermission, hasPermission } from "./access";
export type { ModuleAccessContext } from "./access";
export { renderModuleComponent } from "./runtime";
export type { ModuleRuntimeProps } from "./runtime";
export type { ModuleManifest, ModuleScope, ModuleStatus, SharedService } from "./types";
