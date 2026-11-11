import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chamarClaude, entradaDe, textoDe } from "../lib/sara/motor/anthropic.ts";

const corpo = { model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "oi" }] };
const mensagem = (content) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } });

test("motor: a resposta chega pelo SDK; o pedido sai com a versão nova da API, sem repetir sozinho", async () => {
  const pedidos = [];
  const buscar = async (url, init) => {
    pedidos.push({ url: String(url), cabecalhos: new Headers(init.headers), corpo: JSON.parse(init.body) });
    return new Response(JSON.stringify(mensagem([{ type: "text", text: "DENTRO" }, { type: "tool_use", id: "t1", name: "anotar", input: { resumo: "x" } }])), { status: 200, headers: { "content-type": "application/json" } });
  };
  const r = await chamarClaude(corpo, { chave: "sk-teste", buscar, timeoutMs: 5000 });
  assert.equal(r.ok, true);
  assert.equal(textoDe(r.mensagem), "DENTRO");
  assert.deepEqual(entradaDe(r.mensagem, "anotar"), { resumo: "x" });
  assert.equal(entradaDe(r.mensagem, "outra"), null);
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(pedidos[0].cabecalhos.get("anthropic-version"), "2026-10-21", "SDK 1.x: versão 2026-10-21");
  assert.deepEqual(pedidos[0].corpo, corpo, "o corpo vai exatamente como a plataforma montou");
});

test("motor: falha da API volta como dado (status, mensagem, retry-after), sem nova tentativa do SDK", async () => {
  let vezes = 0;
  const sobrecarga = async () => { vezes++; return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "content-type": "application/json", "retry-after": "3" } }); };
  const r = await chamarClaude(corpo, { chave: "x", buscar: sobrecarga, timeoutMs: 5000 });
  assert.deepEqual({ ok: r.ok, status: r.status, erro: r.erro, retryAfter: r.retryAfter, demorou: r.demorou, rede: r.rede }, { ok: false, status: 529, erro: "Overloaded", retryAfter: "3", demorou: false, rede: false });
  assert.equal(vezes, 1, "a nova tentativa é da plataforma (tentativas.ts), não do SDK");
  const chave = await chamarClaude(corpo, { chave: "x", buscar: async () => new Response(JSON.stringify({ type: "error", error: { message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } }), timeoutMs: 5000 });
  assert.equal(chave.status, 401);
  assert.equal(chave.erro, "invalid x-api-key");
  // A forma curta dos testes ({ ok, status, json }) também vale.
  const curta = await chamarClaude(corpo, { chave: "x", buscar: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) }), timeoutMs: 5000 });
  assert.equal(curta.status, 500);
});

test("motor: rede, demora e cancelamento", async () => {
  const rede = await chamarClaude(corpo, { chave: "x", buscar: async () => { throw new TypeError("fetch failed"); }, timeoutMs: 5000 });
  assert.equal(rede.ok, false); assert.equal(rede.rede, true);
  const lenta = (_u, init) => new Promise((_ok, falha) => init.signal.addEventListener("abort", () => falha(Object.assign(new Error("abortado"), { name: "AbortError" }))));
  const demora = await chamarClaude(corpo, { chave: "x", buscar: lenta, timeoutMs: 50 });
  assert.equal(demora.ok, false); assert.equal(demora.demorou, true);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(chamarClaude(corpo, { chave: "x", buscar: lenta, timeoutMs: 5000, sinal: ctrl.signal }), /CANCELADA/);
});

test("motor: só lib/sara/motor/anthropic.ts importa o SDK e ninguém mais chama a API direto", () => {
  const raiz = fileURLToPath(new URL("../", import.meta.url));
  const arquivos = [];
  const andar = (d) => { for (const n of readdirSync(d)) { const c = join(d, n); if (statSync(c).isDirectory()) { if (!["node_modules", ".next", ".git"].includes(n)) andar(c); } else if (/\.(ts|tsx|mjs)$/.test(n)) arquivos.push(c); } };
  for (const d of ["lib", "app", "modules", "scripts", "services"]) andar(join(raiz, d));
  const comSdk = arquivos.filter((f) => /from ["']@anthropic-ai\/sdk/.test(readFileSync(f, "utf8"))).map((f) => f.slice(raiz.length));
  assert.deepEqual(comSdk, ["lib/sara/motor/anthropic.ts"]);
  const diretas = arquivos.filter((f) => readFileSync(f, "utf8").includes("api.anthropic.com/v1/messages")).map((f) => f.slice(raiz.length));
  assert.deepEqual(diretas, []);
});
