import assert from "node:assert/strict";
import test from "node:test";
import "./ts-resolver.mjs";

const { normalizePartyName, parseClients, parseOrders, similarPairs } = await import("../lib/forja/orders-core.ts");
const { createForjaSession, ForjaError } = await import("../lib/forja/forja-session.ts");

// Formato de GET /api/os do Forja (Prisma: Decimal chega como string).
const osForja = (extra = {}) => ({
  id: "os-1",
  codigoGrv: "GRV-1001",
  clienteId: "cli-1",
  artigoId: "art-1",
  quantidadeTotal: 12,
  prazoEntrega: "2026-10-15T00:00:00.000Z",
  dataAbertura: "2026-09-20T13:45:00.000Z",
  prioridade: "alta",
  status: "em_producao",
  precoUnitario: "1250.50",
  valorTotal: "15006.00",
  numeroFiscal: null,
  poCliente: "PO-77",
  statusFiscal: null,
  valorRecebido: null,
  dataNf: null,
  dataPagamento: null,
  atualizadoEm: "2026-09-25T10:00:00.000Z",
  cliente: { id: "cli-1", nome: "Vidraria Exemplo" },
  artigo: { id: "art-1", codigo: "BL-200", descricao: "Bloco 200", tipoProduto: "bloco" },
  _count: { lotes: 3 },
  ...extra,
});

test("OS do Forja vira linha do espelho, com valores separados", () => {
  const { orders, rejected } = parseOrders([osForja()]);
  assert.equal(rejected, 0);
  const [{ order, financials }] = orders;
  assert.deepEqual(order, {
    external_id: "os-1",
    code: "GRV-1001",
    external_customer_id: "cli-1",
    customer_name: "Vidraria Exemplo",
    article_code: "BL-200",
    article_description: "Bloco 200",
    product_type: "bloco",
    quantity: 12,
    due_date: "2026-10-15",
    opened_at: "2026-09-20T13:45:00.000Z",
    priority: "alta",
    status: "em_producao",
    lots_count: 3,
    source_updated_at: "2026-09-25T10:00:00.000Z",
  });
  assert.equal(financials.unit_price, 1250.5);
  assert.equal(financials.total_value, 15006);
  assert.equal(financials.customer_po, "PO-77");
  assert.equal(financials.invoice_number, null);
  // Nenhum valor vaza para a parte operacional.
  assert.ok(!("unit_price" in order) && !("total_value" in order));
});

test("OS sem id, sem código ou sem status é recusada, não inventada", () => {
  const { orders, rejected } = parseOrders([osForja(), osForja({ id: null }), osForja({ codigoGrv: "" }), osForja({ status: undefined }), "lixo"]);
  assert.equal(orders.length, 1);
  assert.equal(rejected, 4);
  assert.deepEqual(parseOrders(null), { orders: [], rejected: 0 });
});

test("NF e recebimento entram como data civil e número", () => {
  const { orders } = parseOrders([osForja({ numeroFiscal: "4512", dataNf: "2026-09-22T03:00:00.000Z", valorRecebido: 15006, dataPagamento: "2026-10-01T00:00:00.000Z" })]);
  const { financials } = orders[0];
  assert.equal(financials.invoice_number, "4512");
  assert.equal(financials.invoice_date, "2026-09-22");
  assert.equal(financials.amount_received, 15006);
  assert.equal(financials.paid_at, "2026-10-01");
});

test("clientes do Forja", () => {
  assert.deepEqual(parseClients([{ id: "c1", nome: " Nadir ", ativo: true }, { id: "c2", nome: "" }, { nome: "sem id" }]), [
    { externalId: "c1", name: "Nadir", active: true },
  ]);
});

test("normalização igual à do banco (normalize_party_name)", () => {
  // Resultados conferidos contra a função SQL em 26/09/2026.
  assert.equal(normalizePartyName("Verallia / Saint-Gobain - Campo Bom"), "verallia saint gobain campo bom");
  assert.equal(normalizePartyName("Owens-Illinois (Argentina)"), "owens illinois argentina");
  assert.equal(normalizePartyName("  NADIR  Figueiredo  "), "nadir figueiredo");
  assert.equal(normalizePartyName("Vidraria Ávila Ltda."), "vidraria avila ltda");
  assert.equal(normalizePartyName("   "), null);
});

test("nomes parecidos vão para conferência; iguais e diferentes não", () => {
  const pares = similarPairs(["Verallia", "Verallia / Saint-Gobain - Campo Bom", "Nadir", "Owens-Illinois (Argentina)", "NADIR"]);
  assert.deepEqual(pares, [["Verallia", "Verallia / Saint-Gobain - Campo Bom"]]);
  // Palavra genérica ("Vidros", "Ltda") não conta como parecença.
  assert.deepEqual(similarPairs(["Vidros Alfa Ltda", "Vidros Beta Ltda"]), []);
});

test("leitura genérica do Forja: novo login no 401 e 403 como falta de acesso", async () => {
  const chamadas = [];
  let tokenValido = "t1";
  const transport = async ({ method, path, token }) => {
    chamadas.push(`${method} ${path}`);
    if (path === "/api/auth/login") return { status: 200, body: { data: { token: tokenValido } } };
    if (path === "/api/proibido") return { status: 403, body: {} };
    if (token !== "t2") return { status: 401, body: {} };
    return { status: 200, body: { data: [{ id: "os-1" }] } };
  };
  const sessao = createForjaSession({ transport, credentials: { code: "x", pin: "y" } });
  tokenValido = "t1";
  // Primeiro token é recusado; o segundo login entrega t2.
  const primeira = sessao.getData("/api/os");
  tokenValido = "t2";
  assert.deepEqual(await primeira, [{ id: "os-1" }]);
  assert.deepEqual(chamadas, ["POST /api/auth/login", "GET /api/os", "POST /api/auth/login", "GET /api/os"]);
  await assert.rejects(sessao.getData("/api/proibido"), (e) => e instanceof ForjaError && e.code === "FORBIDDEN_MODULE");
});
