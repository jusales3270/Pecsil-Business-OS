import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

// Explicit disposable local DB only, no production configuration inference.
// PECSIL_SECURITY_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54732/postgres node --test tests/ti-backup-isolation.test.mjs
const dsn = process.env.PECSIL_SECURITY_TEST_DATABASE_URL;
const sql = readFileSync(new URL("../infra/vigia/004_backup_isolamento.sql", import.meta.url), "utf8");
const backupSql = readFileSync(new URL("../infra/vigia/002_backup.sql", import.meta.url), "utf8");

test("cloud backup remains append-only despite permissive policies from an existing app", {
  skip: !dsn && "set PECSIL_SECURITY_TEST_DATABASE_URL to a disposable local database",
}, async (t) => {
  const target = new URL(dsn);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "integration fixtures are restricted to localhost");
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  const q = (statement, params = []) => db.query(statement, params);
  const backupUser = randomUUID();
  const otherUser = randomUUID();
  const prefix = `backup-isolation-${randomUUID()}`;
  const otherBucket = prefix;
  const saved = `${prefix}/saved.age`;
  const newObject = `${prefix}/new.age`;
  const legacyPolicy = prefix;
  const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`;
  const as = async (role, uid, run) => {
    await q("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [uid ?? "", JSON.stringify({ role, ...(uid ? { sub: uid } : {}) })]);
    await q(`set local role ${role}`);
    try { return await run(); } finally { await q("reset role"); }
  };
  const refused = async (statement, params = [], codes = ["42501"]) => {
    await q("savepoint backup_denial");
    try {
      await assert.rejects(q(statement, params), (error) => codes.includes(error.code), statement);
    } finally {
      await q("rollback to savepoint backup_denial");
      await q("release savepoint backup_denial");
    }
  };
  const hiddenOrRefused = async (statement, params = []) => {
    await q("savepoint backup_hidden");
    let result;
    let failure;
    try { result = await q(statement, params); } catch (error) { failure = error; }
    await q("rollback to savepoint backup_hidden");
    await q("release savepoint backup_hidden");
    if (failure) assert.equal(failure.code, "42501", failure.message);
    else assert.equal(result.rowCount, 0, statement);
  };
  try {
    await q("begin");
    // Match the actual Storage API deletion guard; all fixtures roll back.
    await q("select set_config('storage.allow_delete_query','true',true)");
    await q("create table if not exists public.vigia_config(chave text primary key, valor text not null)");
    await q("alter table public.vigia_config enable row level security");
    // Use the real authorization function from 002, without cron or outbound calls.
    const authorization = backupSql.match(/create or replace function public\.vigia_e_backup\(\)[\s\S]*?grant execute on function public\.vigia_e_backup\(\) to authenticated;/)?.[0];
    assert.ok(authorization, "load actual 002 authorization function");
    await q(authorization);
    await q("insert into storage.buckets(id,name,public) values('backups','backups',false) on conflict(id) do update set public=false");
    await q("insert into storage.buckets(id,name,public) values($1,$1,false)", [otherBucket]);
    await q("insert into storage.objects(bucket_id,name) values('backups',$1),($2,$3)", [saved, otherBucket, saved]);
    // Worst case inherited policy: grants anonymous and authenticated full access
    // to every bucket. The new restrictive policies must still prevent bypasses.
    await q(`create policy ${quoteIdentifier(legacyPolicy)} on storage.objects as permissive for all to anon,authenticated using(true) with check(true)`);

    await t.test("installation refuses missing authorization and a public backup bucket", async () => {
      await q("savepoint backup_prerequisite");
      await q("alter function public.vigia_e_backup() rename to vigia_e_backup_fixture");
      await refused(sql, [], ["P0001"]);
      await q("rollback to savepoint backup_prerequisite");
      await q("release savepoint backup_prerequisite");
      await q("update storage.buckets set public=true where id='backups'");
      await refused(sql, [], ["P0001"]);
      await q("update storage.buckets set public=false where id='backups'");
    });
    await q(sql);
    await q(sql); // Reapplication preserves application policies and stays idempotent.
    assert.equal((await q("select count(*)::integer n from pg_policy where polrelid='storage.objects'::regclass and polname=$1", [legacyPolicy])).rows[0].n, 1);
    const policies = (await q("select polcmd,polpermissive from pg_policy where polrelid='storage.objects'::regclass and polname like 'vigia: backups isolados %' order by polcmd")).rows;
    assert.deepEqual(policies, ["a", "d", "r", "w"].map((polcmd) => ({ polcmd, polpermissive: false })));

    await t.test("an unset backup user fails closed even with legacy INSERT permission", async () => {
      await q("delete from public.vigia_config where chave='backup_user_id'");
      await as("authenticated", backupUser, async () => {
        await refused("insert into storage.objects(bucket_id,name) values('backups',$1)", [`${prefix}/unset.age`]);
      });
    });
    await q("insert into public.vigia_config(chave,valor) values('backup_user_id',$1) on conflict(chave) do update set valor=excluded.valor", [backupUser]);

    await t.test("other users and anonymous access cannot read or mutate backups", async () => {
      for (const [role, uid] of [["authenticated", otherUser], ["authenticated", null], ["anon", null], ["anon", backupUser]]) {
        await as(role, uid, async () => {
          assert.equal((await q("select name from storage.objects where bucket_id='backups' and name=$1", [saved])).rowCount, 0);
          await hiddenOrRefused("update storage.objects set metadata='{\"tampered\":true}' where bucket_id='backups' and name=$1", [saved]);
          await hiddenOrRefused("delete from storage.objects where bucket_id='backups' and name=$1", [saved]);
          await refused("insert into storage.objects(bucket_id,name) values('backups',$1)", [`${prefix}/${role}-${uid ?? "none"}.age`]);
        });
      }
    });

    await t.test("dedicated account inserts without RETURNING but cannot read, replace, move or delete", async () => {
      await as("authenticated", backupUser, async () => {
        assert.equal((await q("insert into storage.objects(bucket_id,name) values('backups',$1)", [newObject])).rowCount, 1);
        assert.equal((await q("select name from storage.objects where bucket_id='backups' and name=$1", [newObject])).rowCount, 0);
        await hiddenOrRefused("update storage.objects set metadata='{\"tampered\":true}' where bucket_id='backups' and name=$1", [newObject]);
        await hiddenOrRefused("update storage.objects set bucket_id=$1 where bucket_id='backups' and name=$2", [otherBucket, newObject]);
        await hiddenOrRefused("delete from storage.objects where bucket_id='backups' and name=$1", [newObject]);
        await refused("insert into storage.objects(bucket_id,name) values('backups',$1) on conflict(bucket_id,name) do update set metadata='{\"tampered\":true}'", [newObject]);
        // WITH CHECK protects moves from a bucket where this user can edit.
        await refused("update storage.objects set bucket_id='backups' where bucket_id=$1 and name=$2", [otherBucket, saved]);
      });
      const copies = (await q("select name,metadata from storage.objects where bucket_id='backups' and name=any($1::text[]) order by name", [[saved, newObject]])).rows;
      assert.deepEqual(copies.map((row) => row.name).sort(), [saved, newObject].sort());
      assert.ok(copies.every((row) => !row.metadata?.tampered));
    });

    await t.test("legitimate CRUD on another bucket is unchanged, including anonymous access", async () => {
      for (const [role, uid] of [["authenticated", otherUser], ["anon", null]]) {
        await as(role, uid, async () => {
          const name = `${prefix}/${role}.pdf`;
          assert.equal((await q("insert into storage.objects(bucket_id,name) values($1,$2) returning name", [otherBucket, name])).rowCount, 1);
          assert.equal((await q("select name from storage.objects where bucket_id=$1 and name=$2", [otherBucket, name])).rowCount, 1);
          assert.equal((await q("update storage.objects set metadata='{\"checked\":true}' where bucket_id=$1 and name=$2 returning metadata", [otherBucket, name])).rows[0].metadata.checked, true);
          assert.equal((await q("delete from storage.objects where bucket_id=$1 and name=$2 returning name", [otherBucket, name])).rowCount, 1);
        });
      }
    });

    await t.test("administrative retention with service_role still bypasses backup RLS", async () => {
      assert.equal((await q("select rolbypassrls from pg_roles where rolname='service_role'")).rows[0].rolbypassrls, true);
      await as("service_role", null, async () => {
        assert.equal((await q("select name from storage.objects where bucket_id='backups' and name=$1", [saved])).rowCount, 1);
        assert.equal((await q("delete from storage.objects where bucket_id='backups' and name=$1", [saved])).rowCount, 1);
      });
    });
  } finally {
    await q("rollback");
    await db.end();
  }
});
