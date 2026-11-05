import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import "./ts-resolver.mjs";
registerHooks({ resolve(s, c, next) { return s === "server-only" ? { url: "data:text/javascript,export default {}", shortCircuit: true } : next(s, c); } });
const { identidadeSara, usoDoMes, registrarNoServidor, reservarTranscricao } = await import("../lib/sara/uso-servidor.ts");
const pessoa = { rpc: async (n) => ({ data: n === "current_profile_id" ? "perfil-A" : "empresa-A", error: null }) };
test("SARA usage rejects missing, failed, negative, fractional and unsafe totals", async () => {
  for (const r of [{ data: null }, { data: 0, error: { message: "DB down" } }, { data: -1 }, { data: "2147483648" + "00000000" }, { data: "NaN" }, { data: 1.2 }]) {
    await assert.rejects(usoDoMes({ rpc: async () => r }, "warroom"));
  }
  assert.equal(await usoDoMes({ rpc: async () => ({ data: "4294967294", error: null }) }, "warroom"), 4294967294);
});
test("SARA ledger attribution is resolved from session, and malformed counts never reach admin", async () => {
  const calls = [];
  const admin = { rpc: async (...args) => { calls.push(args); return { data: { conversa: "C", mensagem: "M" }, error: null }; } };
  const reg = { p_conversa: null, p_modulo: "financeiro", p_pergunta: "p", p_resposta: "r", p_ferramentas: {}, p_modelo: "provedor", p_tokens_entrada: 1, p_tokens_saida: 2 };
  await registrarNoServidor(pessoa, { ...reg, p_organizacao: "empresa-B", p_perfil: "perfil-B" }, admin);
  assert.equal(calls[0][0], "sara_registrar_servidor");
  assert.equal(calls[0][1].p_organizacao, "empresa-A");
  assert.equal(calls[0][1].p_perfil, "perfil-A");
  for (const n of [-1, NaN, Infinity, 2.1, 10_000_001]) await assert.rejects(registrarNoServidor(pessoa, { ...reg, p_tokens_entrada: n }, admin));
  assert.equal(calls.length, 1);
  await assert.rejects(identidadeSara({ rpc: async () => ({ error: { message: "DB down" } }) }));
});
test("transcription debits before work and denies provider work when reservation fails", async () => {
  let call;
  await reservarTranscricao(pessoa, "rh", 20_000, { rpc: async (n, a) => { call = [n, a]; return { error: null }; } });
  assert.equal(call[0], "sara_audio_reservar");
  assert.equal(call[1].p_organizacao, "empresa-A");
  assert.equal(call[1].p_perfil, "perfil-A");
  assert.ok(call[1].p_tokens >= 5000);
  await assert.rejects(reservarTranscricao(pessoa, "rh", 20_000, { rpc: async () => ({ error: { message: "quota" } }) }));
});
