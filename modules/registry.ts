import { plannedModuleManifests } from "./planned";
import { rhModuleManifest } from "./rh/manifest";
import { financeModuleManifest } from "./financeiro/manifest";
import { comercialModuleManifest } from "./comercial/manifest";
import { comprasModuleManifest } from "./compras/manifest";
import { portariaModuleManifest } from "./portaria/manifest";
import { producaoModuleManifest } from "./producao/manifest";
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

  // Um departamento precisa existir e não pode ser, ele mesmo, área de outro:
  // a navegação só desce um nível.
  for (const manifest of manifests) {
    if (!manifest.department) continue;
    const parent = manifests.find(candidate => candidate.id === manifest.department);
    if (!parent) throw new Error(`Departamento inexistente em ${manifest.id}: ${manifest.department}`);
    if (parent.department) throw new Error(`Departamento aninhado em ${manifest.id}: ${parent.id}`);
  }

  return Object.freeze([...manifests].sort((a, b) => a.menu.order - b.menu.order || a.name.localeCompare(b.name)));
}

export const moduleRegistry = createRegistry([
  rhModuleManifest,
  financeModuleManifest,
  comercialModuleManifest,
  comprasModuleManifest,
  portariaModuleManifest,
  producaoModuleManifest,
  // module-generator:entries
  ...plannedModuleManifests,
]);

export function getModuleById(moduleId: string) {
  return moduleRegistry.find(module => module.id === moduleId);
}

/** Áreas que vivem dentro de um departamento (ex.: Compras dentro do Comercial). */
export function getDepartmentAreas(departmentId: string) {
  return moduleRegistry.filter(module => module.department === departmentId);
}
