import { plannedModuleManifests } from "./planned";
import { rhModuleManifest } from "./rh/manifest";
import { financeModuleManifest } from "./financeiro/manifest";
import { comprasModuleManifest } from "./compras/manifest";
import { portariaModuleManifest } from "./portaria/manifest";
import type { ModuleManifest } from "./types";
// module-generator:imports

function createRegistry(manifests: readonly ModuleManifest[]) {
  const ids = new Set<string>();
  const routes = new Set<string>();

  for (const manifest of manifests) {
    if (ids.has(manifest.id)) throw new Error(`Módulo duplicado: ${manifest.id}`);
    if (routes.has(manifest.route)) throw new Error(`Rota de módulo duplicada: ${manifest.route}`);
    ids.add(manifest.id);
    routes.add(manifest.route);
  }

  return Object.freeze([...manifests].sort((a, b) => a.menu.order - b.menu.order || a.name.localeCompare(b.name)));
}

export const moduleRegistry = createRegistry([
  rhModuleManifest,
  financeModuleManifest,
  comprasModuleManifest,
  portariaModuleManifest,
  // module-generator:entries
  ...plannedModuleManifests,
]);

export function getModuleById(moduleId: string) {
  return moduleRegistry.find(module => module.id === moduleId);
}
