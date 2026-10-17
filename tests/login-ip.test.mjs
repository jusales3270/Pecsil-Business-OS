import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ipDaRequest } from "../lib/auth/ip-login.ts";

const h = (o) => new Headers(o);

test("IP do login: vale o último do X-Forwarded-For (o que o proxy acrescentou)", () => {
  assert.equal(ipDaRequest(h({ "x-forwarded-for": "200.1.2.3" })), "200.1.2.3");
  // Um X-Forwarded-For forjado pelo navegador fica antes; o do proxy é o último.
  assert.equal(ipDaRequest(h({ "x-forwarded-for": "1.1.1.1, 177.10.20.30" })), "177.10.20.30");
  assert.equal(ipDaRequest(h({ "x-forwarded-for": "2804:14c:1::5" })), "2804:14c:1::5");
  assert.equal(ipDaRequest(h({ "x-forwarded-for": "::ffff:192.168.0.40" })), "192.168.0.40");
  assert.equal(ipDaRequest(h({ "x-real-ip": "192.168.0.41" })), "192.168.0.41");
  assert.equal(ipDaRequest(h({ "x-forwarded-for": "não-é-ip" })), null);
  assert.equal(ipDaRequest(h({})), null);
});

test("IP do login: gravado nos dois logins e mostrado na Auditoria, sem acesso direto", () => {
  const gw = readFileSync(new URL("../app/sb/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(gw, /grant_type"\) === "password" && upstream\.ok/);
  assert.match(gw, /via: "senha"/);
  const dig = readFileSync(new URL("../app/api/auth/digital/login/route.ts", import.meta.url), "utf8");
  assert.match(dig, /registrarIpDoLogin\(admin, \{ userId: chave\.user_id, headers: request\.headers, via: "digital" \}\)/);
  const sql = readFileSync(new URL("../supabase/migrations/202610170006_login_ip.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on public\.login_ips from anon, authenticated/);
  assert.match(sql, /left join lateral \(\s*select x\.ip, x\.user_agent, x\.via from public\.login_ips x/);
});
