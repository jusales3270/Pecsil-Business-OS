import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { enviarSinal, infoDoHost, montarSinal, testar, testarServicos } from "../lib/ti/sinal-de-vida.mjs";

// O SQL do vigia é testado de ponta a ponta num Postgres do Supabase descartável (pg_cron + pg_net);
// aqui ficam as garantias que não podem regredir sem banco.

test("TI vigia: números do servidor saem do sistema (tempo ligado, carga, memória e disco livres)", () => {
  const sistema = { uptime: () => 86400.7, loadavg: () => [1.234, 0, 0], cpus: () => [1, 2, 3, 4], freemem: () => 2, totalmem: () => 8 };
  const h = infoDoHost({ sistema, disco: () => ({ bavail: 25, bsize: 4096, blocks: 100 }) });
  assert.deepEqual(h, { uptime_s: 86401, carga_1m: 1.23, cpus: 4, memoria_livre_pct: 25, disco_livre_pct: 25 });
  assert.equal(infoDoHost({ sistema, disco: () => { throw new Error("x"); } }).disco_livre_pct, null, "sem disco, vai sem o número");
});

test("TI vigia: o teste de serviço respeita status, tempo-limite e o cabeçalho Host da Forja", async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === "/lento") return setTimeout(() => res.end("ok"), 1500);
    res.writeHead(req.url === "/404" ? 404 : 200, { "x-host": req.headers.host ?? "" });
    res.end(req.headers.host ?? "");
  }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await testar(`${base}/ok`)).ok, true);
    assert.equal((await testar(`${base}/404`)).ok, false);
    assert.equal((await testar(`${base}/404`, { aceita: (s) => s > 0 && s < 500 })).ok, true);
    const lento = await testar(`${base}/lento`, { limiteMs: 200 });
    assert.equal(lento.ok, false);
    assert.match(lento.erro, /sem resposta/);
    const fechado = await testar("http://127.0.0.1:1/");
    assert.equal(fechado.ok, false);
    assert.equal((await testar("não é url")).erro, "endereço inválido");
    // Host trocado (o caminho da Forja pelo proxy do Coolify).
    const r = await new Promise((ok) => http.get(`${base}/x`, { headers: { host: "forja.pecsil" } }, (x) => ok(x.headers["x-host"])));
    assert.equal(r, "forja.pecsil");
  } finally { srv.close(); }
});

test("TI vigia: só testa o que está configurado (plataforma sempre; banco e Forja se houver variável)", async () => {
  const chamadas = [];
  const teste = async (url, o) => { chamadas.push({ url, host: o?.host, apikey: o?.cabecalhos?.apikey }); return { ok: true, ms: 1 }; };
  const s1 = await testarServicos({ PORT: "3000" }, teste);
  assert.deepEqual(Object.keys(s1), ["plataforma"]);
  assert.equal(chamadas[0].url, "http://127.0.0.1:3000/api/version");
  chamadas.length = 0;
  const s2 = await testarServicos({ SUPABASE_INTERNAL_URL: "http://supabase:8000/", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", FORJA_API_URL: "http://coolify-proxy", FORJA_API_HOST: "forja.pecsil" }, teste);
  assert.deepEqual(Object.keys(s2), ["plataforma", "banco", "forja"]);
  assert.deepEqual(chamadas[1], { url: "http://supabase:8000/rest/v1/", host: undefined, apikey: "sb_publishable_x" });
  assert.deepEqual(chamadas[2], { url: "http://coolify-proxy/health", host: "forja.pecsil", apikey: undefined });
});

test("TI vigia: o sinal vai para a RPC do vigia com o token; chave JWT também no Authorization", async () => {
  const pedidos = [];
  const buscar = async (url, init) => { pedidos.push({ url, init }); return { ok: true, status: 200, text: async () => '{"ok":true,"estado":"ok"}' }; };
  const info = montarSinal({ uptime_s: 10 }, { plataforma: { ok: true } });
  const r = await enviarSinal({ url: "https://abc.supabase.co/", chave: "sb_publishable_123", token: "t".repeat(64), info, buscar });
  assert.equal(r.estado, "ok");
  assert.equal(pedidos[0].url, "https://abc.supabase.co/rest/v1/rpc/vigia_sinal");
  assert.equal(pedidos[0].init.headers.apikey, "sb_publishable_123");
  assert.equal(pedidos[0].init.headers.authorization, undefined, "chave nova basta no apikey");
  assert.deepEqual(JSON.parse(pedidos[0].init.body), { p_alvo: "servidor-pecsil", p_token: "t".repeat(64), p_info: info });
  await enviarSinal({ url: "https://abc.supabase.co", chave: "eyJabc", token: "x", info, buscar });
  assert.equal(pedidos[1].init.headers.authorization, "Bearer eyJabc");
  const recusa = async () => ({ ok: false, status: 403, text: async () => "sinal recusado" });
  await assert.rejects(enviarSinal({ url: "https://a", chave: "k", token: "errado", info, buscar: recusa }), /vigia respondeu 403/);
  await assert.rejects(enviarSinal({ url: "", chave: "k", token: "x", info, buscar }), /obrigatórios/);
});

test("TI vigia: o SQL só abre a função de sinal ao público e nunca guarda o token nem a chave do WhatsApp", () => {
  const sql = readFileSync(new URL("../infra/vigia/001_vigia.sql", import.meta.url), "utf8");
  const grants = [...sql.matchAll(/grant execute on function public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(grants, ["vigia_sinal"]);
  for (const t of ["vigia_alvos", "vigia_checagens", "vigia_pedidos", "vigia_incidentes", "vigia_destinos", "vigia_config", "vigia_alertas"]) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} com RLS`);
  }
  assert.match(sql, /token_hash/);
  assert.doesNotMatch(sql, /token\s+text\s+not null/, "o token em si não é coluna");
  assert.match(sql, /vault\.decrypted_secrets where name = 'vigia_whatsapp_token'/, "token do WhatsApp só no Vault");
  assert.match(sql, /cron\.schedule\('vigia-minuto', '\* \* \* \* \*'/);
  const script = readFileSync(new URL("../scripts/ti-sinal-cron.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /NEXT_PUBLIC_VIGIA/, "as chaves do vigia nunca vão para o navegador");
});
