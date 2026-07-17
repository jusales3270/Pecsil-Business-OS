import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

test("SDK valida um módulo em dry-run sem gravar arquivos", () => {
  const result = spawnSync(process.execPath, [
    "scripts/create-module.mjs",
    "--code", "sdk_demo",
    "--name", "Módulo de Validação",
    "--description", "Domínio temporário usado para validar o gerador oficial.",
    "--short", "SD",
    "--dry-run",
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /modules\/sdk_demo\/manifest\.ts/);
  assert.match(result.stdout, /registro central e runtime serão atualizados/);
});

test("SDK rejeita código inseguro", () => {
  const result = spawnSync(process.execPath, [
    "scripts/create-module.mjs",
    "--code", "../invalido",
    "--name", "Módulo Inválido",
    "--description", "Tentativa que deve ser rejeitada pelo contrato de segurança.",
  ], { cwd: root, encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--code deve usar letras minúsculas/);
});
