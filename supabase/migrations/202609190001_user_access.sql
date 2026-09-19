-- ============================================================================
-- Acesso por USUÁRIO: módulos + funcionalidades com nível
-- ============================================================================
-- Até aqui o acesso vinha do cargo (roles → role_permissions): liberar um
-- módulo para uma pessoa alterava o cargo inteiro. Agora o proprietário marca,
-- para cada usuário, as funcionalidades de cada módulo e o nível
-- (ver < operar < aprovar). O catálogo é o de modules/access-catalog.ts.
--
-- As funções antigas (has_permission, has_scoped_permission,
-- employees_in_scope, cost_centers_in_scope, can_access_module) continuam
-- existindo com a mesma assinatura, agora calculadas a partir das permissões
-- do usuário — as policies que ainda as usam seguem funcionando. As policies
-- de negócio passam a checar a funcionalidade em 202609190002_feature_rls.sql.
--
-- user_roles / role_permissions ficam no banco, sem uso, até a remoção.
-- ============================================================================

-- --- 1. Estrutura -----------------------------------------------------------
do $$ begin
  create type public.access_level as enum ('ver', 'operar', 'aprovar');
exception when duplicate_object then null; end $$;

create table if not exists public.access_features (
  code text primary key,
  module_code text not null,
  label text not null,
  levels public.access_level[] not null,
  sort integer not null default 0
);

create table if not exists public.user_feature_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  feature_code text not null references public.access_features(code) on update cascade on delete cascade,
  level public.access_level not null,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, feature_code)
);

create index if not exists idx_user_feature_grants_profile on public.user_feature_grants(profile_id);

drop trigger if exists user_feature_grants_updated_at on public.user_feature_grants;
create trigger user_feature_grants_updated_at
before update on public.user_feature_grants
for each row execute function public.set_updated_at();

alter table public.profiles add column if not exists is_owner boolean not null default false;

-- Ninguém se promove a proprietário editando o próprio perfil.
create or replace function public.profiles_protect_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Administração (service role) passa direto; auth.uid() é nulo nela.
  if auth.uid() is null or new.user_id <> auth.uid() then
    return new;
  end if;
  new.email := old.email;
  new.organization_id := old.organization_id;
  new.status := old.status;
  new.user_id := old.user_id;
  new.is_owner := old.is_owner;
  return new;
end;
$$;

-- --- 2. Catálogo (espelho de modules/access-catalog.ts) ---------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('rh.colaboradores',      'rh',         'Colaboradores',        '{ver,operar}',         10),
  ('rh.jornada',            'rh',         'Ponto e jornada',      '{ver,operar,aprovar}', 20),
  ('rh.ferias',             'rh',         'Férias e ausências',   '{ver,operar,aprovar}', 30),
  ('rh.feriados',           'rh',         'Feriados',             '{ver,operar}',         40),
  ('rh.beneficios',         'rh',         'Benefícios',           '{ver,operar,aprovar}', 50),
  ('rh.sst',                'rh',         'Saúde e segurança',    '{ver,operar,aprovar}', 60),
  ('rh.documentos',         'rh',         'Documentos',           '{ver,operar,aprovar}', 70),
  ('rh.relatorios',         'rh',         'Relatórios',           '{ver}',                80),
  ('rh.homologacao',        'rh',         'Homologação',          '{ver,operar}',         90),
  ('financeiro.pagar',      'financeiro', 'Contas a pagar',       '{ver,operar,aprovar}', 10),
  ('financeiro.receber',    'financeiro', 'Contas a receber',     '{ver,operar,aprovar}', 20),
  ('financeiro.fluxo',      'financeiro', 'Fluxo de caixa',       '{ver}',                30),
  ('financeiro.bancos',     'financeiro', 'Bancos e conciliação', '{ver,operar}',         40),
  ('financeiro.centros',    'financeiro', 'Centros de custo',     '{ver,operar}',         50),
  ('financeiro.relatorios', 'financeiro', 'Relatórios',           '{ver}',                60),
  ('financeiro.homologacao','financeiro', 'Homologação',          '{ver,operar}',         70),
  ('compras.cotacoes',      'compras',    'Cotações',             '{ver,operar}',         10),
  ('compras.aprovacoes',    'compras',    'Aprovações',           '{ver,aprovar}',        20),
  ('compras.realizadas',    'compras',    'Compras realizadas',   '{ver,operar}',         30),
  ('portaria.visitas',      'portaria',   'Visitas',              '{ver,operar,aprovar}', 10),
  ('portaria.terceiros',    'portaria',   'Terceiros',            '{ver,operar,aprovar}', 20),
  ('portaria.recebidos',    'portaria',   'Recebidos',            '{ver,operar,aprovar}', 30),
  ('portaria.veiculos',     'portaria',   'Veículos',             '{ver,operar,aprovar}', 40),
  ('producao.painel',       'producao',   'Painel',               '{ver}',                10),
  ('producao.os',           'producao',   'Ordens de serviço',    '{ver}',                20),
  ('producao.fundicao',     'producao',   'Pipeline fundição',    '{ver}',                30),
  ('producao.paradas',      'producao',   'Paradas',              '{ver}',                40),
  ('producao.qualidade',    'producao',   'Qualidade',            '{ver}',                50),
  ('producao.fantasmas',    'producao',   'Lotes fantasmas',      '{ver}',                60),
  ('producao.externos',     'producao',   'Envios externos',      '{ver}',                70),
  ('producao.bi',           'producao',   'BI & Análises',        '{ver}',                80),
  ('producao.conexao',      'producao',   'Conexão Forja',        '{ver}',                90),
  ('fundacao.estrutura',    'fundacao',   'Estrutura',            '{ver}',                10),
  ('fundacao.auditoria',    'fundacao',   'Auditoria',            '{ver}',                20)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- 3. Predicados ----------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_owner from public.profiles p
    where p.user_id = auth.uid() and p.status = 'active'
    limit 1
  ), false);
$$;

create or replace function public.has_feature(
  requested_feature text,
  min_level public.access_level default 'ver'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or exists (
    select 1 from public.user_feature_grants g
    where g.profile_id = public.current_profile_id()
      and g.organization_id = public.current_organization_id()
      and g.feature_code = requested_feature
      and g.level >= min_level
  );
$$;

create or replace function public.has_module(
  requested_module text,
  min_level public.access_level default 'ver'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or exists (
    select 1 from public.user_feature_grants g
    join public.access_features f on f.code = g.feature_code
    where g.profile_id = public.current_profile_id()
      and g.organization_id = public.current_organization_id()
      and f.module_code = requested_module
      and g.level >= min_level
  );
$$;

create or replace function public.action_level(requested_action public.permission_action)
returns public.access_level
language sql
immutable
as $$
  select case requested_action
    when 'view' then 'ver'::public.access_level
    when 'create' then 'operar'::public.access_level
    when 'edit' then 'operar'::public.access_level
    else 'aprovar'::public.access_level
  end;
$$;

-- --- 4. Funções antigas, agora sobre as permissões do usuário ----------------
-- Tradução módulo/ação → funcionalidade. O que é de governança (acessos,
-- estrutura, plataforma) fica só com o proprietário.
create or replace function public.has_permission(
  requested_module text,
  requested_action public.permission_action
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or case
    when requested_module in ('core.search', 'core.notifications') then
      requested_action = 'view' and public.current_profile_id() is not null
    when requested_module = 'core.organization' then
      requested_action = 'view' and public.has_feature('fundacao.estrutura')
    when requested_module = 'core.people' then
      case when requested_action = 'view' then public.has_module('rh')
           when requested_action in ('create', 'edit') then public.has_feature('rh.colaboradores', 'operar')
           else false end
    when requested_module = 'core.documents' then
      requested_action in ('view', 'create', 'edit', 'approve')
      and public.has_feature('rh.documentos', public.action_level(requested_action))
    when requested_module = 'core.audit' then
      requested_action in ('view', 'export') and public.has_feature('fundacao.auditoria')
    when requested_module like 'core.%' or requested_module like 'platform.%' then false
    when requested_action = 'admin' then
      public.has_feature(requested_module || '.homologacao', 'operar')
    when requested_module = 'financeiro' and requested_action = 'settle' then
      public.has_feature('financeiro.pagar', 'aprovar') or public.has_feature('financeiro.receber', 'aprovar')
    when requested_module = 'financeiro' and requested_action = 'reconcile' then
      public.has_feature('financeiro.bancos', 'operar')
    else public.has_module(requested_module, public.action_level(requested_action))
  end;
$$;

-- Sem recorte por setor: o acesso vale para a empresa toda. A assinatura com
-- alvos continua para as policies e rotas que já a chamam.
create or replace function public.has_scoped_permission(
  requested_module   text,
  requested_action   public.permission_action,
  target_unit        uuid default null,
  target_department  uuid default null,
  target_team        uuid default null,
  target_profile     uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(requested_module, requested_action);
$$;

create or replace function public.employees_in_scope(
  requested_module text,
  requested_action public.permission_action default 'view'
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where e.organization_id = public.current_organization_id()
    and (e.profile_id = public.current_profile_id()
         or public.has_permission(requested_module, requested_action));
$$;

create or replace function public.cost_centers_in_scope(
  requested_action public.permission_action default 'view'
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.finance_cost_centers c
  where c.organization_id = public.current_organization_id()
    and public.has_permission('financeiro', requested_action);
$$;

create or replace function public.can_access_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module(requested_module);
$$;

revoke all on function public.is_owner() from public;
revoke all on function public.has_feature(text, public.access_level) from public;
revoke all on function public.has_module(text, public.access_level) from public;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.has_feature(text, public.access_level) to authenticated;
grant execute on function public.has_module(text, public.access_level) to authenticated;
grant execute on function public.action_level(public.permission_action) to authenticated;

-- --- 5. RLS das tabelas novas -----------------------------------------------
alter table public.access_features enable row level security;
alter table public.user_feature_grants enable row level security;

drop policy if exists access_features_read on public.access_features;
create policy access_features_read on public.access_features
for select to authenticated using (true);

drop policy if exists user_feature_grants_read on public.user_feature_grants;
create policy user_feature_grants_read on public.user_feature_grants
for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (profile_id = public.current_profile_id() or public.is_owner())
);

drop policy if exists user_feature_grants_owner on public.user_feature_grants;
create policy user_feature_grants_owner on public.user_feature_grants
for all to authenticated
using (organization_id = public.current_organization_id() and public.is_owner())
with check (organization_id = public.current_organization_id() and public.is_owner());

-- Estrutura de acesso antiga: só o proprietário altera (e ninguém mais usa).
drop policy if exists access_admin_roles on public.roles;
create policy access_admin_roles on public.roles for all to authenticated
using (organization_id = public.current_organization_id() and public.is_owner())
with check (organization_id = public.current_organization_id() and public.is_owner());

-- --- 6. Conversão dos usuários atuais ----------------------------------------
-- Proprietário: quem tem o cargo owner ativo.
update public.profiles p set is_owner = true
where exists (
  select 1 from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = p.id and r.code = 'owner'
    and ur.valid_from <= now() and (ur.valid_until is null or ur.valid_until > now())
);

-- Demais: o acesso efetivo de hoje. Cargo com escopo de módulo → todas as
-- funcionalidades daquele módulo, no nível que o cargo alcançava. Homologação
-- só entra se o cargo tinha a ação admin no módulo (nenhum gestor tinha).
with origem as (
  select distinct p.id as profile_id, p.organization_id, r.id as role_id, r.code as role_code, s.module_code
  from public.profiles p
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  join public.access_scopes s on s.id = ur.scope_id
  where p.is_owner = false
    and s.scope_type = 'module'
    and ur.valid_from <= now() and (ur.valid_until is null or ur.valid_until > now())
),
teto as (
  select o.*, case
      when o.role_code in ('manager', 'director', 'admin') then 'aprovar'::public.access_level
      when o.role_code = 'operator' then 'operar'::public.access_level
      else 'ver'::public.access_level
    end as nivel_maximo
  from origem o
),
concessoes as (
  select t.organization_id, t.profile_id, f.code as feature_code,
         (select max(l) from unnest(f.levels) l where l <= t.nivel_maximo) as level
  from teto t
  join public.access_features f on f.module_code = t.module_code
  where f.code not like '%.homologacao'
     or exists (
       select 1 from public.role_permissions rp
       where rp.role_id = t.role_id and rp.module_code = t.module_code and rp.action = 'admin' and rp.granted
     )
)
insert into public.user_feature_grants (organization_id, profile_id, feature_code, level, granted_by)
select c.organization_id, c.profile_id, c.feature_code, c.level,
       (select o.id from public.profiles o where o.organization_id = c.organization_id and o.is_owner and o.status = 'active' order by o.created_at limit 1)
from concessoes c
where c.level is not null
on conflict (profile_id, feature_code) do nothing;

insert into public.audit_logs (organization_id, module_code, event_type, entity_type, risk_level, metadata)
select o.id, 'core.access', 'core.access.migration.user_grants', 'user_feature_grants', 'sensitive',
       jsonb_build_object(
         'descricao', 'Acesso convertido de cargo para permissões por usuário',
         'usuarios', (select count(distinct g.profile_id) from public.user_feature_grants g where g.organization_id = o.id),
         'permissoes', (select count(*) from public.user_feature_grants g where g.organization_id = o.id),
         'proprietarios', (select count(*) from public.profiles p where p.organization_id = o.id and p.is_owner)
       )
from public.organizations o;
