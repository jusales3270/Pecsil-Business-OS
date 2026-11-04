import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

// Explicit disposable DB only; never infer a DSN from production environment files.
const dsn = process.env.PECSIL_SECURITY_TEST_DATABASE_URL;
test("SARA/WhatsApp security: server ledger ACL, attribution, object paths, tenant links, audio cap and bigint", { skip: !dsn }, async () => {
  const target = new URL(dsn);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "integration fixtures are restricted to localhost");
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  await db.query("begin");
  const q = (s, p=[]) => db.query(s,p);
  const denied = async (s,p,code) => { await q("savepoint attack"); await assert.rejects(q(s,p), (e) => e.code===code); await q("rollback to savepoint attack"); };
  const [a,b,ua,ub,pa,pb,ca,cb,doc,other] = Array.from({length:10},randomUUID);
  try {
    await q("insert into public.organizations(id,legal_name,display_name) values($1,'Security A','Security A'),($2,'Security B','Security B')",[a,b]);
    await q("insert into auth.users(id,email,aud,role) values($1,$3,'authenticated','authenticated'),($2,$4,'authenticated','authenticated')",[ua,ub,`${ua}@test.invalid`,`${ub}@test.invalid`]);
    await q("insert into public.profiles(id,user_id,organization_id,email,full_name,status,is_owner) values($1,$3,$5,$7,'A','active',true),($2,$4,$6,$8,'B','active',true)",[pa,pb,ua,ub,a,b,`${ua}@test.invalid`,`${ub}@test.invalid`]);
    await q("insert into public.sara_modulos(organization_id,modulo,teto_tokens_mes) values($1,'warroom',100000),($2,'warroom',100000) on conflict(organization_id,modulo) do update set teto_tokens_mes=100000",[a,b]);
    const acl = (await q("select has_function_privilege('authenticated','public.sara_registrar(uuid,text,text,text,jsonb,text,integer,integer)','execute') old, has_function_privilege('authenticated','public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)','execute') browser, has_function_privilege('service_role','public.sara_registrar_servidor(uuid,uuid,uuid,text,text,text,jsonb,text,integer,integer)','execute') server")).rows[0];
    assert.deepEqual(acl,{old:false,browser:false,server:true});
    const registrar="select public.sara_registrar_servidor($1,$2,null,'warroom','hello','response','{}','test',10,20) as ids";
    await denied(registrar,[a,pb],"42501");
    const ids = (await q(registrar,[a,pa])).rows[0].ids;
    assert.ok(ids.conversa && ids.mensagem);
    await denied("select public.sara_registrar_servidor($1,$2,$3,'financeiro','p','r','{}','test',1,1)",[a,pa,ids.conversa],"42501");
    await denied("select public.sara_registrar_servidor($1,$2,null,'warroom','p','r','{}','test',2147483647,1)",[a,pa],"22023");
    await q("insert into public.whatsapp_canais(id,organization_id,instancia,nome) values($1,$3,$5,'Canal A'),($2,$4,$6,'Canal B')",[ca,cb,a,b,`pecsil-${ca}`,`pecsil-${cb}`]);
    const contato = "insert into public.whatsapp_contatos(organization_id,canal_id,lista,numero,profile_id,sara_modulo) values($1,$2,'interna','5511999999999',$3,'warroom') returning id";
    await denied(contato,[a,ca,pb],"23514");
    await denied(contato,[a,cb,pa],"23514");
    const contatoLocal=(await q(contato,[a,ca,pa])).rows[0].id;
    const contatoEstrangeiro=(await q(contato,[b,cb,pb])).rows[0].id;
    await denied("insert into public.sara_vigia_transmissao(organization_id,contato_id) values($1,$2)",[a,contatoEstrangeiro],"23514");
    await q("insert into public.sara_vigia_transmissao(organization_id,contato_id) values($1,$2)",[a,contatoLocal]);
    await denied("update public.sara_vigia_transmissao set organization_id=$1 where contato_id=$2",[b,contatoLocal],"23514");
    await denied("update public.whatsapp_contatos set organization_id=$1,canal_id=$2,profile_id=$3,numero='5511888888888' where id=$4",[b,cb,pb,contatoLocal],"23503");
    await denied("insert into public.whatsapp_mensagens(organization_id,canal_id,direcao,tipo,situacao) values($1,$2,'entrada','texto','recebida')",[a,cb],"23514");
    await denied("insert into public.whatsapp_agendados(organization_id,canal_id,para_nome,quando,texto) values($1,$2,'Security',now(),'hello')",[a,cb],"23514");
    await q("insert into public.sara_documentos(id,organization_id,numero,tipo,titulo,criado_por) values($1,$3,'DOC-2026-9001','relatorio','Owned', $4),($2,$3,'DOC-2026-9002','relatorio','Other', $4)",[doc,other,a,pa]);
    const path=`${a}/${doc}/owned.pdf`, wrong=`${a}/${other}/other.pdf`;
    await q("insert into storage.objects(bucket_id,name,metadata) values('sara-documentos',$1,'{\"size\":100}'),('sara-documentos',$2,'{\"size\":100}')",[path,wrong]);
    const attach="select public.sara_documento_arquivo_servidor($1,$2,$3,$4,1,100)";
    await denied(attach,[a,pa,doc,wrong],"42501");
    await denied(attach,[b,pb,doc,path],"42501");
    await q(attach,[a,pa,doc,path]);
    for(let i=0;i<6;i++) await q("select public.sara_audio_reservar($1,$2,'warroom',5000)",[a,pa]);
    await denied("select public.sara_audio_reservar($1,$2,'warroom',5000)",[a,pa],"54000");
    await denied("select public.sara_audio_reservar($1,$2,'warroom',5000)",[a,pb],"42501");
    await q("update public.sara_mensagens set tokens_entrada=2147483647,tokens_saida=2147483647 where id=$1",[ids.mensagem]);
    await q("select set_config('request.jwt.claim.sub',$1,true)",[ua]);
    const usage=(await q("select public.sara_uso_mes('warroom')::text as value")).rows[0].value;
    assert.equal(usage,'4294997294');
    await denied("select public.sara_audio_reservar($1,$2,'warroom',200000)",[b,pb],"54000");
  } finally { await q("rollback"); await db.end(); }
});
