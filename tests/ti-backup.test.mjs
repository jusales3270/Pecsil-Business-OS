import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIMITE_PARTE, lerConfig, nomeDaParte, nomeDoArquivo, partes, proximaExecucao } from "../services/backup/nucleo.mjs";
import { senhaAleatoria, verificadorScram } from "../lib/ti/scram.mjs";

// O fluxo completo (pg_dump → age → envio → restauração) é testado com contêineres
// descartáveis; aqui ficam as regras que não podem regredir.

const base = {
  BACKUP_PG_URL_PECSIL: "postgres://backup_leitura.t:x@h:5432/postgres",
  BACKUP_AGE_DESTINATARIO: "age1" + "q".repeat(58),
  VIGIA_URL: "https://abc.supabase.co/", VIGIA_CHAVE: "sb_publishable_x", BACKUP_EMAIL: "backup@pecsil.local", BACKUP_SENHA: "s", BACKUP_TOKEN: "t",
};

test("TI backup: confere as variáveis e não mostra segredo no erro", () => {
  const c = lerConfig(base);
  assert.deepEqual(c.bancos.map((b) => b.nome), ["pecsil"]);
  assert.equal(c.vigia.url, "https://abc.supabase.co");
  assert.equal(c.vigia.alvo, "backup-pecsil");
  assert.equal(c.hora, "02:30");
  assert.equal(c.arquivos, null);
  const comTudo = lerConfig({ ...base, BACKUP_PG_URL_FORJA: "postgres://f", BACKUP_ARQUIVOS_URL: "http://supabase:8000/", BACKUP_ARQUIVOS_CHAVE: "k", BACKUP_EXCLUIR_BUCKETS: "desenhos, forja-desenhos" });
  assert.deepEqual(comTudo.bancos.map((b) => b.nome), ["pecsil", "forja"]);
  assert.deepEqual(comTudo.arquivos.excluir, ["desenhos", "forja-desenhos"], "os desenhos ficam fora do backup (decisão de 18/10)");
  assert.throws(() => lerConfig({ ...base, BACKUP_SENHA: "" }), (e) => /BACKUP_SENHA/.test(e.message) && !e.message.includes("backup_leitura.t:x"));
  assert.throws(() => lerConfig({ ...base, BACKUP_AGE_DESTINATARIO: "chave-errada" }), /chave pública do age/);
  assert.throws(() => lerConfig({ ...base, BACKUP_HORA: "25:00" }), /HH:MM/);
});

test("TI backup: horário de Brasília e nome do arquivo no bucket", () => {
  // 18/10 23:10 em Brasília = 19/10 02:10 UTC
  const agora = new Date("2026-10-19T02:10:00Z");
  assert.equal(proximaExecucao(agora, "02:30").toISOString(), "2026-10-19T05:30:00.000Z", "hoje ainda não passou das 02:30 (Brasília)");
  assert.equal(proximaExecucao(new Date("2026-10-19T06:00:00Z"), "02:30").toISOString(), "2026-10-20T05:30:00.000Z", "já passou: amanhã");
  assert.equal(nomeDoArquivo(new Date("2026-10-19T05:30:12Z"), "pecsil"), "2026-10-19/0230-pecsil.dump.age");
  assert.equal(nomeDoArquivo(new Date("2026-10-19T05:30:12Z"), "arquivos"), "2026-10-19/0230-arquivos.tar.gz.age");
});

test("TI backup: arquivo maior que 45 MB vai em partes, na ordem, sem buraco", () => {
  assert.deepEqual(partes(10), [[0, 10]]);
  const p = partes(LIMITE_PARTE * 2 + 5);
  assert.equal(p.length, 3);
  assert.equal(p[0][0], 0);
  for (let i = 1; i < p.length; i++) assert.equal(p[i][0], p[i - 1][1]);
  assert.equal(p.at(-1)[1], LIMITE_PARTE * 2 + 5);
  assert.equal(nomeDaParte("a.dump.age", 0, 1), "a.dump.age");
  assert.equal(nomeDaParte("a.dump.age", 1, 3), "a.dump.age.parte-02-de-03");
});

test("TI backup: verificador SCRAM no formato do Postgres e senha sem caractere que quebre a URL", () => {
  // Vetor conhecido: mesma senha + mesmo sal = mesmo verificador; sal diferente = outro.
  const sal = Buffer.from("0123456789abcdef");
  const v = verificadorScram("senha-de-teste", { sal });
  assert.match(v, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.equal(v, verificadorScram("senha-de-teste", { sal }));
  assert.notEqual(v, verificadorScram("senha-de-teste"));
  assert.ok(!v.includes("senha-de-teste"));
  const s = senhaAleatoria();
  assert.match(s, /^[A-Za-z0-9]{32}$/);
});

test("TI backup: papel só de leitura e nuvem que só aceita gravar", () => {
  const papel = readFileSync(new URL("../supabase/migrations/202610180007_backup_leitura.sql", import.meta.url), "utf8");
  assert.match(papel, /grant pg_read_all_data to backup_leitura/);
  assert.match(papel, /default_transaction_read_only = on/);
  assert.doesNotMatch(papel, /password\s+'/i, "a senha não fica no arquivo");
  const nuvem = readFileSync(new URL("../infra/vigia/002_backup.sql", import.meta.url), "utf8");
  const politicas = [...nuvem.matchAll(/create policy [^\n]+\n\s+for (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(politicas, ["insert"], "o servidor da fábrica só grava: nem lê, nem sobrescreve, nem apaga");
  assert.match(nuvem, /'backups', 'backups', false/, "bucket privado");
  assert.match(nuvem, /order by r\.created_at desc limit 30/, "a limpeza nunca apaga os mais recentes");
  const svc = readFileSync(new URL("../services/backup/backup.mjs", import.meta.url), "utf8");
  assert.match(svc, /"x-upsert": "false"/);
  assert.match(svc, /age", \["-r"/, "criptografa antes de sair");
});
