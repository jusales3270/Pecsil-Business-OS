from pathlib import Path
import hashlib

import argparse
import re

parser = argparse.ArgumentParser(description='Gera o SQL aditivo do backup no projeto Pecsil existente; não conecta a nenhum banco.')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--project-url', required=True)
args = parser.parse_args()
if not re.fullmatch(r'https://[a-z0-9]{20}\.supabase\.co/?', args.project_url):
    parser.error('Informe somente a URL HTTPS de um projeto Supabase, sem credenciais ou parâmetros.')
project_url = args.project_url.rstrip('/')
repo = Path(__file__).resolve().parents[1]
out = args.output
tables = "'alerts','chat_messages','companies','knowledge_chunks','profiles','report_snapshots','sheet_rows'"
metadata = """jsonb_build_object(
 'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
 'policies',(select jsonb_agg(jsonb_build_array(p.polname,p.polpermissive,p.polroles::text,p.polcmd,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal))"""
preflight = f"""-- Instalação aditiva de backup externo no projeto {project_url}.
-- Preserva as sete tabelas existentes e seus registros. Sem senhas/tokens neste arquivo.
-- Executar UMA VEZ no SQL Editor desse projeto, como postgres.
-- Cria o monitor e seus agendamentos, bucket privado e proteção do backup.
-- Conflitos ou falhas cancelam a transação inteira; uma instalação já feita é recusada.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
do $preflight$
declare t text; collision boolean;
begin
 if not pg_try_advisory_xact_lock(hashtext('pecsil.vigia.shared-bootstrap')) then
  raise exception 'Outra instalação do backup está em andamento';
 end if;
 foreach t in array array[{tables}] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=t and c.relkind in ('r','p')) then
   raise exception 'Tabela esperada ausente: %. Confira o projeto antes de executar',t;
  end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and left(c.relname,6)='vigia_')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,6)='vigia_')
 or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and left(t.typname,6)='vigia_') then
  raise exception 'Estrutura vigia_ já existe. Instalação interrompida para preservar sua configuração';
 end if;
 if exists(select 1 from storage.buckets where id='backups' or name='backups') then
  raise exception 'Bucket backups já existe. Nenhuma alteração aplicada';
 end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename in ('objects','buckets') and left(policyname,5)='vigia') then
  raise exception 'Política Vigia já existe. Nenhuma alteração aplicada';
 end if;
 if to_regclass('cron.job') is not null then
  execute 'select exists(select 1 from cron.job where jobname in (''vigia-minuto'',''vigia-limpar'',''vigia-backup-limpar''))' into collision;
  if collision then raise exception 'Agendamento Vigia já existe. Nenhuma alteração aplicada'; end if;
 end if;
end $preflight$;

-- Registra somente definições, sem ler os dados de negócio.
create temporary table pecsil_backup_tabelas_antes on commit drop as
 select c.oid as object_id,{metadata} as definition
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ({tables});
create temporary table pecsil_backup_funcoes_antes on commit drop as
 select p.oid as object_id,md5(pg_get_functiondef(p.oid)) as definition,p.proacl::text as acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind in ('f','p');
create temporary table pecsil_backup_politicas_antes on commit drop as
 select p.oid as object_id,to_jsonb(p) as definition from pg_policy p
 where p.polrelid in ('storage.objects'::regclass,'storage.buckets'::regclass);
create temporary table pecsil_backup_buckets_antes on commit drop as
 select b.id,to_jsonb(b) as definition from storage.buckets b;
"""
parts = [preflight]
for name in ['001_vigia.sql','002_backup.sql','003_painel.sql','004_backup_isolamento.sql']:
    content = (repo/'infra/vigia'/name).read_text()
    parts.append(f'\n-- Fonte: infra/vigia/{name}\n-- SHA256: {hashlib.sha256(content.encode()).hexdigest()}\n{content}\n')
parts.append(f"""
insert into public.vigia_config(chave,valor)
 values('projeto_url','{project_url}');

-- As definições e permissões anteriores precisam continuar idênticas.
do $verify$
begin
 if exists(select 1 from pecsil_backup_tabelas_antes b left join pg_class c on c.oid=b.object_id
  where c.oid is null or b.definition is distinct from {metadata}) then
  raise exception 'Uma definição da aplicação mudou; instalação inteira revertida';
 end if;
 if exists(select 1 from pecsil_backup_funcoes_antes b left join pg_proc p on p.oid=b.object_id
  where p.oid is null or b.definition is distinct from md5(pg_get_functiondef(p.oid)) or b.acl is distinct from p.proacl::text) then
  raise exception 'Uma função anterior mudou; instalação inteira revertida';
 end if;
 if exists(select 1 from pecsil_backup_politicas_antes b left join pg_policy p on p.oid=b.object_id
  where p.oid is null or b.definition is distinct from to_jsonb(p)) then
  raise exception 'Uma política anterior mudou; instalação inteira revertida';
 end if;
 if exists(select 1 from pecsil_backup_buckets_antes b left join storage.buckets s on s.id=b.id
  where s.id is null or b.definition is distinct from to_jsonb(s)) then
  raise exception 'Um bucket anterior mudou; instalação inteira revertida';
 end if;
end $verify$;
commit;

select
 to_regclass('public.vigia_alvos') is not null as vigia_instalado,
 to_regprocedure('public.vigia_sinal(text,text,jsonb)') is not null as sinal_instalado,
 exists(select 1 from storage.buckets where id='backups' and public=false) as backup_privado,
 (select count(*)=4 from pg_policy where polrelid='storage.objects'::regclass and not polpermissive
  and polname in ('vigia: backups isolados select','vigia: backups isolados insert','vigia: backups isolados update','vigia: backups isolados delete')) as isolamento_instalado;
-- Ainda falta criar/configurar a conta dedicada, tokens e credenciais no Coolify,
-- executar um backup completo e verificar a restauração antes de alterar produção.
""")
out.write_text('\n'.join(parts))
print(out)
print('SHA256',hashlib.sha256(out.read_bytes()).hexdigest())
