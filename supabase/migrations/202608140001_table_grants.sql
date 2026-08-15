-- ============================================================================
-- Pecsil Business OS — privilégios de tabela
--
-- PROBLEMA CORRIGIDO
-- As migrations anteriores criaram 26 tabelas, ativaram RLS e escreveram 57
-- policies, mas nunca concederam privilégio de DML a nenhum papel. A ACL
-- resultante era `anon=Dxtm | authenticated=Dxtm | service_role=Dxtm` — ou
-- seja, TRUNCATE, REFERENCES, TRIGGER e MAINTAIN, sem SELECT, INSERT, UPDATE
-- ou DELETE.
--
-- Consequência: toda consulta retornava 403 "permission denied". O RLS sequer
-- era avaliado, porque o grant barra antes. A aplicação inteira ficaria de pé
-- sem conseguir ler uma linha, e o bootstrap administrativo falhava.
--
-- Descoberto em 14/08/2026 ao aplicar as migrations num Supabase local.
--
-- MODELO DE AUTORIZAÇÃO EM DUAS CAMADAS
--   1. GRANT   — quem pode tentar. Grosso, por papel.
--   2. RLS     — quais linhas cada um enxerga. Fino, por organização, papel,
--                permissão e escopo.
--
-- `anon` continua SEM nenhum privilégio: visitante não autenticado não fala
-- com o domínio. Isso é intencional e não deve ser afrouxado.
-- ============================================================================

-- --- Papel anônimo: acesso zero, de forma determinística -------------------
-- Muitas instalações do Supabase concedem SELECT a `anon` por padrão (via
-- ALTER DEFAULT PRIVILEGES), para que tabelas criadas pelo dashboard fiquem
-- imediatamente acessíveis — a proteção lá é só o RLS. No nosso modelo o
-- visitante anônimo não fala com o domínio, então revogamos explicitamente.
-- Sem isto, o resultado dependeria da configuração de cada servidor.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Neutraliza também as concessões padrão a `anon` deixadas por papéis comuns
-- do Supabase, para que tabelas futuras não voltem a concedê-las. Best-effort.
do $$
declare owner_role text;
begin
  foreach owner_role in array array['postgres','supabase_admin','authenticator','anon','service_role']
  loop
    begin
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon', owner_role);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', owner_role);
    exception when others then
      null; -- papel inexistente ou sem default privilege: segue
    end;
  end loop;
end $$;

-- --- Papel autenticado ------------------------------------------------------
-- Recebe DML em todas as tabelas; o RLS decide as linhas. Onde não existe
-- policy permissiva para uma ação (auditoria não é editável, catálogo de
-- módulos não é alterável por usuário comum), o padrão continua sendo negar.

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- --- Papel de serviço -------------------------------------------------------
-- Usado apenas pelo provisionamento administrativo. Já possui BYPASSRLS;
-- precisa também do privilégio de tabela para que o PostgREST o aceite.

grant usage on schema public to service_role;

grant all privileges
  on all tables in schema public
  to service_role;

grant all privileges on all sequences in schema public to service_role;

-- --- Tabelas e sequências futuras -------------------------------------------
-- Sem isto, cada nova migration de módulo repetiria o mesmo defeito.

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant usage, select on sequences to authenticated;

alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- --- Confirmação ------------------------------------------------------------
-- Falha a migration se alguma tabela ficar sem SELECT para o papel autenticado.

do $$
declare
  faltando integer;
begin
  select count(*) into faltando
    from pg_tables
   where schemaname = 'public'
     and not has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'SELECT');

  if faltando > 0 then
    raise exception 'Ainda há % tabela(s) sem SELECT para authenticated.', faltando;
  end if;

  select count(*) into faltando
    from pg_tables
   where schemaname = 'public'
     and not has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'SELECT');

  if faltando > 0 then
    raise exception 'Ainda há % tabela(s) sem SELECT para service_role.', faltando;
  end if;

  -- anon precisa continuar sem acesso: é a primeira barreira do modelo.
  select count(*) into faltando
    from pg_tables
   where schemaname = 'public'
     and has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'SELECT');

  if faltando > 0 then
    raise exception 'anon recebeu SELECT em % tabela(s); deve permanecer sem acesso.', faltando;
  end if;

  raise notice 'Privilégios aplicados: authenticated e service_role com DML, anon sem acesso.';
end $$;
