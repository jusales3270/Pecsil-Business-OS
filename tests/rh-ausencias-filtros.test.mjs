import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("ausências: filtros no cabeçalho (nome, tipo, situação) e sem o filtro de Status do canto", () => {
  const tela = ler("app/components/hr-module.tsx");
  assert.doesNotMatch(tela, /aria-label="Filtrar solicitações por status"/);
  assert.match(tela, /<AbsenceNameFilter /);
  assert.match(tela, /aria-label="Filtrar por tipo"/);
  assert.match(tela, /aria-label="Filtrar por situação"/);
  // Nomes sugeridos só a partir da 3ª letra.
  assert.match(tela, /query\.length >= 3 \? names\.filter/);
  // O que a busca traz não entra nos indicadores nem na lista sem filtro.
  assert.match(tela, /const loaded = records\.filter\(record => !record\.fromSearch\)/);
});

test("ausências: a rota filtra no histórico inteiro, valida a entrada e soma a duração de todas", () => {
  const rota = ler("app/api/rh/ausencias/route.ts");
  assert.match(rota, /name\.length < 3/);
  assert.match(rota, /!TYPES\.has\(type\)/);
  assert.match(rota, /!STATUSES\.has\(status\)/);
  const repo = ler("lib/data/rh-repository.ts");
  assert.match(repo, /export async function searchRhAbsences/);
  assert.match(repo, /range\(from, from \+ 999\)/, "soma em páginas de 1.000 (limite do servidor)");
  assert.match(repo, /ABSENCE_SEARCH_LIMIT = 500/);
});
