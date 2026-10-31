import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { comReserva, FalhaDoModelo, falhaDaResposta, lerRetryAfter, statusPassageiro } = await import("../lib/sara/tentativas.ts");
const { conversarCom } = await import("../lib/sara/laco.ts");
const { modeloReserva } = await import("../lib/sara/modelos.ts");

const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5";
const semEspera = async () => undefined;
const resposta = (status, corpo, headers = {}) => ({ ok: status < 400, status, json: async () => corpo, headers: { get: (h) => headers[h] ?? null } });
const fimDeTexto = (texto) => resposta(200, { content: [{ type: "text", text: texto }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
const pedeConsulta = (id) => resposta(200, { content: [{ type: "tool_use", id, name: "consulta_teste", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } });
const conta = (n, ferramentas = []) => ({ chave: "k", modelo: n, sistema: "s", historico: [], pergunta: "p", ferramentas });
const consulta = (rodar) => ({ nome: "consulta_teste", descricao: "d", esquema: { type: "object", properties: {} }, rodar });

test("I-20: Haiku e Sonnet são reserva um do outro; 402, 400, 401, 403 e 404 não são passageiros", () => {
  assert.equal(modeloReserva(HAIKU), SONNET);
  assert.equal(modeloReserva(SONNET), HAIKU);
  for (const s of [408, 429, 500, 503, 529]) assert.equal(statusPassageiro(s), true, s);
  for (const s of [400, 401, 402, 403, 404, 413]) assert.equal(statusPassageiro(s), false, s);
  assert.equal(lerRetryAfter("3"), 3000);
  assert.equal(lerRetryAfter(null), null);
  assert.equal(lerRetryAfter("amanhã"), null);
});

test("I-20: passageira repete uma vez no mesmo modelo e não troca se der certo", async () => {
  const chamados = [];
  const r = await comReserva({ modelo: HAIKU, reserva: SONNET, esperar: semEspera, chamar: async (m) => {
    chamados.push(m);
    if (chamados.length === 1) throw falhaDaResposta(529, "overloaded");
    return "ok";
  } });
  assert.deepEqual(chamados, [HAIKU, HAIKU]);
  assert.equal(r.modelo, HAIKU);
  assert.deepEqual(r.falhas, [{ modelo: HAIKU, motivo: "529 overloaded" }]);
});

test("I-20: duas falhas passam ao reserva", async () => {
  const chamados = [];
  const r = await comReserva({ modelo: SONNET, reserva: HAIKU, esperar: semEspera, chamar: async (m) => {
    chamados.push(m);
    if (m === SONNET) throw falhaDaResposta(429, "limite");
    return "ok";
  } });
  assert.deepEqual(chamados, [SONNET, SONNET, HAIKU]);
  assert.equal(r.modelo, HAIKU);
  assert.equal(r.falhas.length, 2);
});

test("I-20: demora vai direto ao reserva, e retry-after longo também", async () => {
  for (const falha of [new FalhaDoModelo("sem resposta em 60 s", { passageira: true, demorou: true }), falhaDaResposta(429, "limite", "30")]) {
    const chamados = [];
    await comReserva({ modelo: HAIKU, reserva: SONNET, esperar: semEspera, chamar: async (m) => { chamados.push(m); if (m === HAIKU) throw falha; return "ok"; } });
    assert.deepEqual(chamados, [HAIKU, SONNET]);
  }
});

test("I-20: retry-after curto é respeitado", async () => {
  const esperas = [];
  let n = 0;
  await comReserva({ modelo: HAIKU, reserva: SONNET, esperar: async (ms) => { esperas.push(ms); }, chamar: async () => { if (!n++) throw falhaDaResposta(429, "limite", "3"); return "ok"; } });
  assert.deepEqual(esperas, [3000]);
});

test("I-20: chave errada ou modelo inexistente não acionam o reserva", async () => {
  for (const status of [401, 404]) {
    const chamados = [];
    await assert.rejects(comReserva({ modelo: HAIKU, reserva: SONNET, esperar: semEspera, chamar: async (m) => { chamados.push(m); throw falhaDaResposta(status, "recusado"); } }), new RegExp(`MODELO_INDISPONIVEL: ${status}`));
    assert.deepEqual(chamados, [HAIKU]);
  }
});

test("I-20: os dois fora do ar: o erro lista os motivos", async () => {
  await assert.rejects(comReserva({ modelo: HAIKU, reserva: SONNET, esperar: semEspera, chamar: async () => { throw falhaDaResposta(529, "overloaded"); } }),
    (e) => e.message.startsWith("MODELO_INDISPONIVEL") && e.message.includes(HAIKU) && e.message.includes(SONNET));
});

test("I-20: cancelada durante a espera não chama de novo", async () => {
  const ctrl = new AbortController();
  let n = 0;
  await assert.rejects(comReserva({ modelo: HAIKU, reserva: SONNET, sinal: ctrl.signal, esperar: async () => ctrl.abort(), chamar: async () => { n++; throw falhaDaResposta(529, "x"); } }), /CANCELADA/);
  assert.equal(n, 1);
});

test("I-20 no laço: troca na 2ª rodada, consulta não roda de novo, fica no reserva e registra", async () => {
  const corpos = [];
  let rodou = 0;
  const buscar = async (_u, init) => {
    const b = JSON.parse(init.body);
    corpos.push(b);
    if (corpos.length === 1) return pedeConsulta("t1");
    if (b.model === HAIKU) return resposta(529, { error: { message: "overloaded" } });
    if (corpos.filter((c) => c.model === SONNET).length === 1) return pedeConsulta("t2");
    return fimDeTexto("pronto");
  };
  const r = await conversarCom({}, { ...conta(HAIKU, [consulta(async () => { rodou++; return { dados: { ok: 1 }, fontes: [] }; })]), buscar });
  assert.equal(r.texto, "pronto");
  assert.equal(r.modelo, SONNET, "o registro leva o modelo que respondeu (o custo sai dele)");
  assert.equal(rodou, 2, "uma consulta por pedido do modelo, sem repetir");
  assert.deepEqual(corpos.map((c) => c.model), [HAIKU, HAIKU, HAIKU, SONNET, SONNET]);
  assert.deepEqual(r.falhasDoModelo.map((f) => f.modelo), [HAIKU, HAIKU]);
  assert.deepEqual(corpos[0].thinking, { type: "disabled" });
  assert.deepEqual(corpos[3].thinking, { type: "between_tools" }, "disabled no Sonnet 5.5 dá 400");
});

test("I-20 no laço: chave recusada falha na hora, sem reserva", async () => {
  let n = 0;
  await assert.rejects(conversarCom({}, { ...conta(HAIKU), buscar: async () => { n++; return resposta(401, { error: { message: "chave inválida" } }); } }), /MODELO_INDISPONIVEL: 401 chave inválida/);
  assert.equal(n, 1);
});

test("I-20 no laço: 200 sem conteúdo conta como falha passageira", async () => {
  let n = 0;
  const r = await conversarCom({}, { ...conta(HAIKU), buscar: async () => (++n === 1 ? resposta(200, {}) : fimDeTexto("ok")) });
  assert.equal(r.texto, "ok");
  assert.equal(r.modelo, HAIKU);
});
