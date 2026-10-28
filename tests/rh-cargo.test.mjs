import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SEM_CARGO, codigoDoCargo, nomeDoCargo } from "../lib/rh/cargo.ts";

const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("cargo: o código segue o cadastro de cargos (maiúsculas, sem acento, hífen)", () => {
  assert.equal(codigoDoCargo("Ajudante de Fundição"), "AJUDANTE-DE-FUNDICAO");
  assert.equal(codigoDoCargo("1/2 Oficial Fresador"), "1-2-OFICIAL-FRESADOR");
  assert.equal(codigoDoCargo("  auxiliar   qa "), codigoDoCargo("Auxiliar QA"), "outra grafia acha o mesmo cargo");
  assert.equal(codigoDoCargo(""), "");
  assert.equal(codigoDoCargo(null), "");
  assert.equal(nomeDoCargo("  Auxiliar   QA "), "Auxiliar QA");
});

test("cargo: cargo novo é criado pelo servidor só para quem opera Colaboradores; 'Cargo não informado' nunca vira cargo", () => {
  const m = ler("lib/data/rh-mutations.ts");
  assert.match(m, /async function ensurePosition[\s\S]*has_feature[\s\S]*rh\.colaboradores[\s\S]*operar[\s\S]*from\("positions"\)\.insert/);
  assert.match(m, /nome === SEM_CARGO/);
  assert.equal(SEM_CARGO, "Cargo não informado");
  assert.match(ler("lib/data/foundation-repository.ts"), /relationName\(row\.positions, "Cargo não informado"\)/);
  // A edição não traz o texto da ficha para dentro do campo.
  assert.match(ler("app/components/hr-module.tsx"), /role: employee\.role === SEM_CARGO \? "" : employee\.role/);
});
