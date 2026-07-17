import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const code = required(options.code, "--code");
const name = required(options.name, "--name");
const description = required(options.description, "--description");

if (!/^[a-z][a-z0-9_]*$/.test(code)) fail("--code deve usar letras minúsculas, números ou sublinhado e começar com uma letra.");
if (name.length < 3 || name.length > 60) fail("--name deve possuir entre 3 e 60 caracteres.");
if (description.length < 12 || description.length > 180) fail("--description deve possuir entre 12 e 180 caracteres.");

const short = String(options.short || initials(name)).toUpperCase();
if (!/^[A-Z0-9]{2,4}$/.test(short)) fail("--short deve possuir de 2 a 4 letras ou números.");

const icon = String(options.icon || "modules");
const color = String(options.color || "blue");
const allowedColors = ["blue", "teal", "orange", "purple", "green", "red"];
if (!allowedColors.includes(color)) fail(`--color inválida. Use: ${allowedColors.join(", ")}.`);

const route = String(options.route || `/modules/${code}`);
if (!/^\/modules\/[a-z][a-z0-9_/-]*$/.test(route)) fail("--route deve começar com /modules/ e conter somente caracteres seguros.");

const moduleDir = resolve(root, "modules", code);
if (existsSync(moduleDir)) fail(`O módulo ${code} já existe em modules/${code}.`);

const plannedSource = await readFile(resolve(root, "modules/planned.ts"), "utf8");
if (new RegExp(`(?:id|code):["']${escapeRegex(code)}["']`).test(plannedSource)) {
  fail(`O código ${code} já existe no catálogo de módulos planejados. Migre-o antes de gerar uma nova estrutura.`);
}

const symbol = toPascalCase(code);
const constant = code.toUpperCase();
const files = buildFiles({ code, name, description, short, icon, color, route, symbol, constant });

if (options.dryRun) {
  console.log(`Plano de geração para ${name} (${code}):`);
  for (const path of Object.keys(files)) console.log(`- modules/${code}/${path}`);
  console.log(options.noRegister ? "- sem registro central (--no-register)" : "- registro central e runtime serão atualizados");
  process.exit(0);
}

await mkdir(resolve(moduleDir, "components"), { recursive: true });
await mkdir(resolve(moduleDir, "data"), { recursive: true });
await mkdir(resolve(moduleDir, "tests"), { recursive: true });
for (const [path, content] of Object.entries(files)) {
  await writeFile(resolve(moduleDir, path), content, { flag: "wx" });
}

if (!options.noRegister) {
  await updateFile(
    "modules/registry.ts",
    "// module-generator:imports",
    `import { ${symbol}ModuleManifest } from "./${code}/manifest";`,
  );
  await updateFile(
    "modules/registry.ts",
    "// module-generator:entries",
    `  ${symbol}ModuleManifest,`,
  );
  await updateFile(
    "modules/runtime.tsx",
    "// module-generator:imports",
    `import { ${symbol}Module } from "./${code}/components/${code}-module";`,
  );
  await updateFile(
    "modules/runtime.tsx",
    "// module-generator:entries",
    `  ${code}: ${symbol}Module,`,
  );
}

console.log(`Módulo ${name} criado em modules/${code}.`);
console.log("Estado inicial: planejado, desativado e oculto do menu.");
console.log("Próximo passo: implemente o domínio, rode npm run modules:validate e somente depois revise a ativação.");

function buildFiles(values) {
  const { code, name, description, short, icon, color, route, symbol, constant } = values;
  return {
    "manifest.ts": `import { defineModule } from "../types";\nimport { ${constant}_PERMISSIONS } from "./permissions";\n\nexport const ${symbol}ModuleManifest = defineModule({\n  id: "${code}",\n  code: "${code}",\n  name: "${escapeString(name)}",\n  short: "${short}",\n  description: "${escapeString(description)}",\n  desc: "${escapeString(description)}",\n  route: "${route}",\n  version: "0.1.0",\n  icon: "${icon}",\n  color: "${color}",\n  status: "Planejado",\n  tone: "neutral",\n  progress: 0,\n  enabled: false,\n  menu: { enabled: false, order: 100 },\n  access: {\n    entryPermission: ${constant}_PERMISSIONS.view,\n    permissions: Object.values(${constant}_PERMISSIONS),\n    scopes: ["company", "unit", "department", "team"],\n  },\n  sharedServices: ["identity", "organization", "documents", "notifications", "audit", "search"],\n  auditEvents: ["${code}.record.view", "${code}.record.update", "${code}.report.export"],\n});\n`,
    "permissions.ts": `export const ${constant}_PERMISSIONS = {\n  view: "${code}.view",\n  create: "${code}.create",\n  edit: "${code}.edit",\n  approve: "${code}.approve",\n  export: "${code}.export",\n  admin: "${code}.admin",\n} as const;\n\nexport type ${symbol}Permission = (typeof ${constant}_PERMISSIONS)[keyof typeof ${constant}_PERMISSIONS];\n`,
    [`components/${code}-module.tsx`]: `"use client";\n\nimport { Button, Card, Status } from "../../../packages/design-system";\nimport type { ModuleRuntimeProps } from "../../runtime";\n\nexport function ${symbol}Module({ notify, onExit }: ModuleRuntimeProps) {\n  return <div>\n    <div className="page-head"><div><p className="eyebrow">MÓDULO ${short}</p><h1>${escapeString(name)}</h1><p>${escapeString(description)}</p></div><Button variant="secondary" onClick={onExit}>Voltar ao ecossistema</Button></div>\n    <Card className="data-card"><div className="card-head"><div><h2>Estrutura inicial</h2><p>Substitua este conteúdo pelas particularidades do domínio.</p></div><Status>Planejado</Status></div><Button onClick={() => notify("Fluxo demonstrativo do módulo ${escapeString(name)}.")}>Testar interação</Button></Card>\n  </div>;\n}\n`,
    "data/README.md": `# Dados de ${name}\n\nImplemente repositórios e adaptadores deste domínio aqui. O módulo deve consumir identidade, organização e auditoria da Fundação, sem duplicar cadastros centrais.\n`,
    "tests/contract.test.mjs": `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst manifest = await readFile(new URL("../manifest.ts", import.meta.url), "utf8");\n\ntest("${code}: inicia desativado e protegido", () => {\n  assert.match(manifest, /id: "${escapeRegex(code)}"/);\n  assert.match(manifest, /entryPermission: ${constant}_PERMISSIONS\\.view/);\n  assert.match(manifest, /enabled: false/);\n  assert.match(manifest, /menu: \\{ enabled: false/);\n});\n`,
    "README.md": `# ${name}\n\n${description}\n\n## Estado inicial\n\n- Versão: 0.1.0\n- Rota: \`${route}\`\n- Permissão de entrada: \`${code}.view\`\n- Estado: planejado e desativado\n\n## Regras\n\n- Não duplicar identidade, estrutura organizacional, documentos, notificações ou auditoria.\n- Toda ação deve validar permissão e escopo.\n- Manter \`enabled: false\` e \`menu.enabled: false\` até a homologação.\n- Registrar eventos críticos listados no manifesto.\n`,
  };
}

async function updateFile(relativePath, marker, line) {
  const path = resolve(root, relativePath);
  const source = await readFile(path, "utf8");
  if (!source.includes(marker)) fail(`Marcador ausente em ${relativePath}: ${marker}`);
  if (source.includes(line)) fail(`Registro duplicado em ${relativePath}: ${line}`);
  await writeFile(path, source.replace(marker, `${marker}\n${line}`));
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--help" || item === "-h") parsed.help = true;
    else if (item === "--dry-run") parsed.dryRun = true;
    else if (item === "--no-register") parsed.noRegister = true;
    else if (item.startsWith("--")) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail(`Valor ausente para ${item}.`);
      parsed[key] = value;
      index += 1;
    } else fail(`Argumento desconhecido: ${item}`);
  }
  return parsed;
}

function required(value, flag) {
  if (!value) fail(`Parâmetro obrigatório ausente: ${flag}.`);
  return String(value).trim();
}

function initials(value) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("");
}

function toPascalCase(value) {
  return value.split(/[_-]/).map(part => part[0].toUpperCase() + part.slice(1)).join("");
}

function escapeString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHelp() {
  console.log(`Pecsil Module SDK\n\nUso:\n  npm run module:create -- --code manutencao --name "Manutenção" --description "Gestão de ativos e ordens de manutenção." [opções]\n\nOpções:\n  --short MT          Sigla de 2 a 4 caracteres\n  --icon settings     Ícone do Design System\n  --color orange      Cor: blue, teal, orange, purple, green ou red\n  --route /modules/x  Rota contratada\n  --dry-run           Valida e exibe o plano sem gravar arquivos\n  --no-register       Gera os arquivos sem alterar registry e runtime\n`);
}

function fail(message) {
  console.error(`Geração interrompida: ${message}`);
  process.exit(1);
}
