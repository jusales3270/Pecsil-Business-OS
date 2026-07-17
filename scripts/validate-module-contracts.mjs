import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const modulesRoot = resolve(root, "modules");
const entries = await readdir(modulesRoot, { withFileTypes: true });
const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "node_modules");
const errors = [];
const ids = new Set();
const routes = new Set();

for (const entry of moduleDirs) {
  const manifestPath = resolve(modulesRoot, entry.name, "manifest.ts");
  let manifest;
  try {
    manifest = await readFile(manifestPath, "utf8");
  } catch {
    continue;
  }

  const id = match(manifest, /\bid:\s*["']([^"']+)["']/);
  const code = match(manifest, /\bcode:\s*["']([^"']+)["']/);
  const route = match(manifest, /\broute:\s*["']([^"']+)["']/);
  if (!id || !code || !route) errors.push(`${entry.name}: id, code ou route ausente no manifesto.`);
  if (id && ids.has(id)) errors.push(`${entry.name}: id duplicado (${id}).`);
  if (route && routes.has(route)) errors.push(`${entry.name}: rota duplicada (${route}).`);
  if (id) ids.add(id);
  if (route) routes.add(route);
  if (code && code !== entry.name) errors.push(`${entry.name}: code deve ser igual ao nome do diretório.`);
  if (route && !route.startsWith("/modules/")) errors.push(`${entry.name}: rota fora de /modules/.`);
  if (!manifest.includes("entryPermission:")) errors.push(`${entry.name}: permissão de entrada ausente.`);
  if (!manifest.includes("sharedServices:")) errors.push(`${entry.name}: serviços compartilhados ausentes.`);
  if (!manifest.includes("auditEvents:")) errors.push(`${entry.name}: eventos de auditoria ausentes.`);

  try {
    await readFile(resolve(modulesRoot, entry.name, "permissions.ts"), "utf8");
  } catch {
    errors.push(`${entry.name}: permissions.ts ausente.`);
  }
}

if (errors.length) {
  console.error("Contratos de módulos inválidos:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`Contratos válidos: ${ids.size} módulo(s), ${routes.size} rota(s) e nenhuma duplicidade.`);

function match(source, pattern) {
  return source.match(pattern)?.[1] ?? null;
}
