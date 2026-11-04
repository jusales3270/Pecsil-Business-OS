import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";

const dsn = process.env.PECSIL_SECURITY_TEST_DATABASE_URL;
test("shared cloud installer preserves the existing app and refuses conflicts atomically", {
  skip: !dsn && "set PECSIL_SECURITY_TEST_DATABASE_URL to the disposable local review DB",
}, async (t) => {
  const target = new URL(dsn);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname));
  assert.equal(target.port, "54732", "use only the isolated security-review database");
  const folder = mkdtempSync(join(tmpdir(), "pecsil-shared-install-"));
  const artifact = join(folder, "install.sql");
  const generated = spawnSync("python3", ["scripts/ti-backup-instalar-compartilhado.py", "--project-url", "https://fongsabmkjnurojblhge.supabase.co", "--output", artifact], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const source = readFileSync(artifact, "utf8");
  assert.equal([...source.matchAll(/^begin;$/gm)].length, 1);
  assert.equal([...source.matchAll(/^commit;$/gm)].length, 1);
  // Keep the exact installer body in an outer rollback-only transaction. Its
  // new cron jobs stay uncommitted and never perform outbound checks in tests.
  const body = source.replace(/^begin;\n/m, "").replace(/^commit;\n/m, "");
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  const q = (sql, params = []) => db.query(sql, params);
  const tables = ["alerts", "chat_messages", "companies", "knowledge_chunks", "profiles", "report_snapshots", "sheet_rows"];
  const marker = randomUUID();
  const legacyBucket = `app-${randomUUID()}`;
  const policy = `app-${randomUUID()}`;
  const quotedPolicy = `"${policy}"`;
  const attempt = async (sql) => {
    await q("savepoint shared_attempt");
    let failure;
    try { await q(sql); } catch (error) { failure = error; }
    finally {
      await q("rollback to savepoint shared_attempt");
      await q("release savepoint shared_attempt");
    }
    assert.equal(failure?.code, "P0001", failure?.message ?? "installation must refuse the conflict");
  };
  try {
    await q("begin");
    for (const table of tables) await q(`create table if not exists public.${table}(id uuid primary key, fixture text)`);
    await q("insert into public.sheet_rows(id,fixture) values($1,'existing app record')", [marker]);
    await q("alter table public.sheet_rows enable row level security");
    await q("create or replace function public.backup_app_fixture() returns integer language sql as 'select 73'");
    await q("insert into storage.buckets(id,name,public) values($1,$1,false)", [legacyBucket]);
    await q(`create policy ${quotedPolicy} on storage.objects for all to anon,authenticated using(true) with check(true)`);
    const xid = (await q("select txid_current()::text xid")).rows[0].xid;
    const emptyVigia = async () => assert.equal((await q("select to_regclass('public.vigia_alvos') v")).rows[0].v, null);

    await t.test("existing bucket is preserved and prevents installation", async () => {
      await q("savepoint prior_bucket");
      await q("insert into storage.buckets(id,name,public) values('backups','backups',true)");
      await attempt(body);
      assert.equal((await q("select public from storage.buckets where id='backups'")).rows[0].public, true);
      await emptyVigia();
      await q("rollback to savepoint prior_bucket");
      await q("release savepoint prior_bucket");
    });
    await t.test("partial or unrelated Vigia function is not overwritten", async () => {
      await q("savepoint prior_function");
      await q("create function public.vigia_existing_fixture() returns integer language sql as 'select 41'");
      await attempt(body);
      assert.equal((await q("select public.vigia_existing_fixture() v")).rows[0].v, 41);
      await emptyVigia();
      await q("rollback to savepoint prior_function");
      await q("release savepoint prior_function");
    });
    await t.test("failure after setup rolls back new objects and leaves app data intact", async () => {
      const failing = body.replace("-- As definições e permissões anteriores", () => "do $$ begin raise exception 'Injected deployment failure'; end $$;\n-- As definições e permissões anteriores");
      await attempt(failing);
      await emptyVigia();
      assert.equal((await q("select count(*)::integer n from storage.buckets where id='backups'")).rows[0].n, 0);
      assert.equal((await q("select fixture from public.sheet_rows where id=$1", [marker])).rows[0].fixture, "existing app record");
    });
    await t.test("complete setup preserves app records, function, storage policy and bucket", async () => {
      const results = await q(body);
      assert.deepEqual(results.at(-1).rows[0], {
        vigia_instalado: true, sinal_instalado: true, backup_privado: true, isolamento_instalado: true,
      });
      assert.equal((await q("select txid_current()::text xid")).rows[0].xid, xid, "the fixture must never commit cron jobs");
      assert.equal((await q("select fixture from public.sheet_rows where id=$1", [marker])).rows[0].fixture, "existing app record");
      assert.equal((await q("select public.backup_app_fixture() v")).rows[0].v, 73);
      assert.equal((await q("select count(*)::integer n from pg_policy where polrelid='storage.objects'::regclass and polname=$1", [policy])).rows[0].n, 1);
      assert.equal((await q("select public from storage.buckets where id=$1", [legacyBucket])).rows[0].public, false);
    });
    await t.test("successful installation cannot be silently rerun or replace tokens", async () => {
      await attempt(body);
      assert.equal((await q("select count(*)::integer n from public.vigia_alvos")).rows[0].n, 4);
    });
  } finally {
    await q("rollback");
    await db.end();
    rmSync(folder, { recursive: true, force: true });
  }
});
