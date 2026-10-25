import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { lerConfig, rodada, semSegredos } from "../conector.mjs";
import { pagina } from "../drivers/paginas.mjs";
import { consultaSoLeitura } from "../leitura.mjs";
import { plataforma } from "../plataforma.mjs";
import { portaAberta, sondar } from "../sondar.mjs";
import { registro, valor } from "../valores.mjs";

test("só leitura: SELECT e WITH passam; comando que grava, ';' no meio ou outro começo não", () => {
  assert.equal(consultaSoLeitura("select * from CLIENTES;").consulta, "select * from CLIENTES");
  assert.ok(consultaSoLeitura("WITH x AS (SELECT 1 a) SELECT * FROM x").ok);
  assert.ok(consultaSoLeitura("select replace(NOME, 'a', 'b'), cast(X as varchar(10) character set win1252) from T").ok, "REPLACE() e CHARACTER SET são leitura");
  assert.ok(consultaSoLeitura("select 'delete; drop' as texto from T").ok, "palavra dentro de texto não conta");
  for (const ruim of ["delete from T", "select 1; delete from T", "select * into NOVA from T", "update T set a = 1", "select 1 from T for update", "execute block as begin end",
    "select * from T /* ok */ ; drop table T", "EXEC xp_cmdshell 'dir'", "insert into T values (1)", "select * from T with (tablockx) union select 1 from T where 1=1 delete from T"])
    assert.ok(!consultaSoLeitura(ruim).ok, ruim);
});

test("valores em JSON estável: data ISO, texto sem enchimento, número grande como texto, binário só marcado", () => {
  assert.equal(valor(new Date(2020, 0, 2)), "2020-01-02", "data sem hora, sem fuso");
  assert.equal(valor(new Date(2026, 9, 25, 9, 30, 5)), "2026-10-25T09:30:05", "hora local, sem passar por UTC");
  assert.equal(valor(new Date("x")), null);
  assert.equal(valor("JOAO   "), "JOAO");
  assert.equal(valor(9007199254740993n), "9007199254740993");
  assert.equal(valor(42n), 42);
  assert.equal(valor(Buffer.from("abc")), "[binário 3 bytes]");
  assert.equal(valor(() => null), "[blob]");
  assert.equal(valor(Number.NaN), null);
  assert.deepEqual(registro({ " COD ": 1, NOME: "A  ", DT: null }), { COD: 1, NOME: "A", DT: null });
});

test("paginação no dialeto de cada banco", () => {
  assert.equal(pagina("firebird", "select * from T", 500, 1000), "SELECT FIRST 500 SKIP 1000 * FROM (select * from T) q");
  assert.equal(pagina("sqlserver", "select * from T", 500, 0), "SELECT * FROM (select * from T) AS q ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY");
  assert.equal(pagina("postgres", "select * from T", 10, 20), "SELECT * FROM (select * from T) AS q LIMIT 10 OFFSET 20");
});

test("configuração: falta variável é avisada; a senha e o segredo nunca aparecem em erro", () => {
  assert.throws(() => lerConfig({}), /Faltam as variáveis: PLATAFORMA_URL/);
  const cfg = lerConfig({ PLATAFORMA_URL: "http://x", CONECTOR_FONTE: "f", CONECTOR_SEGREDO: "segredo-123", ORIGEM_TIPO: "Firebird", ORIGEM_HOST: "h", ORIGEM_BANCO: "C:\\GRV\\D.FDB", ORIGEM_USUARIO: "LEITOR", ORIGEM_SENHA: "senha-abc", TAMANHO_LOTE: "5000" });
  assert.equal(cfg.origem.tipo, "firebird"); assert.equal(cfg.tamanho, 1000, "teto de 1.000 por lote");
  assert.equal(semSegredos("login failed for senha-abc with segredo-123", cfg), "login failed for *** with ***");
});

test("plataforma: segredo no cabeçalho, nova tentativa em erro de rede, 404 é definitivo", async () => {
  const chamadas = [];
  let falhar = 2;
  const buscar = async (url, o) => {
    chamadas.push({ url, cab: o.headers });
    if (url.endsWith("/tarefa") && falhar-- > 0) throw new Error("ECONNRESET");
    if (url.endsWith("/lote")) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ ativo: true }), { status: 200 });
  };
  const p = plataforma({ url: "http://p/", fonte: "F1", segredo: "S1", buscar, esperar: async () => {} });
  assert.deepEqual(await p.tarefa(), { ativo: true });
  assert.equal(chamadas.length, 3, "duas falhas de rede e a terceira passou");
  assert.equal(chamadas[0].url, "http://p/api/conector/v1/tarefa");
  assert.equal(chamadas[0].cab.authorization, "Bearer S1"); assert.equal(chamadas[0].cab["x-conector-fonte"], "F1");
  await assert.rejects(p.lote("CLIENTES", []), /não reconheceu esta fonte/);
  assert.equal(chamadas.filter((c) => c.url.endsWith("/lote")).length, 1, "404 não repete");
});

test("rodada: descoberta quando pedida, objeto em lotes até acabar, consulta que grava é recusada", async () => {
  const enviados = [];
  const plat = {
    tarefa: async () => ({ ativo: true, descobrir: true, intervalo_min: 30, objetos: [{ nome: "CLIENTES", consulta: "select * from CLIENTES", chave: ["COD"] }, { nome: "RUIM", consulta: "delete from X", chave: ["A"] }] }),
    descoberta: async (d) => enviados.push(["descoberta", d.tabelas.length]),
    lote: async (o, r) => { enviados.push(["lote", o, r.length]); return { novos: r.length }; },
    erro: async (e) => enviados.push(["erro", e]),
  };
  const linhas = Array.from({ length: 5 }, (_, i) => ({ COD: i, NOME: `C${i}   ` }));
  let fechado = false;
  const driver = async () => ({ descobrir: async () => ({ banco: null, tabelas: [{ nome: "CLIENTES", linhas: 5, colunas: [] }] }), ler: async (c, n, o) => linhas.slice(o, o + n), fechar: async () => { fechado = true; } });
  const r = await rodada({ tamanho: 2 }, { plat, driver, log: () => {} });
  assert.deepEqual(enviados, [["descoberta", 1], ["lote", "CLIENTES", 2], ["lote", "CLIENTES", 2], ["lote", "CLIENTES", 1], ["erro", "RUIM: A consulta tem de começar com SELECT ou WITH."]]);
  assert.deepEqual(r, { intervalo: 30, enviados: 5 });
  assert.ok(fechado, "a conexão com a origem é fechada");
});

test("rodada: fonte desativada não abre a origem", async () => {
  let abriu = false;
  const r = await rodada({ tamanho: 10 }, { plat: { tarefa: async () => ({ ativo: false, intervalo_min: 60 }) }, driver: async () => { abriu = true; }, log: () => {} });
  assert.equal(abriu, false); assert.equal(r.enviados, 0);
});

test("sondagem: porta aberta e fechada", async () => {
  const srv = net.createServer().listen(0);
  await new Promise((r) => srv.once("listening", r));
  const porta = srv.address().port;
  assert.equal(await portaAberta("127.0.0.1", porta), true);
  srv.close();
  const r = await sondar("127.0.0.1", [{ porta, banco: "teste" }], 500);
  assert.equal(r[0].aberta, false);
});

test("rodando direto (caminho relativo, pasta com espaço): avisa o que falta e sai com código 2", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const r = spawnSync(process.execPath, ["conector.mjs"], { cwd: raiz, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Faltam as variáveis: PLATAFORMA_URL/);
});
