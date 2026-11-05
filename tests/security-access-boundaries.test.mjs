import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

// Opt-in integration suite. Uses real RLS/triggers/RPCs, never production; all fixtures roll back.
// PECSIL_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54732/postgres node --test tests/security-access-boundaries.test.mjs
const dsn = process.env.PECSIL_TEST_DATABASE_URL;

test('security boundaries against authenticated database roles', { skip: !dsn && 'set PECSIL_TEST_DATABASE_URL to a disposable local database' }, async (t) => {
  const target = new URL(dsn);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'integration fixtures are restricted to localhost');
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  const org = randomUUID();
  const foreignOrg = randomUUID();
  const identities = Object.fromEntries(['operator', 'approver', 'viewer', 'employee', 'foreign'].map((name) => [name, { user: randomUUID(), profile: randomUUID(), employee: randomUUID(), org: name === 'foreign' ? foreignOrg : org }]));
  const query = (sql, params = []) => db.query(sql, params);
  const as = async (name, run) => {
    await query('reset role');
    await query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [identities[name].user, JSON.stringify({ sub: identities[name].user, role: 'authenticated' })]);
    await query('set local role authenticated');
    await query('savepoint security_actor');
    try {
      const result = await run();
      await query('release savepoint security_actor');
      await query('reset role');
      return result;
    } catch (error) {
      await query('rollback to savepoint security_actor');
      await query('release savepoint security_actor');
      await query('reset role');
      throw error;
    }
  };
  const blocked = async (sql, params = []) => {
    await query('savepoint security_denial');
    let failure;
    let result;
    try { result = await query(sql, params); } catch (error) { failure = error; }
    await query('rollback to savepoint security_denial');
    await query('release savepoint security_denial');
    if (failure) assert.equal(failure.code, '42501', failure.message);
    else assert.equal(result.rowCount, 0, 'unauthorized mutation must affect no rows');
  };
  const absence = randomUUID();
  const benefit = randomUUID();
  const plan = randomUUID();
  const title = randomUUID();
  const installment = randomUUID();
  const forecastTitle = randomUUID();
  const forecastInstallment = randomUUID();
  const documents = Object.fromEntries(['internal', 'confidential', 'owned', 'foreign', 'orphan'].map((key) => [key, { id: randomUUID(), object: randomUUID(), path: `${key === 'foreign' ? foreignOrg : org}/${randomUUID()}/${key}.pdf` }]));
  const companyPrevious = randomUUID();
  const companyOther = randomUUID();
  try {
    await query('begin');
    // Storage API sets this guard before its SQL DELETE. RLS remains active for every actor.
    await query("select set_config('storage.allow_delete_query','true',true)");
    await query("insert into public.organizations(id,legal_name,display_name) values ($1,'Security fixture','Security fixture'),($2,'Other security fixture','Other security fixture')", [org, foreignOrg]);
    for (const [name, identity] of Object.entries(identities)) {
      await query('insert into auth.users(id,email) values ($1,$2)', [identity.user, `${name}-${identity.user}@security.invalid`]);
      await query("insert into public.profiles(id,user_id,organization_id,email,full_name,status) values ($1,$2,$3,$4,$5,'active')", [identity.profile, identity.user, identity.org, `${name}-${identity.user}@security.invalid`, name]);
      await query('insert into public.employees(id,organization_id,profile_id,employee_number,full_name) values ($1,$2,$3,$4,$5)', [identity.employee, identity.org, identity.profile, identity.employee, name]);
    }
    const grants = {
      operator: { 'rh.documentos': 'operar', 'rh.ferias': 'operar', 'rh.beneficios': 'operar', 'financeiro.pagar': 'operar', 'financeiro.receber': 'operar' },
      approver: { 'rh.documentos': 'aprovar', 'rh.ferias': 'aprovar', 'rh.beneficios': 'aprovar', 'financeiro.pagar': 'aprovar', 'financeiro.receber': 'aprovar' },
      viewer: { 'rh.documentos': 'ver' },
      foreign: { 'rh.documentos': 'aprovar' },
    };
    for (const [name, features] of Object.entries(grants)) for (const [feature, level] of Object.entries(features)) {
      const identity = identities[name];
      await query('insert into public.user_feature_grants(organization_id,profile_id,feature_code,level) values ($1,$2,$3,$4)', [identity.org, identity.profile, feature, level]);
    }
    for (const [kind, document] of Object.entries(documents)) {
      const documentOrg = kind === 'foreign' ? foreignOrg : org;
      await query("insert into storage.objects(id,bucket_id,name,owner_id) values ($1,'rh-documents',$2,$3)", [document.object, document.path, identities.operator.user]);
      if (kind !== 'orphan') await query("insert into public.documents(id,organization_id,module_code,storage_bucket,object_path,title,classification,owner_profile_id,category) values ($1,$2,'rh','rh-documents',$3,$4,$5,$6,'Security')", [document.id, documentOrg, document.path, kind, ['confidential', 'owned'].includes(kind) ? 'confidential' : 'internal', kind === 'owned' ? identities.viewer.profile : identities.approver.profile]);
    }
    await query("insert into public.rh_benefit_plans(id,organization_id,name,category) values ($1,$2,'Security plan','food')", [plan, org]);
    await query("insert into public.rh_absences(id,organization_id,employee_id,absence_type,start_date,end_date,days,status) values ($1,$2,$3,'vacation',current_date + 60,current_date + 61,2,'pending')", [absence, org, identities.employee.employee]);
    await query("insert into public.rh_benefit_requests(id,organization_id,employee_id,plan_id,action) values ($1,$2,$3,$4,'enroll')", [benefit, org, identities.employee.employee, plan]);
    await query("insert into public.finance_approval_rules(organization_id,name,direction,min_amount,approval_level,approver_profile_id) values ($1,'Security approval','payable',0,1,$2)", [org, identities.approver.profile]);
    await query("insert into public.finance_titles(id,organization_id,direction,counterparty_name,description,issue_date,original_amount,status,created_by_profile_id) values ($1,$2,'payable','Fixture','Security title',current_date,100,'pending_approval',$3)", [title, org, identities.operator.profile]);
    await query("insert into public.finance_installments(id,organization_id,title_id,installment_number,due_date,amount) values ($1,$2,$3,1,current_date + 10,100)", [installment, org, title]);
    await query("insert into public.finance_titles(id,organization_id,direction,counterparty_name,description,issue_date,original_amount,status,is_forecast) values ($1,$2,'payable','Forecast','Security forecast',current_date,100,'approved',true)", [forecastTitle, org]);
    await query("insert into public.finance_installments(id,organization_id,title_id,installment_number,due_date,amount) values ($1,$2,$3,1,current_date + 10,100)", [forecastInstallment, org, forecastTitle]);
    for (const [id, feature, hash, path] of [[companyPrevious, 'financeiro.pagar', 'a'.repeat(64), 'previous.pdf'], [companyOther, 'financeiro.receber', 'b'.repeat(64), 'other.pdf']]) {
      await query("insert into public.company_documents(id,organization_id,module_code,feature_code,title,original_name,size_bytes,sha256,storage_path) values ($1,$2,'financeiro',$3,'Fixture','fixture.pdf',1,$4,$5)", [id, org, feature, hash, `${org}/financeiro/${path}`]);
    }

    await t.test('RH viewer sees internal and owned confidential files, but not confidential or orphan files', async () => as('viewer', async () => {
      const result = await query("select name from storage.objects where bucket_id='rh-documents' and name = any($1::text[])", [Object.values(documents).map((d) => d.path)]);
      assert.deepEqual(result.rows.map((r) => r.name).sort(), [documents.internal.path, documents.owned.path].sort());
    }));
    await t.test('RH operator cannot modify or delete a confidential file even when they uploaded it', async () => as('operator', async () => {
      await blocked('update storage.objects set metadata = $1 where id = $2', [{ altered: true }, documents.confidential.object]);
      await blocked('delete from storage.objects where id = $1', [documents.confidential.object]);
      await blocked('update storage.objects set name = $1 where id = $2', [documents.orphan.path, documents.internal.object]);
    }));
    await t.test('RH approver may read and replace sensitive files; other organizations remain hidden', async () => as('approver', async () => {
      assert.equal((await query('select id from storage.objects where id=$1', [documents.confidential.object])).rowCount, 1);
      assert.equal((await query('update storage.objects set metadata=$1 where id=$2', [{ checked: true }, documents.confidential.object])).rowCount, 1);
      assert.equal((await query('select id from storage.objects where id=$1', [documents.foreign.object])).rowCount, 0);
    }));
    await t.test('RH orphan cannot be relinked by another uploader or used to expose an existing sensitive path', async () => as('operator', async () => {
      await blocked("insert into public.documents(organization_id,module_code,storage_bucket,object_path,title,classification,category) values ($1,'rh','rh-documents',$2,'Forged','internal','Security')", [org, documents.confidential.path]);
    }));
    await t.test("an approver cannot register someone else's unregistered upload", async () => as('approver', async () => {
      await blocked("insert into public.documents(organization_id,module_code,storage_bucket,object_path,title,classification,category) values ($1,'rh','rh-documents',$2,'Stolen orphan','internal','Security')", [org, documents.orphan.path]);
    }));
    await t.test('fresh browser upload precedes metadata safely and becomes readable only after registration', async () => as('operator', async () => {
      const path = `${org}/${randomUUID()}/fresh.pdf`;
      await query("insert into storage.objects(bucket_id,name,owner_id) values ('rh-documents',$1,$2)", [path, identities.operator.user]);
      assert.equal((await query('select id from storage.objects where name=$1', [path])).rowCount, 0);
      await query("insert into public.documents(organization_id,module_code,storage_bucket,object_path,title,classification,owner_profile_id,category) values ($1,'rh','rh-documents',$2,'Fresh','internal',$3,'Security')", [org, path, identities.operator.profile]);
      assert.equal((await query('select id from storage.objects where name=$1', [path])).rowCount, 1);
      assert.equal((await query('delete from storage.objects where name=$1', [path])).rowCount, 1);
      assert.equal((await query('delete from public.documents where object_path=$1', [path])).rowCount, 1);
    }));
    for (const [table, kind] of [['rh_absences', 'absence'], ['rh_benefit_requests', 'benefit']]) {
      const insert = kind === 'absence'
        ? "insert into public.rh_absences(organization_id,employee_id,absence_type,start_date,end_date,days,status,requested_by_profile_id,requested_at,decided_by_profile_id,decided_at) values ($1,$2,'vacation',current_date + 90,current_date + 91,2,$3,$4,'2000-01-01',$5,$6) returning *"
        : "insert into public.rh_benefit_requests(organization_id,employee_id,plan_id,action,status,requested_by_profile_id,requested_at,decided_by_profile_id,decided_at) values ($1,$2,$7,'enroll',$3,$4,'2000-01-01',$5,$6) returning *";
      const params = (status, decided = null) => [org, identities.employee.employee, status, identities.approver.profile, decided ? identities.approver.profile : null, decided, ...(kind === 'benefit' ? [plan] : [])];
      await t.test(`${table}: employee cannot insert a preapproved request or forge decision fields`, async () => as('employee', async () => {
        await blocked(insert, params('approved', '2000-01-01'));
        await blocked(insert, params('pending', '2000-01-01'));
        const created = (await query(insert, params('pending'))).rows[0];
        assert.equal(created.status, 'pending');
        assert.equal(created.requested_by_profile_id, identities.employee.profile);
        assert.ok(new Date(created.requested_at).getTime() > Date.now() - 600_000);
        assert.equal(created.decided_by_profile_id, null);
      }));
      await t.test(`${table}: approver decisions use session actor and database time`, async () => as('approver', async () => {
        const created = (await query(insert, params('approved', '2000-01-01'))).rows[0];
        assert.equal(created.decided_by_profile_id, identities.approver.profile);
        assert.ok(new Date(created.decided_at).getTime() > Date.now() - 600_000);
        const updated = (await query(`update public.${table} set status='approved',decided_by_profile_id=$1,decided_at='2000-01-01' where id=$2 returning *`, [identities.employee.profile, kind === 'absence' ? absence : benefit])).rows[0];
        assert.equal(updated.decided_by_profile_id, identities.approver.profile);
        assert.ok(new Date(updated.decided_at).getTime() > Date.now() - 600_000);
      }));
    }
    await t.test('finance pending approval cannot retreat to draft or be forged through custom flags', async () => as('operator', async () => {
      await blocked("update public.finance_titles set status='draft' where id=$1", [title]);
      await query("select set_config('pecsil.financeiro_aprovacao','1',true),set_config('pecsil.carga_em_lote','1',true)");
      await blocked("update public.finance_titles set status='approved' where id=$1", [title]);
      await blocked('update public.finance_titles set approved_by_profile_id=$1,approved_at=now() where id=$2', [identities.operator.profile, title]);
      const direct = (await query("insert into public.finance_titles(organization_id,direction,counterparty_name,description,issue_date,original_amount,status,is_historical) values ($1,'payable','Bypass','Fixture',current_date,100,'approved',true) returning status", [org])).rows[0];
      assert.equal(direct.status, 'pending_approval');
      await query("select set_config('pecsil.financeiro_aprovacao','',true),set_config('pecsil.carga_em_lote','',true)");
    }));
    await t.test('finance operator cannot forge installment totals, settled status, oversized amounts or settlements', async () => as('operator', async () => {
      await blocked('update public.finance_installments set settled_amount=100 where id=$1', [installment]);
      await blocked("update public.finance_installments set status='settled' where id=$1", [installment]);
      await blocked('update public.finance_installments set amount=1000 where id=$1', [installment]);
      await blocked("insert into public.finance_installments(organization_id,title_id,installment_number,due_date,amount,settled_amount,status) values ($1,$2,2,current_date,1,1,'settled')", [org, title]);
      await blocked('insert into public.finance_settlements(organization_id,installment_id,settlement_date,amount) values ($1,$2,current_date,100)', [org, installment]);
      assert.equal((await query('update public.finance_installments set due_date=current_date + 12 where id=$1', [installment])).rowCount, 1);
    }));
    await t.test('finance RPC approval, partial settlement, full settlement and reversal remain authorized', async () => {
      await as('operator', async () => blocked('select public.finance_aprovar_titulo($1)', [title]));
      await as('approver', async () => {
        const approved = (await query('select public.finance_aprovar_titulo($1) as result', [title])).rows[0].result;
        assert.equal(approved.aprovado, true);
        assert.equal((await query('select status from public.finance_titles where id=$1', [title])).rows[0].status, 'approved');
        await query('select public.finance_settle_title($1,current_date,40)', [title]);
        assert.equal(Number((await query('select settled_amount from public.finance_installments where id=$1', [installment])).rows[0].settled_amount), 40);
        await query('select public.finance_settle_title($1,current_date,60)', [title]);
        assert.equal((await query('select status from public.finance_titles where id=$1', [title])).rows[0].status, 'settled');
        const settlements = (await query('select id from public.finance_settlements where installment_id=$1', [installment])).rows;
        for (const settlement of settlements) await query("select public.finance_estornar_baixa($1,'Security fixture reversal')", [settlement.id]);
        assert.equal(Number((await query('select settled_amount from public.finance_installments where id=$1', [installment])).rows[0].settled_amount), 0);
        assert.equal((await query('select status from public.finance_titles where id=$1', [title])).rows[0].status, 'approved');
      });
    });
    await t.test('approved forecast cannot be settled; realize, approve and settle remains valid', async () => {
      await as('approver', async () => blocked('select public.finance_settle_title($1,current_date,100)', [forecastTitle]));
      await as('operator', async () => {
        await query('update public.finance_titles set original_amount=1000,is_forecast=true where id=$1', [forecastTitle]);
        await query('update public.finance_installments set amount=1000 where id=$1', [forecastInstallment]);
      });
      await as('approver', async () => blocked('select public.finance_settle_title($1,current_date,1000)', [forecastTitle]));
      await as('operator', async () => {
        await query('update public.finance_titles set is_forecast=false where id=$1', [forecastTitle]);
        assert.equal((await query('select status from public.finance_titles where id=$1', [forecastTitle])).rows[0].status, 'pending_approval');
      });
      await as('approver', async () => {
        await blocked('select public.finance_settle_title($1,current_date,1000)', [forecastTitle]);
        await query('select public.finance_aprovar_titulo($1)', [forecastTitle]);
        await query('select public.finance_settle_title($1,current_date,1000)', [forecastTitle]);
        assert.equal((await query('select status from public.finance_titles where id=$1', [forecastTitle])).rows[0].status, 'settled');
      });
    });
    const register = 'select public.company_document_register($1,$2,$3,null,$4,$5,$6,$7,$8,$9,null,null,null,$10) as result';
    const registration = (feature, previous, hash = 'c'.repeat(64)) => ['financeiro', feature, 'New fixture', 'new.pdf', 'application/pdf', 1, hash, `${org}/financeiro/${randomUUID()}.pdf`, 'envio', previous];
    await t.test('company document cannot replace a different feature even when both features are granted', async () => as('operator', async () => {
      await blocked(register, registration('financeiro.pagar', companyOther));
      const result = (await query(register, registration('financeiro.pagar', companyPrevious))).rows[0].result;
      assert.equal(result.versao, 2);
      assert.equal((await query('select superseded_by from public.company_documents where id=$1', [companyPrevious])).rows[0].superseded_by, result.id);
    }));
    await t.test('company deduplication does not return the id of another feature', async () => as('operator', async () => {
      const result = (await query(register, registration('financeiro.pagar', null, 'b'.repeat(64)))).rows[0].result;
      assert.equal(result.existente, false);
      assert.notEqual(result.id, companyOther);
    }));
  } finally {
    await db.query('rollback');
    await db.end();
  }
});
