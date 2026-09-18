import assert from "node:assert/strict";
import test from "node:test";
import { createForjaSession, ForjaError, toDashboardData } from "../../../lib/forja/forja-session.ts";

const painel = {
  data: {
    geradoEm: "2026-09-18T12:00:00.000Z",
    osPorStatus: { aberta: 1 },
    osPorStatusLista: { aberta: [{ id: "os1", codigoGrv: "GRV-1", prazoEntrega: "2026-10-01", prioridade: "normal", status: "aberta", quantidadeTotal: 4, cliente: { id: "c1", nome: "Cliente A" }, artigo: { codigo: "A1", descricao: "Forma", tipoProduto: "forma" } }] },
    osAtrasadas: [],
    kanban: [],
    pipelines: [],
    inspecao: {},
    paradas: { ativas: [], porMotivoHoje: {} },
    fantasmas: { opsParadas: [], turnosNaoFechados: [] },
    roteiros: [{ osId: "os1", lotes: [] }],
    clientes: [{ id: "c1", nome: "Cliente A" }],
  },
};

function jwt(expSeconds) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ exp: expSeconds })}.assinatura`;
}

function fakeForja({ loginStatus = 200, dashboardStatuses = [200] } = {}) {
  const calls = [];
  let clock = Date.parse("2026-09-18T12:00:00Z");
  let dashboardCall = 0;
  const transport = async (request) => {
    calls.push(request);
    if (request.path === "/api/auth/login") {
      return loginStatus === 200
        ? { status: 200, body: { data: { token: jwt(clock / 1000 + 12 * 3600) } } }
        : { status: loginStatus, body: { error: "invalid_credentials" } };
    }
    const status = dashboardStatuses[Math.min(dashboardCall++, dashboardStatuses.length - 1)];
    return { status, body: status === 200 ? painel : { error: "x" } };
  };
  return {
    calls,
    transport,
    now: () => clock,
    advance: (ms) => { clock += ms; },
  };
}

const credentials = { code: "integ", pin: "1234" };

test("faz login uma vez e reaproveita o token", async () => {
  const forja = fakeForja();
  const session = createForjaSession({ transport: forja.transport, credentials, now: forja.now, cacheMs: 0 });
  await session.getDashboard();
  forja.advance(60_000);
  await session.getDashboard();
  assert.equal(forja.calls.filter((c) => c.path === "/api/auth/login").length, 1);
  assert.equal(forja.calls.filter((c) => c.path === "/api/dashboard").length, 2);
  assert.ok(forja.calls.find((c) => c.path === "/api/dashboard").token);
});

test("renova o token perto do vencimento", async () => {
  const forja = fakeForja();
  const session = createForjaSession({ transport: forja.transport, credentials, now: forja.now, cacheMs: 0 });
  await session.getDashboard();
  forja.advance(12 * 3600_000 - 60_000); // a menos de 5 min do vencimento
  await session.getDashboard();
  assert.equal(forja.calls.filter((c) => c.path === "/api/auth/login").length, 2);
});

test("401 no painel refaz o login e tenta de novo uma vez", async () => {
  const forja = fakeForja({ dashboardStatuses: [401, 200] });
  const session = createForjaSession({ transport: forja.transport, credentials, now: forja.now });
  const result = await session.getDashboard();
  assert.equal(result.data.osPorStatus.aberta, 1);
  assert.equal(forja.calls.filter((c) => c.path === "/api/auth/login").length, 2);
});

test("PIN recusado segura novas tentativas por um tempo", async () => {
  const forja = fakeForja({ loginStatus: 401 });
  const session = createForjaSession({ transport: forja.transport, credentials, now: forja.now, cacheMs: 0, loginRetryMs: 60_000 });
  await assert.rejects(session.getDashboard(), (error) => error instanceof ForjaError && error.code === "AUTH_FAILED");
  await assert.rejects(session.getDashboard(), (error) => error.code === "AUTH_FAILED");
  assert.equal(forja.calls.length, 1);
  forja.advance(61_000);
  await assert.rejects(session.getDashboard());
  assert.equal(forja.calls.length, 2);
});

test("sem credenciais não chama o Forja", async () => {
  const forja = fakeForja();
  const session = createForjaSession({ transport: forja.transport, credentials: null, now: forja.now });
  await assert.rejects(session.getDashboard(), (error) => error.code === "NOT_CONFIGURED");
  assert.equal(forja.calls.length, 0);
});

test("403 vira falta do módulo Painel de Produção", async () => {
  const forja = fakeForja({ dashboardStatuses: [403] });
  const session = createForjaSession({ transport: forja.transport, credentials, now: forja.now });
  await assert.rejects(session.getDashboard(), (error) => error.code === "FORBIDDEN_MODULE");
});

test("cache curto e chamadas simultâneas agrupadas", async () => {
  const forja = fakeForja();
  const session = createForjaSession({ transport: forja.transport, credentials, now: forja.now, cacheMs: 15_000 });
  await Promise.all([session.getDashboard(), session.getDashboard(), session.getDashboard()]);
  forja.advance(10_000);
  await session.getDashboard();
  assert.equal(forja.calls.filter((c) => c.path === "/api/dashboard").length, 1);
  forja.advance(6_000);
  await session.getDashboard();
  assert.equal(forja.calls.filter((c) => c.path === "/api/dashboard").length, 2);
});

test("recorte não repassa roteiros, cadastro de clientes nem ids internos", () => {
  const data = toDashboardData(painel);
  assert.equal("roteiros" in data, false);
  assert.equal("clientes" in data, false);
  assert.deepEqual(data.osPorStatusLista.aberta[0].cliente, { nome: "Cliente A" });
  assert.equal(data.indicadores.historico.pontualidade, null);
  assert.deepEqual(data.enviosExternos, []);
});

test("resposta fora do formato do Forja é rejeitada", () => {
  assert.throws(() => toDashboardData({ message: "ok" }), (error) => error.code === "BAD_RESPONSE");
});
