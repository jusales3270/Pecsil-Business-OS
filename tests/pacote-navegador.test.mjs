import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// O que a página (componente do navegador) importa vai inteiro para o navegador, inclusive o import dinâmico.
// Código só do servidor (a chave de serviço do banco, "server-only") ali quebra a página e o build: em 10/11/2026
// lib/tarefas/sara.ts entrou pelo caminho page.tsx → modulos → agentes → acoes.ts e derrubou a tela inteira.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const achar = (de, alvo) => { const base = resolve(dirname(de), alvo); for (const e of EXT) if (existsSync(base + e) && !base.endsWith("/") && (e || /\.[a-z]+$/.test(base))) return base + e; return null; };

function alcancados(inicio) {
  const vistos = new Set(), fila = [inicio];
  while (fila.length) {
    const f = fila.pop();
    if (vistos.has(f)) continue;
    vistos.add(f);
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const alvos = [...src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*["']([^"']+)["']/g), ...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g), ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)]
      .map((m) => m[1]).filter((a) => a.startsWith("."));
    for (const a of alvos) { const r = achar(f, a); if (r && !vistos.has(r)) fila.push(r); }
  }
  return vistos;
}

test("o pacote do navegador (app/page.tsx) não leva código só do servidor", () => {
  const todos = alcancados(join(RAIZ, "app/page.tsx"));
  assert.ok(todos.size > 50, `o percurso achou poucos arquivos (${todos.size})`);
  const proibidos = [...todos].filter((f) => /lib\/supabase\/admin\.ts$/.test(f) || /^\s*import\s+["']server-only["']/m.test(readFileSync(f, "utf8"))).map((f) => relative(RAIZ, f));
  assert.deepEqual(proibidos, [], "estes arquivos só do servidor entraram no pacote do navegador");
  assert.ok(!todos.has(join(RAIZ, "lib/sara/acoes.ts")), "acoes.ts é do servidor: os agentes usam lib/sara/acoes-refazer.ts");
});
