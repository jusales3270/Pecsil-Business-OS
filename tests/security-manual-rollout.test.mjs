import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const repo = resolve(import.meta.dirname, '..');
const generator = join(repo, 'scripts/ti-security-instalar.py');
const commit = '5398f55ceb18807f1b719b18893ce79e07f96e9e';
const files = ['20261103174707_sara_security.sql', '20261103174840_data_security_boundaries.sql'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const invoke = (script, args) => spawnSync('python3', [script, ...args], { encoding: 'utf8' });
const dsn = process.env.PECSIL_SECURITY_TEST_DATABASE_URL;

function generated(folder, sourceCommit = commit) {
  const artifact = join(folder, `security-${sourceCommit}.sql`);
  const result = invoke(generator, ['--source-commit', sourceCommit, '--output', artifact]);
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(artifact, 'utf8');
}

test('manual security generator rejects unreviewed input and preserves source files', () => {
  const folder = mkdtempSync(join(tmpdir(), 'pecsil-security-generator-'));
  try {
    assert.notEqual(invoke(generator, ['--output', join(folder, 'missing.sql')]).status, 0);
    assert.notEqual(invoke(generator, ['--source-commit', "bad'; select 1; --", '--output', join(folder, 'bad.sql')]).status, 0);
    const artifact = generated(folder);
    assert.match(artifact, /^DO \$pecsil_security_install\$$/m);
    assert.equal([...artifact.matchAll(/^DO \$pecsil_security_install\$$/gm)].length, 1);
    assert.equal([...artifact.matchAll(/^END \$pecsil_security_install\$;$/gm)].length, 1);
    assert.doesNotMatch(artifact, /^(?:BEGIN|COMMIT|ROLLBACK);$/m, 'the DO must not control its caller transaction');
    for (const file of files) {
      const source = readFileSync(join(repo, 'supabase/migrations', file), 'utf8');
      assert.ok(artifact.includes(source));
      assert.ok(artifact.includes(sha(source)));
    }
    // A copied installer must refuse even a one-byte modification to a reviewed patch.
    const copy = join(folder, 'copy');
    mkdirSync(join(copy, 'scripts'), { recursive: true });
    mkdirSync(join(copy, 'supabase/migrations'), { recursive: true });
    copyFileSync(generator, join(copy, 'scripts/ti-security-instalar.py'));
    for (const file of files) copyFileSync(join(repo, 'supabase/migrations', file), join(copy, 'supabase/migrations', file));
    const sourcePath = join(copy, 'supabase/migrations', files[0]);
    const original = readFileSync(sourcePath, 'utf8');
    assert.notEqual(invoke(join(copy, 'scripts/ti-security-instalar.py'), ['--source-commit', commit, '--output', sourcePath]).status, 0);
    assert.equal(readFileSync(sourcePath, 'utf8'), original, 'output cannot overwrite an input');
    writeFileSync(sourcePath, `${original}\n-- unreviewed change\n`);
    const refused = invoke(join(copy, 'scripts/ti-security-instalar.py'), ['--source-commit', commit, '--output', join(folder, 'unreviewed.sql')]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /SHA256/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('atomic manual security rollout without fabricated migration history', {
  skip: !dsn && 'set PECSIL_SECURITY_TEST_DATABASE_URL explicitly to the dedicated local review database',
}, async (t) => {
  const target = new URL(dsn);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.equal(target.port, '54732', 'schema-rebuild fixture is restricted to the dedicated review port');
  assert.equal(target.pathname, '/postgres');
  const folder = mkdtempSync(join(tmpdir(), 'pecsil-security-rollout-'));
  const body = generated(folder);
  const db = new pg.Client({ connectionString: dsn });
  try { await db.connect(); } catch (error) {
    await db.end().catch(() => {});
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  const q = (sql, params = []) => db.query(sql, params);
  const marker = randomUUID();
  const hashes = files.map((file) => sha(readFileSync(join(repo, 'supabase/migrations', file))));
  let currentMigration = 'fixture initialization';
  const attempt = async (sql, message) => {
    await q('savepoint security_attempt');
    let failure;
    try { await q(sql); } catch (error) { failure = error; }
    finally {
      await q('rollback to savepoint security_attempt');
      await q('release savepoint security_attempt');
    }
    assert.equal(failure?.code, 'P0001', failure?.message ?? 'installer must reject this attempt');
    assert.match(failure.message, message);
  };
  const isolated = async (run) => {
    await q('savepoint security_fixture_case');
    try { await run(); } finally {
      await q('rollback to savepoint security_fixture_case');
      await q('release savepoint security_fixture_case');
    }
  };
  const assertMarker = async () => assert.equal((await q('select display_name from public.organizations where id=$1', [marker])).rows[0].display_name, 'Existing application marker');
  const assertNoInstall = async () => {
    const state = (await q("select to_regclass('public.sara_audio_uso') audio,to_regclass('pecsil_ops.security_patches') receipts,to_regprocedure('public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)') server")).rows[0];
    assert.deepEqual(state, { audio: null, receipts: null, server: null });
    await assertMarker();
  };
  try {
    await q('begin');
    await q("set local statement_timeout='120s'; set local lock_timeout='5s'");
    // Only this disposable DB: every fixture DDL, default grant, patch and row is rolled back.
    // Existing auth/storage schemas stay in place. Hide ledgers transactionally to model production.
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    for (const schema of ['supabase_migrations', 'pecsil_ops']) {
      if ((await q('select to_regnamespace($1) is not null as present', [schema])).rows[0].present) {
        await q(`alter schema ${schema} rename to ${schema}_fixture_${suffix}`);
      }
    }
    await q('drop schema public cascade');
    await q('create schema public');
    await q('grant usage on schema public to postgres,anon,authenticated,service_role');
    const migrations = readdirSync(join(repo, 'supabase/migrations')).filter((file) => file.endsWith('.sql') && file < files[0]).sort();
    assert.equal(migrations.length, 179);
    assert.equal(migrations.at(-1), '202611030003_qualidade_ocorrido_e_descarte.sql');
    try {
      for (currentMigration of migrations) await q(readFileSync(join(repo, 'supabase/migrations', currentMigration), 'utf8'));
    } catch (error) {
      throw new Error(`179-migration fixture failed at ${currentMigration}: ${error.message}`, { cause: error });
    }
    await q('insert into public.organizations(id,legal_name,display_name) values($1,$2,$2)', [marker, 'Existing application marker']);
    assert.equal((await q("select to_regnamespace('supabase_migrations') ns")).rows[0].ns, null);

    await t.test('failure after first patch rolls back private schema, DDL, ACL changes and leaves app data', async () => {
      const anchor = `-- Apply reviewed patch ${files[1]};`;
      assert.ok(body.includes(anchor));
      const failing = body.replace(anchor, "RAISE EXCEPTION 'Injected intermediate rollout failure';\n" + anchor);
      const oldAcl = (await q("select has_function_privilege('authenticated','public.sara_registrar(uuid,text,text,text,jsonb,text,integer,integer)','execute') allowed")).rows[0].allowed;
      await attempt(failing, /Injected intermediate/);
      await assertNoInstall();
      assert.equal((await q("select has_function_privilege('authenticated','public.sara_registrar(uuid,text,text,text,jsonb,text,integer,integer)','execute') allowed")).rows[0].allowed, oldAcl);
      assert.equal((await q("select to_regnamespace('pecsil_ops') ns")).rows[0].ns, null);
    });
    await t.test('a SARA index from a partial installation is preserved and blocks installation', async () => isolated(async () => {
      await q('create index whatsapp_contatos_id_org on public.whatsapp_contatos(id,organization_id)');
      await attempt(body, /Artefato novo sem recibo/);
      assert.notEqual((await q("select to_regclass('public.whatsapp_contatos_id_org') idx")).rows[0].idx, null);
      await assertNoInstall();
    }));
    await t.test('an RH function from a partial installation is not overwritten', async () => isolated(async () => {
      await q("create function public.rh_document_validate_binding() returns trigger language plpgsql as 'begin return new; end;'");
      await attempt(body, /Função nova.*sem recibo/);
      assert.notEqual((await q("select to_regprocedure('public.rh_document_validate_binding()') f")).rows[0].f, null);
      await assertNoInstall();
    }));
    await t.test('an unrelated existing pecsil_ops schema is not adopted', async () => isolated(async () => {
      await q('create schema pecsil_ops');
      await q('create table pecsil_ops.existing_marker(id integer)');
      await q('insert into pecsil_ops.existing_marker values(73)');
      await attempt(body, /Esquema pecsil_ops existente incompatível/);
      assert.equal((await q('select id from pecsil_ops.existing_marker')).rows[0].id, 73);
      await assertNoInstall();
    }));
    await t.test('missing prerequisite columns abort before any patch or receipt', async () => isolated(async () => {
      await q('alter table public.profiles rename column access_expires_at to fixture_access_expires_at');
      await attempt(body, /Dependência de estrutura ausente.*access_expires_at/);
      await assertNoInstall();
    }));
    await t.test('an incompatible sara_uso_mes return type is rejected before application', async () => isolated(async () => {
      await q('alter function public.sara_uso_mes(text) rename to fixture_original_sara_uso_mes');
      await q('create function public.sara_uso_mes(text) returns integer language sql as $fixture$select 0$fixture$');
      await attempt(body, /Retorno incompatível.*sara_uso_mes.*bigint/);
      await assertNoInstall();
    }));
    await t.test('successful atomic installation records exactly two receipts, removes default public grants and preserves app data', async () => {
      await q('alter default privileges grant all on tables to anon,authenticated,service_role');
      await q(body); // Exact single DO, no rewritten transaction control.
      const receipts = (await q('select version,filename,sql_sha256,source_commit,applied_at from pecsil_ops.security_patches order by version')).rows;
      assert.equal(receipts.length, 2);
      assert.deepEqual(receipts.map((row) => row.filename), files);
      assert.deepEqual(receipts.map((row) => row.sql_sha256), hashes);
      assert.deepEqual(receipts.map((row) => row.source_commit), [commit, commit]);
      await assertMarker();
      assert.equal((await q("select to_regnamespace('supabase_migrations') ns")).rows[0].ns, null, 'no fabricated Supabase migration history');
      assert.equal((await q("select relrowsecurity from pg_class where oid='pecsil_ops.security_patches'::regclass")).rows[0].relrowsecurity, true);
      for (const principal of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await q("select has_schema_privilege($1,'pecsil_ops','usage') allowed", [principal])).rows[0].allowed, false);
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal((await q("select has_table_privilege($1,'pecsil_ops.security_patches',$2) allowed", [principal, privilege])).rows[0].allowed, false);
        assert.equal((await q("select has_function_privilege($1,'public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)','execute') allowed", [principal])).rows[0].allowed, principal === 'service_role');
      }
      assert.equal((await q("select has_function_privilege('service_role','public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)','execute') allowed")).rows[0].allowed, true);
    });
    await t.test('same-SHA reapplication is a no-op with postconditions and unchanged receipts', async () => {
      const before = (await q("select (select oid from pg_class where oid='public.sara_audio_uso'::regclass) audio_oid,(select jsonb_agg(to_jsonb(p) order by version) from pecsil_ops.security_patches p) receipts")).rows[0];
      await q('grant usage on schema pecsil_ops to anon,authenticated,service_role');
      await q('grant select,insert,update,delete on pecsil_ops.security_patches to anon,authenticated,service_role');
      await q(generated(folder, '1'.repeat(40))); // A later source commit with identical SQL does not replace the original receipts.
      const after = (await q("select (select oid from pg_class where oid='public.sara_audio_uso'::regclass) audio_oid,(select jsonb_agg(to_jsonb(p) order by version) from pecsil_ops.security_patches p) receipts")).rows[0];
      assert.deepEqual(after, before);
      assert.equal((await q("select has_schema_privilege('authenticated','pecsil_ops','usage') allowed")).rows[0].allowed, false);
      await assertMarker();
    });
    await t.test('one missing receipt aborts instead of repeating a patch', async () => isolated(async () => {
      await q('delete from pecsil_ops.security_patches where version=$1', [files[0].split('_')[0]]);
      await attempt(body, /Recibos parciais ou SHA256 divergente/);
      assert.equal((await q('select count(*)::integer n from pecsil_ops.security_patches')).rows[0].n, 1);
      await assertMarker();
    }));
    await t.test('divergent receipt hashes abort without overwriting evidence', async () => isolated(async () => {
      await q('update pecsil_ops.security_patches set sql_sha256=$1 where version=$2', ['0'.repeat(64), files[0].split('_')[0]]);
      await attempt(body, /Recibos parciais ou SHA256 divergente/);
      assert.equal((await q('select sql_sha256 from pecsil_ops.security_patches where version=$1', [files[0].split('_')[0]])).rows[0].sql_sha256, '0'.repeat(64));
      await assertMarker();
    }));
    await t.test('a weakened function body is rejected on retry even with unchanged ACL and triggers', async () => isolated(async () => {
      await q("create or replace function public.rh_request_protect_decision() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $tamper$begin return new; end;$tamper$");
      await attempt(body, /Pós-condição do corpo da função falhou.*rh_request_protect_decision/);
      assert.equal((await q("select prosrc from pg_proc where oid='public.rh_request_protect_decision()'::regprocedure")).rows[0].prosrc, 'begin return new; end;');
      await assertMarker();
    }));
    await t.test('postcondition drift is detected on retry, rather than trusting receipts alone', async () => isolated(async () => {
      await q('grant execute on function public.sara_audio_reservar(uuid,uuid,text,integer) to authenticated');
      await attempt(body, /Função do servidor acessível pelo cliente/);
      assert.equal((await q("select has_function_privilege('authenticated','public.sara_audio_reservar(uuid,uuid,text,integer)','execute') allowed")).rows[0].allowed, true);
      await assertMarker();
    }));
  } finally {
    await q('rollback');
    await db.end();
    rmSync(folder, { recursive: true, force: true });
  }
});
