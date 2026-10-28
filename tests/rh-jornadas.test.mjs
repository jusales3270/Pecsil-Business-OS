import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("jornadas: cadastro por empresa e número do Secullum, ligado ao colaborador", () => {
  const sql = ler("supabase/migrations/202610280004_rh_jornadas.sql");
  assert.match(sql, /unique \(organization_id, numero\)/);
  assert.match(sql, /add column if not exists jornada_id uuid references public\.rh_jornadas\(id\) on delete set null/);
  assert.match(sql, /has_feature\('rh\.colaboradores', 'operar'\)/, "grava quem opera Colaboradores");
});

test("jornadas: a carga do Secullum tem 13 horários e 63 matrículas, sem repetir ninguém", () => {
  const s = ler("scripts/import-rh-jornadas-secullum.mjs");
  const bloco = s.slice(s.indexOf("const JORNADAS = {"), s.indexOf("};", s.indexOf("const JORNADAS = {")));
  const linhas = [...bloco.matchAll(/^\s+(\d+): \["([^"]+)", \[([\d, ]+)\]\]/gm)];
  assert.equal(linhas.length, 13);
  const matriculas = linhas.flatMap((l) => l[3].split(",").map((x) => Number(x.trim())));
  assert.equal(matriculas.length, 63);
  assert.equal(new Set(matriculas).size, 63, "cada colaborador em uma jornada só");
  assert.match(s, /const apply = args\.includes\("--apply"\)/, "simula por padrão");
});

test("jornadas: a tela usa a lista do banco (sem 'Turno A' fixo) e exige a jornada", () => {
  const tela = ler("app/components/hr-module.tsx");
  assert.doesNotMatch(tela, /<option>Turno A<\/option>/);
  assert.match(tela, /fetch\("\/api\/rh\/jornadas"/);
  assert.match(tela, /<span>Jornada \*<\/span>/);
  assert.match(tela, /jornadaOk/);
});
