import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { comoAgente, comProgresso, detalheDaEntrada, iniciarPasso, textoDoPasso } from "../lib/sara/progresso.ts";
import { duracao, juntarPasso, passoAtual, perguntarComPassos } from "../lib/sara/progresso-cliente.ts";
import { ferramentaPerguntarASara } from "../lib/sara/central/subagente.ts";

const { conversarCom } = await import("../lib/sara/laco.ts");
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("progresso: sem canal não emite nada; com canal, cada passo abre e fecha com a duração", async () => {
  iniciarPasso("consulta", "solto").fim(); // sem canal: não quebra
  const vistos = [];
  await comProgresso((p) => vistos.push(p), async () => {
    const p = iniciarPasso("consulta", "Consultando cotações pendentes");
    p.fim(true);
    p.fim(false); // fechar de novo não emite outra vez
  });
  assert.equal(vistos.length, 2);
  assert.deepEqual(vistos.map((p) => p.estado), ["rodando", "feito"]);
  assert.equal(vistos[0].id, vistos[1].id);
  assert.equal(typeof vistos[1].ms, "number");
  assert.equal(vistos[0].agente, null);
});

test("progresso: os passos de dentro de uma SARA de área saem com o nome da área e ids únicos", async () => {
  const vistos = [];
  await comProgresso((p) => vistos.push(p), async () => {
    await Promise.all([
      comoAgente("Financeiro", async () => { iniciarPasso("consulta", "contas a receber").fim(); }),
      comoAgente("Compras", async () => { iniciarPasso("consulta", "cotações").fim(); }),
    ]);
    iniciarPasso("conta", "Fazendo as contas").fim();
  });
  assert.deepEqual([...new Set(vistos.map((p) => p.agente))].sort(), ["Compras", "Financeiro", null].sort());
  assert.equal(new Set(vistos.map((p) => p.id)).size, 3);
});

test("progresso: texto de cada passo em português de quem usa", () => {
  assert.equal(textoDoPasso("compras_cotacoes_pendentes", "cotações pendentes", { fornecedor: "Comil" }, false).texto, "Consultando cotações pendentes · Comil");
  assert.equal(textoDoPasso("mostrar", undefined, {}, false).texto, "Montando o gráfico");
  assert.equal(textoDoPasso("calcular", undefined, {}, false).tipo, "conta");
  assert.match(textoDoPasso("convidar_fornecedor", "preparou um convite ao fornecedor", {}, true).texto, /^Preparando o cartão para você permitir \(um convite ao fornecedor\)/);
  assert.equal(detalheDaEntrada({ pedido: 25, outra: "x" }), "25");
  assert.equal(detalheDaEntrada({ busca: "a".repeat(80) }).length, 48);
});

test("progresso: o laço mostra o modelo pensando e cada consulta, com a área quando é subagente", async () => {
  let n = 0;
  const buscar = async () => {
    n++;
    const content = n === 1
      ? [{ type: "tool_use", id: "t1", name: "perguntar_a_sara", input: { modulo: "financeiro", pergunta: "contas a receber de outubro" } }]
      : [{ type: "text", text: "Pronto." }];
    return { ok: true, status: 200, json: async () => ({ stop_reason: n === 1 ? "tool_use" : "end_turn", usage: {}, content }) };
  };
  // A subagente "roda" uma consulta dela (sem modelo): o passo sai em nome da área.
  const perguntar = ferramentaPerguntarASara([{ modulo: "financeiro", rotulo: "Financeiro" }], async () => {
    iniciarPasso("consulta", "Consultando contas a receber").fim();
    return { texto: "R$ 10", fontes: [], consultas: [], visuais: [], uso: { modulo: "financeiro", modelo: "m", tokensEntrada: 0, tokensSaida: 0, cacheLido: 0, cacheGravado: 0, ok: true } };
  }, []);
  const vistos = [];
  const r = await comProgresso((p) => vistos.push(p), () => conversarCom({}, { chave: "x", buscar, modelo: "m", sistema: "s", historico: [], pergunta: "quanto entra?", ferramentas: [perguntar] }));
  assert.equal(r.texto, "Pronto.");
  const feitos = vistos.filter((p) => p.estado !== "rodando").map((p) => `${p.agente ?? "-"}|${p.texto}`);
  assert.deepEqual(feitos, ["-|Entendendo o pedido", "Financeiro|Consultando contas a receber", "-|SARA · Financeiro respondeu", "-|Analisando o que encontrou"]);
  assert.ok(vistos.some((p) => p.estado === "rodando" && p.tipo === "agente" && /Conversando com a SARA · Financeiro: contas a receber de outubro/.test(p.texto)));
});

test("progresso no navegador: lê as linhas do fluxo e devolve a resposta final como antes", async () => {
  const linhas = [
    { tipo: "passo", passo: { id: "p1", agente: null, tipo: "pensando", texto: "Entendendo o pedido", estado: "rodando" } },
    { tipo: "vivo" },
    { tipo: "passo", passo: { id: "p1", agente: null, tipo: "pensando", texto: "Entendendo o pedido", estado: "feito", ms: 900 } },
    { tipo: "fim", status: 200, corpo: { texto: "ok", conversa: "c1" } },
  ].map((x) => JSON.stringify(x)).join("\n");
  // Chega em pedaços que cortam a linha no meio.
  const pedacos = [linhas.slice(0, 37), linhas.slice(37, 140), linhas.slice(140)].map((t) => new TextEncoder().encode(t));
  const fluxo = new ReadableStream({ start(c) { pedacos.forEach((p) => c.enqueue(p)); c.close(); } });
  const original = globalThis.fetch;
  let enviado = null;
  globalThis.fetch = async (_u, init) => { enviado = JSON.parse(init.body); return new Response(fluxo, { headers: { "content-type": "application/x-ndjson" } }); };
  try {
    const passos = []; let sinais = 0;
    const r = await perguntarComPassos("/api/sara/compras", { pergunta: "oi" }, (p) => passos.push(p), () => sinais++);
    assert.equal(enviado.progresso, true);
    assert.deepEqual(r, { ok: true, status: 200, body: { texto: "ok", conversa: "c1" } });
    assert.equal(passos.length, 2);
    assert.equal(sinais, 4);
    // Erro antes do fluxo (sem permissão): JSON comum.
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { "content-type": "application/json" } });
    assert.deepEqual(await perguntarComPassos("/x", {}, () => null), { ok: false, status: 403, body: { error: "FORBIDDEN" } });
    // Fluxo que cai sem a linha final.
    globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(linhas.split("\n")[0])); c.close(); } }), { headers: { "content-type": "application/x-ndjson" } });
    assert.equal((await perguntarComPassos("/x", {}, () => null)).ok, false);
  } finally { globalThis.fetch = original; }
});

test("progresso no navegador: junta o passo pelo id e mostra o último que está rodando", () => {
  let l = juntarPasso([], { id: "p1", agente: null, texto: "a", estado: "rodando" });
  l = juntarPasso(l, { id: "p2", agente: "Financeiro", texto: "b", estado: "rodando" });
  l = juntarPasso(l, { id: "p2", agente: "Financeiro", texto: "b", estado: "feito", ms: 10 });
  assert.equal(l.length, 2);
  assert.equal(passoAtual(l).id, "p1");
  assert.equal(passoAtual([{ id: "x", estado: "feito" }]).id, "x");
  assert.equal(duracao(8_200), "8 s");
  assert.equal(duracao(72_000), "1 min 12 s");
});

test("progresso: a rota só transmite quando a tela pede, sem compressão segurando as linhas", () => {
  const rota = ler("app/api/sara/[modulo]/route.ts");
  assert.match(rota, /if \(!corpo\?\.progresso\) return responder\(p, modulo, corpo\);/);
  assert.match(rota, /"cache-control": "no-store, no-transform"/);
  assert.match(rota, /linha\(\{ tipo: "vivo" \}\), 10_000/);
  assert.match(ler("app/components/sara-painel.tsx"), /perguntarComPassos\(`\/api\/sara\/\$\{modulo\}`/);
  assert.match(ler("modules/warroom/src/holograma/SaraHolograma.tsx"), /perguntarComPassos\(`\/api\/sara\/\$\{modulo\}`/);
});
