import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { origemDoPedido, ehCelularOuTablet, nomeDoAparelho, MAX_APARELHOS } = await import("../lib/auth/digital-regras.ts");
const sql = readFileSync(new URL("../supabase/migrations/202610130001_acesso_digital.sql", import.meta.url), "utf8");
const ler = (c) => readFileSync(new URL(c, import.meta.url), "utf8");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const ANDROID_K = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

test("digital: só pelo endereço seguro, conferido com o Origin", () => {
  assert.deepEqual(origemDoPedido({ host: "app:3000", forwardedHost: "home.pecsil.com.br", forwardedProto: "https", origin: "https://home.pecsil.com.br" }), { rpID: "home.pecsil.com.br", origem: "https://home.pecsil.com.br" });
  assert.deepEqual(origemDoPedido({ host: "localhost:3000", origin: "http://localhost:3000" }), { rpID: "localhost", origem: "http://localhost:3000" });
  assert.match(origemDoPedido({ host: "home.pecsil.com.br", forwardedProto: "http", origin: null }).erro, /https/);
  assert.match(origemDoPedido({ host: "181.224.8.145", forwardedProto: "https", origin: null }).erro, /IP/);
  assert.match(origemDoPedido({ host: "home.pecsil.com.br", forwardedProto: "https", origin: "https://outro.site" }).erro, /origem/);
});

test("digital: no celular e no tablet (computador não), com nome amigável do aparelho", () => {
  assert.equal(ehCelularOuTablet(IPHONE), true);
  assert.equal(ehCelularOuTablet(ANDROID), true);
  assert.equal(ehCelularOuTablet(MAC), false);
  // iPad se apresenta como Mac: o que o separa é a tela de toque.
  assert.equal(ehCelularOuTablet(MAC, true), true);
  assert.equal(nomeDoAparelho(MAC, true), "iPad · Chrome");
  const TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
  assert.equal(ehCelularOuTablet(TABLET), true);
  assert.equal(nomeDoAparelho(TABLET), "Tablet Android (SM-X710) · Chrome");
  assert.equal(nomeDoAparelho(IPHONE), "iPhone · Safari");
  assert.equal(nomeDoAparelho(ANDROID), "Android (SM-S918B) · Chrome");
  assert.equal(nomeDoAparelho(ANDROID_K), "Android · Chrome");
  assert.equal(MAX_APARELHOS, 5);
});

test("digital: só a chave pública no banco; escrita só do servidor; remoção auditada", () => {
  assert.doesNotMatch(sql, /biometr[a-z]* (text|bytea)|fingerprint|private_key/i);
  assert.match(sql, /revoke insert, update, delete on public\.access_passkeys from anon, authenticated;/);
  assert.match(sql, /revoke all on public\.access_passkey_challenges from anon, authenticated;/);
  assert.match(sql, /p\.user_id = auth\.uid\(\) or \(public\.is_owner\(\) and p\.organization_id = public\.current_organization_id\(\)\)/);
  assert.match(sql, /'core\.access\.digital\.removida'/);
});

test("digital: rotas exigem verificação da pessoa e conta ativa; desafio de uso único", () => {
  const login = ler("../app/api/auth/digital/login/route.ts");
  const registro = ler("../app/api/auth/digital/registro/route.ts");
  const lib = ler("../lib/auth/digital.ts");
  for (const r of [login, registro]) assert.match(r, /requireUserVerification: true/);
  assert.match(registro, /authenticatorAttachment: "platform"/);
  assert.match(registro, /if \(!ehCelularOuTablet\(ua, toque\)\)/);
  assert.match(login, /perfil\.status !== "active"/);
  assert.match(login, /access_expires_at/);
  assert.match(login, /\.is\("revoked_at", null\)/);
  // o desafio é apagado ao ser lido (não dá para reutilizar)
  assert.match(lib, /\.from\("access_passkey_challenges"\)\.delete\(\)\.eq\("id", id\)/);
  // nada de biometria nem segredo em log
  for (const r of [login, registro, lib]) assert.doesNotMatch(r, /console\.(log|error)\([^)]*(resposta|publicKey|public_key)/);
});
