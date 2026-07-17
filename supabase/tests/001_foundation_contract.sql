-- Validação estrutural, segura para execução após as migrations.
do $$
declare
  missing_tables text[];
  rls_disabled text[];
begin
  select array_agg(required.name order by required.name)
  into missing_tables
  from (values
    ('organizations'), ('units'), ('departments'), ('teams'), ('positions'),
    ('profiles'), ('employees'), ('roles'), ('role_permissions'), ('access_scopes'),
    ('user_roles'), ('documents'), ('notifications'), ('audit_logs'),
    ('modules'), ('organization_modules')
  ) as required(name)
  where to_regclass('public.' || required.name) is null;

  if missing_tables is not null then
    raise exception 'Tabelas ausentes: %', array_to_string(missing_tables, ', ');
  end if;

  select array_agg(c.relname order by c.relname)
  into rls_disabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'organizations','units','departments','teams','positions','profiles','employees',
      'roles','role_permissions','access_scopes','user_roles','documents','notifications',
      'audit_logs','modules','organization_modules'
    ])
    and not c.relrowsecurity;

  if rls_disabled is not null then
    raise exception 'RLS desabilitado: %', array_to_string(rls_disabled, ', ');
  end if;

  if to_regprocedure('public.can_access_module(text)') is null then
    raise exception 'Função can_access_module(text) ausente';
  end if;

  raise notice 'Contrato da Fundação Pecsil validado: 16 tabelas, RLS e autorização modular presentes.';
end $$;
