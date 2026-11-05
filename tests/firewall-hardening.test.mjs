import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("perímetro: cenários de plano, IPv4/6, rollback e persistência sem firewall real", () => {
  const result = spawnSync("python3", [new URL("./helpers/firewall-scenarios.py", import.meta.url).pathname], { encoding: "utf8", timeout: 20_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 11 tests/);
});

test("perímetro: procedimento legado recusa aplicação sem executar comandos", () => {
  const script = new URL("../infra/harden-supabase.sh", import.meta.url);
  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source, /\beval\b|ufw\s+--force\s+reset|docker\s+compose\s+up/);
  const result = spawnSync("bash", [script.pathname, "--apply"], { encoding: "utf8", timeout: 2_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /recusado/);
});
