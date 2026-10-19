import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BACKUP_ATRASO_H, categoriaDoVigia, copiarParaPlataforma, lerPainel, paraCopiar, resumoSaude } from "../lib/ti/vigia.mjs";

// O SQL do módulo (202610190001_ti_base.sql) e o painel da nuvem (infra/vigia/003_painel.sql) são
// testados de ponta a ponta em Postgres do Supabase descartáveis; aqui fica o que não pode regredir.

const vigiaSql = readFileSync(new URL("../infra/vigia/001_vigia.sql", import.meta.url), "utf8");

test("TI módulo: cada causa que o vigia escreve vira uma categoria provável (ou fica a confirmar)", () => {
  // As frases vêm do próprio SQL do vigia: se alguém mudar o texto lá, este teste avisa.
  const frase = (trecho) => {
    const m = vigiaSql.match(new RegExp(`'([^']*${trecho}[^']*)'`));
    assert.ok(m, `frase com "${trecho}" no vigia`);
    return m[1];
  };
  assert.equal(categoriaDoVigia("servidor-pecsil", "O servidor reiniciou durante a queda (ligado há 3 min): queda de energia ou reinício"), "energia");
  assert.equal(categoriaDoVigia("servidor-pecsil", frase("ficou ligado o tempo todo")), "internet");
  assert.equal(categoriaDoVigia("link-fabrica", frase("internet da fábrica não chega")), "internet");
  assert.equal(categoriaDoVigia("plataforma-externa", frase("porta 443 falhou")), "rede");
  assert.equal(categoriaDoVigia("servidor-pecsil", frase("servidor ou plataforma travados")), "servidor");
  assert.equal(categoriaDoVigia("servidor-pecsil", frase("sem contato com a fábrica: energia")), null, "sem contato: a TI confirma");
  assert.equal(categoriaDoVigia("backup-pecsil", "o backup diário não chegou (serviço de backup parado ou com erro)"), "backup");
  assert.equal(categoriaDoVigia("link-fabrica", "alarme falso: o firewall da fábrica bloqueia a nuvem (o site abria no 4G)"), "alarme_falso");
  assert.equal(categoriaDoVigia("x", null), null);
});

const painel = {
  agora: "2026-10-19T15:00:00Z",
  alvos: [
    { id: "servidor-pecsil", nome: "Servidor da fábrica", tipo: "sinal", ativo: true, estado: "ok", estado_desde: "2026-10-19T12:40:00Z", ultimo_sinal: "2026-10-19T14:59:30Z",
      info: { host: { uptime_s: 290668, disco_livre_pct: 83.2, memoria_livre_pct: 64.7, carga_1m: 0.74, cpus: 8 }, servicos: { plataforma: { ok: true, ms: 23 }, banco: { ok: true, ms: 17 }, forja: { ok: false, ms: 3000 } } } },
    { id: "backup-pecsil", nome: "Backup diário", tipo: "sinal", ativo: true, estado: "ok", ultimo_sinal: "2026-10-19T12:48:17Z",
      info: { arquivos: [{ nome: "2026-10-19/0948-pecsil.dump.age", bytes: 23156313 }, { nome: "2026-10-19/0948-arquivos.tar.gz.age", bytes: 45866921 }], duracao_s: 14 } },
    { id: "link-fabrica", nome: "Internet da fábrica", tipo: "http", ativo: false, estado: "desconhecido", ultima_checagem: null },
  ],
  incidentes: [
    { id: "a1", alvo: "servidor-pecsil", alvo_nome: "Servidor da fábrica", inicio: "2026-10-19T14:00:00Z", fim: null, causa: "sem contato com a fábrica: energia, servidor ou internet" },
    { id: "a2", alvo: "link-fabrica", alvo_nome: "Internet da fábrica", inicio: "2026-10-19T12:25:00Z", fim: "2026-10-19T12:31:49Z", causa: "alarme falso: o firewall" },
  ],
  alertas: { destinatarios: 0, canal_configurado: false, ultimos_30_dias: { sem_canal: 4 } },
};

test("TI módulo: o resumo de saúde lê o servidor, o backup, os testes de fora e o que está fora agora", () => {
  const s = resumoSaude(painel, Date.parse("2026-10-19T15:00:00Z"));
  assert.equal(s.servidor.estado, "ok");
  assert.equal(s.servidor.discoLivrePct, 83.2);
  assert.deepEqual(s.servidor.servicos.map((x) => [x.nome, x.ok]), [["plataforma", true], ["banco", true], ["forja", false]]);
  assert.equal(s.backup.totalBytes, 23156313 + 45866921);
  assert.equal(s.backup.horasDesde, 2.2);
  assert.equal(s.backup.atrasado, false);
  assert.equal(s.externos[0].ativo, false);
  assert.deepEqual(s.alertas, { destinatarios: 0, canalConfigurado: false, ultimos30Dias: { sem_canal: 4 } });
  assert.deepEqual(s.foraAgora.map((f) => f.alvo), ["servidor-pecsil"]);
  const tarde = resumoSaude(painel, Date.parse("2026-10-19T12:48:17Z") + (BACKUP_ATRASO_H + 1) * 3_600_000);
  assert.equal(tarde.backup.atrasado, true, "mais de 26 h sem backup = atrasado");
  assert.equal(resumoSaude({ alvos: [] }).backup, null, "sem alvo de backup, sem bloco de backup");
});

test("TI módulo: as quedas vão para a plataforma com a categoria provável e sem nada além do necessário", () => {
  const c = paraCopiar(painel);
  assert.deepEqual(c[0], { vigia_id: "a1", alvo: "servidor-pecsil", alvo_nome: "Servidor da fábrica", inicio: "2026-10-19T14:00:00Z", fim: null, causa_vigia: "sem contato com a fábrica: energia, servidor ou internet", categoria: null });
  assert.equal(c[1].categoria, "alarme_falso");
  assert.deepEqual(paraCopiar({}), []);
});

test("TI módulo: a leitura do vigia usa o token do sinal, e erro de rede não vaza endereço nem token", async () => {
  const pedidos = [];
  const ok = await lerPainel({ url: "https://abc.supabase.co/", chave: "sb_publishable_x", token: "t".repeat(64), dias: 3,
    buscar: async (url, init) => { pedidos.push({ url, init }); return { ok: true, status: 200, text: async () => JSON.stringify(painel) }; } });
  assert.equal(ok.ok, true);
  assert.equal(pedidos[0].url, "https://abc.supabase.co/rest/v1/rpc/vigia_painel");
  assert.deepEqual(JSON.parse(pedidos[0].init.body), { p_alvo: "servidor-pecsil", p_token: "t".repeat(64), p_dias: 3 });
  assert.equal(pedidos[0].init.headers.authorization, undefined, "chave nova vai só no apikey");
  const semConfig = await lerPainel({ url: "", chave: "x", token: "y" });
  assert.equal(semConfig.ok, false);
  const caiu = await lerPainel({ url: "https://abc.supabase.co", chave: "k", token: "segredo123", buscar: async () => { throw new Error("connect ECONNREFUSED https://abc.supabase.co segredo123"); } });
  assert.equal(caiu.ok, false);
  assert.doesNotMatch(caiu.erro, /segredo123|abc\.supabase/);
  const recusou = await lerPainel({ url: "https://abc.supabase.co", chave: "k", token: "t", buscar: async () => ({ ok: false, status: 403, text: async () => '{"message":"leitura recusada"}' }) });
  assert.equal(recusou.erro, "O vigia respondeu 403.");
});

test("TI módulo: a cópia acha a empresa da instalação e recusa adivinhar quando há mais de uma", async () => {
  const pedidos = [];
  const buscar = (orgs) => async (url, init) => {
    pedidos.push({ url, init });
    if (url.includes("/organizations")) return { ok: true, json: async () => orgs };
    return { ok: true, status: 200, text: async () => "2" };
  };
  const n = await copiarParaPlataforma({ supabaseUrl: "http://supabase:8000/", chaveServico: "eyJabc", incidentes: paraCopiar(painel), buscar: buscar([{ id: "org-1" }]) });
  assert.equal(n, 2);
  const rpc = pedidos.find((p) => p.url.endsWith("/rest/v1/rpc/ti_sincronizar_vigia"));
  assert.equal(JSON.parse(rpc.init.body).p_org, "org-1");
  assert.equal(rpc.init.headers.authorization, "Bearer eyJabc");
  await assert.rejects(copiarParaPlataforma({ supabaseUrl: "http://s", chaveServico: "k", incidentes: paraCopiar(painel), buscar: buscar([{ id: "a" }, { id: "b" }]) }), /TI_ORGANIZATION_ID/);
  assert.equal(await copiarParaPlataforma({ supabaseUrl: "http://s", chaveServico: "k", incidentes: [], buscar: buscar([]) }), 0, "nada a copiar, nenhuma chamada");
});

test("TI módulo: o painel da nuvem não entrega telefone, token nem o hash", () => {
  const nuvem = readFileSync(new URL("../infra/vigia/003_painel.sql", import.meta.url), "utf8");
  const corpo = nuvem.slice(nuvem.indexOf("return jsonb_build_object"));
  assert.doesNotMatch(corpo, /'numero'|token_hash'|'telefone'|whatsapp_token/);
  assert.match(nuvem, /a\.token_hash <> public\.vigia_hash\(p_token\)/, "exige o token de um alvo de sinal");
  assert.match(corpo, /'destinatarios', \(select count\(\*\)/, "dos destinatários, só a contagem");
});

test("TI módulo: a SARA de TI só lê o painel do vigia e as tabelas do módulo, e diz quem decide", async () => {
  const fonte = readFileSync(new URL("../lib/sara/agentes/ti.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const tabelas = [...fonte.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tabelas)].sort(), ["ti_ativos", "ti_chamados", "ti_incidentes"]);
  assert.doesNotMatch(fonte, /vigia_destinos|SUPABASE_SERVICE_ROLE_KEY|vault/i);
  const { ti } = await import("../lib/sara/agentes/ti.ts");
  assert.match(ti.sara.manual, /Quem decide: o supervisor de TI, Cesar Augusto Santos/);
  const saude = ti.ferramentas.find((f) => f.nome === "ti_saude");
  const antes = { ...process.env };
  delete process.env.VIGIA_URL;
  try {
    const r = await saude.rodar({}, {});
    assert.equal(r.dados.vigia, "sem resposta", "sem vigia configurado, responde sem quebrar");
  } finally { Object.assign(process.env, antes); }
});
