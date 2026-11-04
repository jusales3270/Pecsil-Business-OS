import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);
function checar(caso, ambiente = {}) {
  const result = spawnSync(process.execPath, ["--import", new URL("./helpers/perimeter-network-stub.mjs", import.meta.url).pathname, new URL("../scripts/check-perimeter.mjs", import.meta.url).pathname], {
    cwd: root, encoding: "utf8", timeout: 3_000,
    env: { ...process.env, HOST: "perimeter.example.test", TIMEOUT: "25", TARGET_IPS: "", NO_PUBLIC_IPV4: "0", NO_PUBLIC_IPV6: "0", PERIMETER_TEST_CASE: caso, ...ambiente },
  });
  assert.equal(result.error, undefined);
  const trace = result.stdout.match(/^PERIMETER_MOCK (.+)$/m)?.[1];
  return { ...result, sockets: trace ? JSON.parse(trace) : [], output: result.stdout.replace(/\x1b\[[0-9;]*m/g, "") };
}

test("perímetro: audita todos os destinos e oito portas em IPv4/IPv6, com identidade TLS", () => {
  const r = checar("dual"); assert.equal(r.status, 0, r.stderr);
  for (const ip of ["198.51.100.1", "2001:db8::1"]) {
    assert.deepEqual(r.sockets.filter((s) => s.address === ip && !s.tls).map((s) => s.port).sort((a, b) => a - b), [443, 3000, 3100, 3200, 5432, 6543, 8000, 8001, 8443]);
    assert.equal(r.sockets.find((s) => s.address === ip && s.tls)?.servername, "perimeter.example.test");
  }
});
for (const caso of ["v4-only", "v6-only"]) {
  test(`perímetro: ${caso} sem prova da família ausente retorna cobertura incompleta`, () => {
    const r = checar(caso); assert.equal(r.status, 2); assert.match(r.output, /Cobertura incompleta/);
  });
}
test("perímetro: operador pode declarar família pública ausente, mas não contradizer destinos", () => {
  assert.equal(checar("v4-only", { NO_PUBLIC_IPV6: "1" }).status, 0);
  assert.equal(checar("v6-only", { NO_PUBLIC_IPV4: "1" }).status, 0);
  const r = checar("dual", { NO_PUBLIC_IPV6: "1" });
  assert.equal(r.status, 1); assert.match(r.stderr, /não pode ser declarado ausente/); assert.equal(r.sockets.length, 0);
});
test("perímetro: endereço explícito completa DNS sem AAAA e alvo inválido é recusado", () => {
  assert.equal(checar("v4-only", { TARGET_IPS: "2001:db8::1" }).status, 0);
  const r = checar("dual", { TARGET_IPS: "host-invalido" }); assert.equal(r.status, 1); assert.equal(r.sockets.length, 0);
});
for (const caso of ["dns-fails", "empty", "local-error", "invalid-tls", "exposed", "tls-close", "tls-stall"]) {
  test(`perímetro: ${caso} falha sem tratar indisponibilidade como porta protegida`, () => {
    const r = checar(caso); assert.equal(r.status, 1, r.stderr + r.output);
    assert.match(r.output, /problema\(s\) de perímetro/);
    assert.doesNotMatch(r.output, /Destinos informados testados sem acesso TCP sensível/);
  });
}
test("perímetro: portas filtradas com HTTPS saudável têm resultado limitado ao observado", () => {
  const r = checar("filtered"); assert.equal(r.status, 0); assert.match(r.output, /sem resposta \(filtrada\)/);
});
