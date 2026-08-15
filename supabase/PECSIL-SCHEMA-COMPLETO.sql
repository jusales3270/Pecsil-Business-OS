-- ============================================================================
-- PecSil Business OS — schema completo: Fundação + Financeiro + RH
--
-- COMO USAR
--   Studio do servidor → SQL Editor → New query → cole tudo → Run
--
-- O SQL Editor roda como UMA transação: se algo falhar, nada é gravado.
-- Ao final, três confirmações:
--   "Privilégios aplicados: authenticated e service_role com DML, anon sem acesso."
--   "Contrato da Fundação Pecsil validado: 16 tabelas, RLS e ... presentes."
--   (o RH não emite notice próprio; confira em Tables que há 8 tabelas rh_*)
--
-- Já aplicado no servidor: Fundação + Financeiro (26 tabelas). Reaplicar é
-- seguro no essencial, mas as partes com `create type`/`create table` sem
-- "if not exists" vão acusar "already exists". Para uma reaplicação limpa,
-- use apenas o BLOCO DO RH abaixo (procure "SCHEMA DO RH — INÍCIO").
--
-- Ordem: 1.Fundação 2.Módulos 3.Perm.Financeiro 4.Financeiro 5.Grants
--        6.Enums RH 7.RH v1
-- ============================================================================



-- ========================================================================
-- 202607140001_foundation.sql
-- ========================================================================

-- Pecsil Business OS — Fundação de dados v1
-- PostgreSQL/Supabase. Execute pelo fluxo oficial de migrations do Supabase.

create extension if not exists pgcrypto;

create type public.account_status as enum ('invited', 'active', 'blocked', 'disabled');
create type public.scope_type as enum ('company', 'unit', 'department', 'team', 'module', 'self');
create type public.permission_action as enum ('view', 'create', 'edit', 'approve', 'export', 'admin');
create type public.data_classification as enum ('public', 'internal', 'confidential', 'restricted');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  tax_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  city text,
  state text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  level text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email text not null,
  full_name text not null,
  status public.account_status not null default 'invited',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid unique references public.profiles(id) on delete set null,
  employee_number text not null,
  full_name text not null,
  corporate_email text,
  unit_id uuid references public.units(id) on delete restrict,
  department_id uuid references public.departments(id) on delete restrict,
  team_id uuid references public.teams(id) on delete restrict,
  position_id uuid references public.positions(id) on delete restrict,
  manager_employee_id uuid references public.employees(id) on delete set null,
  admission_date date,
  termination_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_number)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  module_code text not null,
  action public.permission_action not null,
  granted boolean not null default true,
  created_at timestamptz not null default now(),
  unique (role_id, module_code, action)
);

create table public.access_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope_type public.scope_type not null,
  entity_id uuid,
  module_code text,
  label text not null,
  created_at timestamptz not null default now(),
  check (
    (scope_type = 'module' and module_code is not null)
    or (scope_type <> 'module')
  )
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  scope_id uuid not null references public.access_scopes(id) on delete cascade,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, role_id, scope_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null,
  title text not null,
  version text not null default '1.0',
  storage_bucket text not null default 'business-documents',
  object_path text not null,
  classification public.data_classification not null default 'internal',
  module_code text,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  review_due_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, object_path)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  module_code text not null,
  severity text not null check (severity in ('info', 'attention', 'critical', 'approval')),
  title text not null,
  body text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  module_code text not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  risk_level text not null default 'normal',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index idx_profiles_org on public.profiles(organization_id);
create index idx_employees_scope on public.employees(organization_id, unit_id, department_id, team_id);
create index idx_user_roles_profile on public.user_roles(profile_id);
create index idx_permissions_role_module on public.role_permissions(role_id, module_code, action);
create index idx_documents_scope on public.documents(organization_id, module_code, unit_id, department_id, team_id);
create index idx_notifications_recipient on public.notifications(recipient_profile_id, read_at, created_at desc);
create index idx_audit_org_time on public.audit_logs(organization_id, occurred_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger units_updated_at before update on public.units for each row execute function public.set_updated_at();
create trigger departments_updated_at before update on public.departments for each row execute function public.set_updated_at();
create trigger teams_updated_at before update on public.teams for each row execute function public.set_updated_at();
create trigger positions_updated_at before update on public.positions for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute function public.set_updated_at();
create trigger roles_updated_at before update on public.roles for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.documents for each row execute function public.set_updated_at();

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where user_id = auth.uid() and status = 'active'
  limit 1;
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles
  where user_id = auth.uid() and status = 'active'
  limit 1;
$$;

create or replace function public.has_permission(requested_module text, requested_action public.permission_action)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    where ur.profile_id = public.current_profile_id()
      and rp.module_code = requested_module
      and rp.action = requested_action
      and rp.granted = true
      and ur.valid_from <= now()
      and (ur.valid_until is null or ur.valid_until > now())
  );
$$;

create or replace function public.can_access_entity(
  target_organization uuid,
  target_unit uuid default null,
  target_department uuid default null,
  target_team uuid default null,
  target_user uuid default null,
  target_module text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (target_user is not null and target_user = auth.uid())
    or exists (
      select 1
      from public.user_roles ur
      join public.access_scopes s on s.id = ur.scope_id
      where ur.profile_id = public.current_profile_id()
        and s.organization_id = target_organization
        and ur.valid_from <= now()
        and (ur.valid_until is null or ur.valid_until > now())
        and (
          (s.scope_type = 'company' and s.entity_id = target_organization)
          or (s.scope_type = 'unit' and s.entity_id = target_unit)
          or (s.scope_type = 'department' and s.entity_id = target_department)
          or (s.scope_type = 'team' and s.entity_id = target_team)
          or (s.scope_type = 'module' and s.module_code = target_module)
          or (s.scope_type = 'self' and target_user = auth.uid())
        )
    );
$$;

revoke all on function public.current_profile_id() from public;
revoke all on function public.current_organization_id() from public;
revoke all on function public.has_permission(text, public.permission_action) from public;
revoke all on function public.can_access_entity(uuid, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.has_permission(text, public.permission_action) to authenticated;
grant execute on function public.can_access_entity(uuid, uuid, uuid, uuid, uuid, text) to authenticated;

alter table public.organizations enable row level security;
alter table public.units enable row level security;
alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.positions enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.access_scopes enable row level security;
alter table public.user_roles enable row level security;
alter table public.documents enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_read on public.organizations for select to authenticated
using (id = public.current_organization_id());
create policy units_read on public.units for select to authenticated
using (organization_id = public.current_organization_id());
create policy departments_read on public.departments for select to authenticated
using (organization_id = public.current_organization_id());
create policy teams_read on public.teams for select to authenticated
using (organization_id = public.current_organization_id());
create policy positions_read on public.positions for select to authenticated
using (organization_id = public.current_organization_id());

create policy organization_admin_update on public.organizations for update to authenticated
using (public.has_permission('core.organization', 'edit'))
with check (public.has_permission('core.organization', 'edit'));
create policy units_admin_all on public.units for all to authenticated
using (public.has_permission('core.organization', 'edit'))
with check (public.has_permission('core.organization', 'edit'));
create policy departments_admin_all on public.departments for all to authenticated
using (public.has_permission('core.organization', 'edit'))
with check (public.has_permission('core.organization', 'edit'));
create policy teams_admin_all on public.teams for all to authenticated
using (public.has_permission('core.organization', 'edit'))
with check (public.has_permission('core.organization', 'edit'));
create policy positions_admin_all on public.positions for all to authenticated
using (public.has_permission('core.organization', 'edit'))
with check (public.has_permission('core.organization', 'edit'));

create policy profiles_read on public.profiles for select to authenticated
using (user_id = auth.uid() or public.has_permission('core.people', 'view'));
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and organization_id = public.current_organization_id());

create policy employees_read on public.employees for select to authenticated
using (
  public.has_permission('core.people', 'view')
  and public.can_access_entity(organization_id, unit_id, department_id, team_id, null, 'core.people')
  or profile_id = public.current_profile_id()
);
create policy employees_manage on public.employees for all to authenticated
using (public.has_permission('core.people', 'edit'))
with check (
  organization_id = public.current_organization_id()
  and public.has_permission('core.people', 'edit')
);

create policy roles_read on public.roles for select to authenticated
using (organization_id = public.current_organization_id());
create policy permissions_read on public.role_permissions for select to authenticated
using (exists (select 1 from public.roles r where r.id = role_id and r.organization_id = public.current_organization_id()));
create policy scopes_read on public.access_scopes for select to authenticated
using (organization_id = public.current_organization_id());
create policy user_roles_read on public.user_roles for select to authenticated
using (profile_id = public.current_profile_id() or public.has_permission('core.access', 'view'));
create policy access_admin_roles on public.roles for all to authenticated
using (public.has_permission('core.access', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('core.access', 'admin'));
create policy access_admin_permissions on public.role_permissions for all to authenticated
using (public.has_permission('core.access', 'admin'))
with check (public.has_permission('core.access', 'admin'));
create policy access_admin_scopes on public.access_scopes for all to authenticated
using (public.has_permission('core.access', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('core.access', 'admin'));
create policy access_admin_user_roles on public.user_roles for all to authenticated
using (public.has_permission('core.access', 'admin'))
with check (public.has_permission('core.access', 'admin'));

create policy documents_read on public.documents for select to authenticated
using (
  owner_profile_id = public.current_profile_id()
  or (
    public.has_permission('core.documents', 'view')
    and public.can_access_entity(organization_id, unit_id, department_id, team_id, null, module_code)
  )
);
create policy documents_manage on public.documents for all to authenticated
using (public.has_permission('core.documents', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('core.documents', 'edit'));

create policy notifications_own_read on public.notifications for select to authenticated
using (recipient_profile_id = public.current_profile_id());
create policy notifications_own_update on public.notifications for update to authenticated
using (recipient_profile_id = public.current_profile_id())
with check (recipient_profile_id = public.current_profile_id());

create policy audit_authorized_read on public.audit_logs for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.has_permission('core.audit', 'view')
);

comment on table public.audit_logs is 'Append-only. Escrita apenas por funções confiáveis ou service role; usuários autenticados não recebem policy de insert/update/delete.';


-- ========================================================================
-- 202607150001_module_registry_and_security.sql
-- ========================================================================

-- Pecsil Business OS — Registro central de módulos e autorização por empresa
-- Depende de 202607140001_foundation.sql.

create table public.modules (
  code text primary key,
  name text not null,
  version text not null,
  route text not null unique,
  entry_permission text not null,
  status text not null default 'planned' check (status in ('integrated', 'planned', 'future', 'disabled')),
  menu_order integer not null default 100 check (menu_order >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_code text not null references public.modules(code) on delete restrict,
  enabled boolean not null default false,
  menu_enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  enabled_at timestamptz,
  enabled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, module_code),
  check (menu_enabled = false or enabled = true)
);

create index idx_organization_modules_enabled
  on public.organization_modules(organization_id, enabled, menu_enabled);

create trigger modules_updated_at
before update on public.modules
for each row execute function public.set_updated_at();

create trigger organization_modules_updated_at
before update on public.organization_modules
for each row execute function public.set_updated_at();

create or replace function public.can_access_module(requested_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_modules om
    join public.modules m on m.code = om.module_code
    where om.organization_id = public.current_organization_id()
      and om.module_code = requested_module
      and om.enabled = true
      and m.status = 'integrated'
  ) and public.has_permission(requested_module, 'view');
$$;

revoke all on function public.can_access_module(text) from public;
grant execute on function public.can_access_module(text) to authenticated;

alter table public.modules enable row level security;
alter table public.organization_modules enable row level security;

create policy modules_authenticated_read
on public.modules for select to authenticated
using (true);

create policy organization_modules_read
on public.organization_modules for select to authenticated
using (organization_id = public.current_organization_id());

create policy modules_platform_admin
on public.modules for all to authenticated
using (public.has_permission('platform.modules', 'admin'))
with check (public.has_permission('platform.modules', 'admin'));

create policy organization_modules_access_admin
on public.organization_modules for all to authenticated
using (
  organization_id = public.current_organization_id()
  and public.has_permission('core.access', 'admin')
)
with check (
  organization_id = public.current_organization_id()
  and public.has_permission('core.access', 'admin')
);

comment on table public.modules is 'Catálogo técnico central. Cada registro corresponde a um ModuleManifest versionado no código.';
comment on table public.organization_modules is 'Ativação e configuração de cada módulo por organização; não substitui permissões individuais.';
comment on function public.can_access_module(text) is 'Exige módulo integrado, habilitado para a organização e permissão view do usuário.';


-- ========================================================================
-- 202608040001_finance_permissions.sql
-- ========================================================================

-- Pecsil Business OS — Ações específicas do Financeiro
-- Separada do schema para que os novos valores do enum estejam disponíveis
-- em uma transação posterior em qualquer versão suportada do PostgreSQL.

alter type public.permission_action add value if not exists 'settle';
alter type public.permission_action add value if not exists 'reconcile';



-- ========================================================================
-- 202608040002_finance_v1.sql
-- ========================================================================

-- Pecsil Business OS — Persistência Financeira v1
-- Contrato PostgreSQL/Supabase para títulos, parcelas, aprovações, baixas,
-- bancos, conciliação, plano de contas e centros de custo.

create type public.finance_account_type as enum (
  'asset', 'liability', 'equity', 'revenue', 'expense', 'transfer'
);
create type public.finance_title_direction as enum ('payable', 'receivable');
create type public.finance_title_status as enum (
  'draft', 'pending_approval', 'approved', 'partially_settled',
  'settled', 'overdue', 'cancelled'
);
create type public.finance_installment_status as enum (
  'pending', 'partially_settled', 'settled', 'overdue', 'cancelled'
);
create type public.finance_approval_status as enum (
  'pending', 'approved', 'rejected', 'cancelled'
);
create type public.finance_bank_entry_direction as enum ('credit', 'debit');
create type public.finance_reconciliation_status as enum (
  'pending', 'matched', 'partial', 'ignored'
);

create table public.finance_chart_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid references public.finance_chart_accounts(id) on delete restrict,
  code text not null,
  name text not null,
  account_type public.finance_account_type not null,
  allows_posting boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  department_id uuid references public.departments(id) on delete restrict,
  manager_profile_id uuid references public.profiles(id) on delete set null,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  bank_code text not null,
  bank_name text not null,
  branch text not null,
  account_number text not null,
  account_digit text,
  account_type text not null,
  opening_balance numeric(18,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, bank_code, branch, account_number)
);

create table public.finance_titles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction public.finance_title_direction not null,
  counterparty_name text not null,
  counterparty_tax_id text,
  document_number text,
  description text not null,
  issue_date date not null,
  competence_date date,
  original_amount numeric(18,2) not null check (original_amount > 0),
  currency char(3) not null default 'BRL',
  chart_account_id uuid references public.finance_chart_accounts(id) on delete restrict,
  cost_center_id uuid references public.finance_cost_centers(id) on delete restrict,
  status public.finance_title_status not null default 'draft',
  source_module text,
  source_entity_id uuid,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (currency = upper(currency)),
  check ((status = 'cancelled' and cancelled_at is not null) or status <> 'cancelled')
);

create table public.finance_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title_id uuid not null references public.finance_titles(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  settled_amount numeric(18,2) not null default 0 check (settled_amount >= 0 and settled_amount <= amount),
  status public.finance_installment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title_id, installment_number)
);

create table public.finance_approval_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  direction public.finance_title_direction,
  min_amount numeric(18,2) not null default 0 check (min_amount >= 0),
  max_amount numeric(18,2),
  approval_level integer not null default 1 check (approval_level > 0),
  approver_role_id uuid references public.roles(id) on delete restrict,
  required_permission public.permission_action not null default 'approve',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_amount is null or max_amount > min_amount),
  unique (organization_id, name, approval_level)
);

create table public.finance_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title_id uuid not null references public.finance_titles(id) on delete cascade,
  installment_id uuid references public.finance_installments(id) on delete cascade,
  rule_id uuid not null references public.finance_approval_rules(id) on delete restrict,
  approval_level integer not null check (approval_level > 0),
  status public.finance_approval_status not null default 'pending',
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  reason text,
  check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

create table public.finance_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installment_id uuid not null references public.finance_installments(id) on delete restrict,
  bank_account_id uuid references public.finance_bank_accounts(id) on delete restrict,
  settlement_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  discount numeric(18,2) not null default 0 check (discount >= 0),
  interest numeric(18,2) not null default 0 check (interest >= 0),
  penalty numeric(18,2) not null default 0 check (penalty >= 0),
  exchange_difference numeric(18,2) not null default 0,
  payment_method text,
  external_reference text,
  notes text,
  reversed_at timestamptz,
  reversed_by_profile_id uuid references public.profiles(id) on delete set null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((reversed_at is null and reversed_by_profile_id is null) or reversed_at is not null)
);

create table public.finance_bank_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete cascade,
  booking_date date not null,
  value_date date,
  direction public.finance_bank_entry_direction not null,
  amount numeric(18,2) not null check (amount > 0),
  description text not null,
  document_number text,
  external_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  reconciliation_status public.finance_reconciliation_status not null default 'pending',
  imported_at timestamptz not null default now(),
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_entry_id uuid not null references public.finance_bank_entries(id) on delete cascade,
  settlement_id uuid not null references public.finance_settlements(id) on delete restrict,
  matched_amount numeric(18,2) not null check (matched_amount > 0),
  status public.finance_reconciliation_status not null default 'matched',
  reconciled_by_profile_id uuid references public.profiles(id) on delete set null,
  reconciled_at timestamptz not null default now(),
  notes text,
  unique (bank_entry_id, settlement_id)
);

create unique index uq_finance_title_document
  on public.finance_titles(organization_id, direction, document_number)
  where document_number is not null;
create unique index uq_finance_bank_entry_external
  on public.finance_bank_entries(bank_account_id, external_id)
  where external_id is not null;
create unique index uq_finance_approval_title_level
  on public.finance_approval_requests(title_id, approval_level)
  where installment_id is null;
create unique index uq_finance_approval_installment_level
  on public.finance_approval_requests(installment_id, approval_level)
  where installment_id is not null;
create index idx_finance_titles_org_status
  on public.finance_titles(organization_id, direction, status, issue_date desc);
create index idx_finance_installments_due
  on public.finance_installments(organization_id, due_date, status);
create index idx_finance_settlements_date
  on public.finance_settlements(organization_id, settlement_date desc);
create index idx_finance_bank_entries_pending
  on public.finance_bank_entries(organization_id, bank_account_id, reconciliation_status, booking_date desc);
create index idx_finance_approvals_pending
  on public.finance_approval_requests(organization_id, status, requested_at);

create trigger finance_chart_accounts_updated_at before update on public.finance_chart_accounts
for each row execute function public.set_updated_at();
create trigger finance_cost_centers_updated_at before update on public.finance_cost_centers
for each row execute function public.set_updated_at();
create trigger finance_bank_accounts_updated_at before update on public.finance_bank_accounts
for each row execute function public.set_updated_at();
create trigger finance_titles_updated_at before update on public.finance_titles
for each row execute function public.set_updated_at();
create trigger finance_installments_updated_at before update on public.finance_installments
for each row execute function public.set_updated_at();
create trigger finance_approval_rules_updated_at before update on public.finance_approval_rules
for each row execute function public.set_updated_at();

create or replace function public.finance_validate_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  installment_total numeric(18,2);
  already_applied numeric(18,2);
  installment_org uuid;
begin
  select amount, organization_id
    into installment_total, installment_org
  from public.finance_installments
  where id = new.installment_id
  for update;

  if installment_total is null then
    raise exception 'Parcela financeira não encontrada';
  end if;
  if new.organization_id <> installment_org then
    raise exception 'A baixa e a parcela devem pertencer à mesma organização';
  end if;

  select coalesce(sum(amount + discount), 0)
    into already_applied
  from public.finance_settlements
  where installment_id = new.installment_id
    and reversed_at is null
    and id <> new.id;

  if already_applied + new.amount + new.discount > installment_total then
    raise exception 'A baixa ultrapassa o saldo da parcela';
  end if;

  return new;
end;
$$;

create or replace function public.finance_refresh_installment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_installment uuid;
  target_title uuid;
  applied numeric(18,2);
begin
  target_installment := case when tg_op = 'DELETE' then old.installment_id else new.installment_id end;

  select coalesce(sum(amount + discount), 0)
    into applied
  from public.finance_settlements
  where installment_id = target_installment
    and reversed_at is null;

  update public.finance_installments
  set settled_amount = least(amount, applied),
      status = case
        when status = 'cancelled' then 'cancelled'::public.finance_installment_status
        when applied >= amount then 'settled'::public.finance_installment_status
        when applied > 0 then 'partially_settled'::public.finance_installment_status
        when due_date < current_date then 'overdue'::public.finance_installment_status
        else 'pending'::public.finance_installment_status
      end
  where id = target_installment
  returning title_id into target_title;

  update public.finance_titles t
  set status = case
    when t.status = 'cancelled' then 'cancelled'::public.finance_title_status
    when not exists (
      select 1 from public.finance_installments i
      where i.title_id = t.id and i.status <> 'settled'
    ) then 'settled'::public.finance_title_status
    when exists (
      select 1 from public.finance_installments i
      where i.title_id = t.id and i.settled_amount > 0
    ) then 'partially_settled'::public.finance_title_status
    when exists (
      select 1 from public.finance_installments i
      where i.title_id = t.id and i.status = 'overdue'
    ) then 'overdue'::public.finance_title_status
    else t.status
  end
  where t.id = target_title;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger finance_settlement_validate
before insert or update on public.finance_settlements
for each row execute function public.finance_validate_settlement();
create trigger finance_settlement_refresh
after insert or update or delete on public.finance_settlements
for each row execute function public.finance_refresh_installment();

create or replace function public.audit_finance_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  entity_uuid uuid;
  target_org uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_uuid := nullif(row_data ->> 'id', '')::uuid;
  target_org := nullif(row_data ->> 'organization_id', '')::uuid;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_profile_id, module_code,
    event_type, entity_type, entity_id, risk_level, metadata
  ) values (
    target_org, auth.uid(), public.current_profile_id(), 'financeiro',
    tg_table_name || '.' || lower(tg_op), tg_table_name, entity_uuid,
    case when tg_table_name in ('finance_settlements', 'finance_reconciliations')
      then 'high' else 'normal' end,
    jsonb_build_object('operation', tg_op)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger finance_titles_audit after insert or update or delete on public.finance_titles
for each row execute function public.audit_finance_mutation();
create trigger finance_approval_requests_audit after insert or update or delete on public.finance_approval_requests
for each row execute function public.audit_finance_mutation();
create trigger finance_settlements_audit after insert or update or delete on public.finance_settlements
for each row execute function public.audit_finance_mutation();
create trigger finance_reconciliations_audit after insert or update or delete on public.finance_reconciliations
for each row execute function public.audit_finance_mutation();

alter table public.finance_chart_accounts enable row level security;
alter table public.finance_cost_centers enable row level security;
alter table public.finance_bank_accounts enable row level security;
alter table public.finance_titles enable row level security;
alter table public.finance_installments enable row level security;
alter table public.finance_approval_rules enable row level security;
alter table public.finance_approval_requests enable row level security;
alter table public.finance_settlements enable row level security;
alter table public.finance_bank_entries enable row level security;
alter table public.finance_reconciliations enable row level security;

create policy finance_chart_accounts_read on public.finance_chart_accounts for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_chart_accounts_admin on public.finance_chart_accounts for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'admin'));

create policy finance_cost_centers_read on public.finance_cost_centers for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_cost_centers_admin on public.finance_cost_centers for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'admin'));

create policy finance_bank_accounts_read on public.finance_bank_accounts for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_bank_accounts_manage on public.finance_bank_accounts for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'));

create policy finance_titles_read on public.finance_titles for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_titles_create on public.finance_titles for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'create'));
create policy finance_titles_edit on public.finance_titles for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'edit'));

create policy finance_installments_read on public.finance_installments for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_installments_create on public.finance_installments for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'create'));
create policy finance_installments_edit on public.finance_installments for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'edit'));

create policy finance_approval_rules_read on public.finance_approval_rules for select to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'view'));
create policy finance_approval_rules_admin on public.finance_approval_rules for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'admin'));

create policy finance_approval_requests_read on public.finance_approval_requests for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_approval_requests_create on public.finance_approval_requests for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'create'));
create policy finance_approval_requests_decide on public.finance_approval_requests for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'approve'));

create policy finance_settlements_read on public.finance_settlements for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_settlements_create on public.finance_settlements for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'settle'));
create policy finance_settlements_update on public.finance_settlements for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'settle'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'settle'));

create policy finance_bank_entries_read on public.finance_bank_entries for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_bank_entries_create on public.finance_bank_entries for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'));
create policy finance_bank_entries_update on public.finance_bank_entries for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'));

create policy finance_reconciliations_read on public.finance_reconciliations for select to authenticated
using (organization_id = public.current_organization_id() and public.can_access_module('financeiro') and public.has_permission('financeiro', 'view'));
create policy finance_reconciliations_create on public.finance_reconciliations for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'));
create policy finance_reconciliations_update on public.finance_reconciliations for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'))
with check (organization_id = public.current_organization_id() and public.has_permission('financeiro', 'reconcile'));

revoke all on function public.finance_validate_settlement() from public;
revoke all on function public.finance_refresh_installment() from public;
revoke all on function public.audit_finance_mutation() from public;

comment on table public.finance_titles is 'Cabeçalho imutável do compromisso ou recebível; baixas parciais ficam nas parcelas e settlements.';
comment on table public.finance_settlements is 'Baixas financeiras reversíveis; exclusão física deve ser evitada e toda mutação é auditada.';
comment on table public.finance_bank_entries is 'Movimentos importados de OFX/CNAB/API, preservando o payload bruto para rastreabilidade.';


-- ========================================================================
-- 202608140001_table_grants.sql
-- ========================================================================

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


-- ========================================================================
-- 202608150001_rh_enums.sql
-- ========================================================================

-- ============================================================================
-- Pecsil Business OS — Tipos enumerados do RH
--
-- Separado do schema principal para que os valores estejam disponíveis em uma
-- transação posterior — mesma razão de finance_permissions estar isolado.
--
-- Domínios derivados diretamente do módulo RH (app/components/hr-module.tsx):
-- jornada, ausências/férias, benefícios e SST. Folha de pagamento fica fora
-- desta versão, por decisão do Blueprint.
-- ============================================================================

-- Ausências e férias
create type public.rh_absence_type as enum (
  'vacation', 'time_bank', 'medical_certificate', 'leave'
);
create type public.rh_absence_status as enum (
  'pending', 'under_review', 'approved', 'rejected', 'registered'
);

-- Jornada / ponto
create type public.rh_journey_status as enum (
  'regular', 'pending', 'under_review', 'adjusted', 'absence'
);

-- Benefícios
create type public.rh_benefit_category as enum (
  'food', 'health', 'mobility', 'protection'
);
create type public.rh_benefit_plan_status as enum ('active', 'under_review', 'suspended');
create type public.rh_benefit_request_action as enum (
  'enroll', 'change', 'cancel', 'add_dependent'
);
create type public.rh_benefit_request_status as enum (
  'pending', 'under_review', 'approved', 'rejected'
);

-- SST — saúde e segurança do trabalho
create type public.rh_sst_category as enum (
  'exam', 'training', 'ppe', 'incident'
);
create type public.rh_sst_status as enum (
  'compliant', 'due_soon', 'overdue', 'scheduled', 'under_review'
);
create type public.rh_sst_risk as enum ('critical', 'attention', 'regular');


-- ========================================================================
-- 202608150002_rh_v1.sql
-- ========================================================================

-- ============================================================================
-- Pecsil Business OS — Persistência do RH v1
--
-- Consome a Fundação: colaboradores são os `employees` já existentes; unidade,
-- departamento, equipe e cargo vêm da estrutura organizacional. Este módulo
-- NÃO duplica esses cadastros — apenas referencia.
--
-- Domínios: jornada, ausências/férias, benefícios (planos, adesões,
-- solicitações, dependentes) e SST (exames, treinamentos, EPIs, ocorrências).
-- Folha de pagamento fica deliberadamente fora desta versão.
--
-- Segue o padrão do Financeiro (202608040002): RLS por organização + módulo +
-- permissão, auditoria automática nas mutações sensíveis, triggers de
-- updated_at, e can_access_module('rh') em toda leitura.
-- ============================================================================

-- ============================================================================
-- 1. JORNADA / PONTO
-- ============================================================================

create table public.rh_journey_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  work_date date not null,
  schedule_label text,
  punches jsonb not null default '[]'::jsonb,
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  balance_minutes integer not null default 0,
  status public.rh_journey_status not null default 'regular',
  issue text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ============================================================================
-- 2. AUSÊNCIAS E FÉRIAS
-- ============================================================================

create table public.rh_absences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  absence_type public.rh_absence_type not null,
  start_date date not null,
  end_date date not null,
  days integer not null check (days > 0),
  status public.rh_absence_status not null default 'pending',
  reason text,
  has_conflict boolean not null default false,
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (
    (status in ('pending', 'under_review', 'registered') and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null)
  )
);

-- Saldo de férias por colaborador, por período aquisitivo.
create table public.rh_vacation_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  acquisition_start date not null,
  acquisition_end date not null,
  entitled_days integer not null default 30 check (entitled_days >= 0),
  taken_days integer not null default 0 check (taken_days >= 0),
  scheduled_days integer not null default 0 check (scheduled_days >= 0),
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, acquisition_start),
  check (acquisition_end > acquisition_start)
);

-- ============================================================================
-- 3. BENEFÍCIOS
-- ============================================================================

create table public.rh_benefit_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category public.rh_benefit_category not null,
  provider text,
  monthly_cost numeric(18,2) not null default 0 check (monthly_cost >= 0),
  employee_contribution text,
  eligibility_rule text,
  status public.rh_benefit_plan_status not null default 'active',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- Adesão de um colaborador a um plano.
create table public.rh_benefit_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.rh_benefit_plans(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  enrolled_at date not null default current_date,
  ended_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, employee_id),
  check (ended_at is null or ended_at >= enrolled_at)
);

-- Dependente vinculado a uma adesão (plano de saúde, por exemplo).
create table public.rh_benefit_dependents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.rh_benefit_enrollments(id) on delete cascade,
  full_name text not null,
  relationship text not null,
  birth_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fluxo de solicitação (adesão, alteração, cancelamento, inclusão de dependente).
create table public.rh_benefit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.rh_benefit_plans(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  action public.rh_benefit_request_action not null,
  status public.rh_benefit_request_status not null default 'pending',
  reason text,
  effective_date date,
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending', 'under_review') and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null)
  )
);

-- ============================================================================
-- 4. SST — SAÚDE E SEGURANÇA DO TRABALHO
-- ============================================================================

create table public.rh_sst_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  category public.rh_sst_category not null,
  title text not null,
  due_date date,
  completed_at date,
  status public.rh_sst_status not null default 'scheduled',
  risk public.rh_sst_risk not null default 'regular',
  document_id uuid references public.documents(id) on delete set null,
  note text,
  -- Conteúdo clínico é sensível: fica isolado e coberto por classificação.
  clinical_confidential boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 5. ÍNDICES
-- ============================================================================

create index idx_rh_journey_scope
  on public.rh_journey_records(organization_id, department_id, work_date desc);
create index idx_rh_journey_employee
  on public.rh_journey_records(employee_id, work_date desc);
create index idx_rh_absences_scope
  on public.rh_absences(organization_id, status, start_date desc);
create index idx_rh_absences_employee
  on public.rh_absences(employee_id, start_date desc);
create index idx_rh_vacation_employee
  on public.rh_vacation_balances(employee_id, acquisition_start desc);
create index idx_rh_benefit_enrollments_plan
  on public.rh_benefit_enrollments(plan_id, active);
create index idx_rh_benefit_enrollments_employee
  on public.rh_benefit_enrollments(employee_id, active);
create index idx_rh_benefit_requests_pending
  on public.rh_benefit_requests(organization_id, status, requested_at);
create index idx_rh_sst_scope
  on public.rh_sst_records(organization_id, category, status, due_date);
create index idx_rh_sst_employee
  on public.rh_sst_records(employee_id, due_date);

-- ============================================================================
-- 6. TRIGGERS updated_at
-- ============================================================================

create trigger rh_journey_records_updated_at before update on public.rh_journey_records
for each row execute function public.set_updated_at();
create trigger rh_absences_updated_at before update on public.rh_absences
for each row execute function public.set_updated_at();
create trigger rh_vacation_balances_updated_at before update on public.rh_vacation_balances
for each row execute function public.set_updated_at();
create trigger rh_benefit_plans_updated_at before update on public.rh_benefit_plans
for each row execute function public.set_updated_at();
create trigger rh_benefit_enrollments_updated_at before update on public.rh_benefit_enrollments
for each row execute function public.set_updated_at();
create trigger rh_benefit_dependents_updated_at before update on public.rh_benefit_dependents
for each row execute function public.set_updated_at();
create trigger rh_benefit_requests_updated_at before update on public.rh_benefit_requests
for each row execute function public.set_updated_at();
create trigger rh_sst_records_updated_at before update on public.rh_sst_records
for each row execute function public.set_updated_at();

-- ============================================================================
-- 7. AUDITORIA AUTOMÁTICA
-- Reaproveita o padrão do Financeiro: toda mutação sensível vira audit_log.
-- ============================================================================

create or replace function public.audit_rh_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  entity_uuid uuid;
  target_org uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_uuid := nullif(row_data ->> 'id', '')::uuid;
  target_org := nullif(row_data ->> 'organization_id', '')::uuid;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_profile_id, module_code,
    event_type, entity_type, entity_id, risk_level, metadata
  ) values (
    target_org, auth.uid(), public.current_profile_id(), 'rh',
    tg_table_name || '.' || lower(tg_op), tg_table_name, entity_uuid,
    -- Aprovações e SST são as trilhas mais sensíveis do RH.
    case when tg_table_name in ('rh_absences', 'rh_benefit_requests', 'rh_sst_records')
      then 'high' else 'normal' end,
    jsonb_build_object('operation', tg_op)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_rh_mutation() from public;

create trigger rh_absences_audit after insert or update or delete on public.rh_absences
for each row execute function public.audit_rh_mutation();
create trigger rh_benefit_requests_audit after insert or update or delete on public.rh_benefit_requests
for each row execute function public.audit_rh_mutation();
create trigger rh_benefit_enrollments_audit after insert or update or delete on public.rh_benefit_enrollments
for each row execute function public.audit_rh_mutation();
create trigger rh_sst_records_audit after insert or update or delete on public.rh_sst_records
for each row execute function public.audit_rh_mutation();

-- ============================================================================
-- 8. RLS
-- Toda leitura exige: mesma organização + módulo rh integrado e habilitado +
-- permissão rh.view. Escrita exige a permissão específica da ação.
--
-- Exceção de autosserviço: o colaborador vê os PRÓPRIOS registros de jornada,
-- ausência, férias, benefícios e SST não-clínico, mesmo sem rh.view — como o
-- "Meu RH" da interface. O vínculo é employees.profile_id = current_profile_id.
-- ============================================================================

alter table public.rh_journey_records enable row level security;
alter table public.rh_absences enable row level security;
alter table public.rh_vacation_balances enable row level security;
alter table public.rh_benefit_plans enable row level security;
alter table public.rh_benefit_enrollments enable row level security;
alter table public.rh_benefit_dependents enable row level security;
alter table public.rh_benefit_requests enable row level security;
alter table public.rh_sst_records enable row level security;

-- Predicado reutilizável: o registro é do próprio colaborador logado?
-- (inline em cada policy, já que policies não chamam sub-selects nomeados)

-- --- Jornada ----------------------------------------------------------------
create policy rh_journey_read on public.rh_journey_records for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_journey_manage on public.rh_journey_records for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Ausências --------------------------------------------------------------
create policy rh_absences_read on public.rh_absences for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
-- Colaborador cria a própria solicitação; gestor cria para a equipe.
create policy rh_absences_request on public.rh_absences for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and (
    public.has_permission('rh', 'create')
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
-- Decisão (aprovar/reprovar) exige a permissão de aprovação.
create policy rh_absences_decide on public.rh_absences for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'));

-- --- Saldo de férias --------------------------------------------------------
create policy rh_vacation_read on public.rh_vacation_balances for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_vacation_manage on public.rh_vacation_balances for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Planos de benefício (catálogo — leitura ampla para autosserviço) -------
-- O catálogo é "o que a empresa oferece", não dado pessoal. Qualquer membro da
-- organização vê, para poder consultar e solicitar adesão no "Meu RH" — mesmo
-- padrão do catálogo de módulos. O que é pessoal (adesões, dependentes) tem
-- policy própria com o vínculo do colaborador.
create policy rh_benefit_plans_read on public.rh_benefit_plans for select to authenticated
using (organization_id = public.current_organization_id());
create policy rh_benefit_plans_admin on public.rh_benefit_plans for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'admin'));

-- --- Adesões ----------------------------------------------------------------
create policy rh_enrollments_read on public.rh_benefit_enrollments for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_enrollments_manage on public.rh_benefit_enrollments for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Dependentes (herdam o acesso da adesão) --------------------------------
create policy rh_dependents_read on public.rh_benefit_dependents for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or enrollment_id in (
      select en.id from public.rh_benefit_enrollments en
      join public.employees e on e.id = en.employee_id
      where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_dependents_manage on public.rh_benefit_dependents for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Solicitações de benefício ----------------------------------------------
create policy rh_benefit_requests_read on public.rh_benefit_requests for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_benefit_requests_create on public.rh_benefit_requests for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and (
    public.has_permission('rh', 'create')
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_benefit_requests_decide on public.rh_benefit_requests for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'));

-- --- SST --------------------------------------------------------------------
-- Registro não-clínico: colaborador vê o próprio. Conteúdo clínico
-- (clinical_confidential = true) só aparece para quem tem rh.admin.
create policy rh_sst_read on public.rh_sst_records for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view')
      and (clinical_confidential = false or public.has_permission('rh', 'admin')))
    or (
      clinical_confidential = false
      and employee_id in (
        select e.id from public.employees e where e.profile_id = public.current_profile_id()
      )
    )
  )
);
-- Tratar SST (registrar/atualizar exame, treinamento, EPI) exige aprovação.
create policy rh_sst_manage on public.rh_sst_records for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'));

-- ============================================================================
-- 9. COMENTÁRIOS
-- ============================================================================

comment on table public.rh_journey_records is 'Marcações de ponto e saldo diário por colaborador; base para banco de horas.';
comment on table public.rh_absences is 'Solicitações e registros de férias, banco de horas, atestados e licenças, com fluxo de aprovação.';
comment on table public.rh_vacation_balances is 'Saldo de férias por período aquisitivo; direito, gozado e programado.';
comment on table public.rh_benefit_plans is 'Catálogo de benefícios oferecidos pela organização.';
comment on table public.rh_benefit_requests is 'Fluxo de adesão, alteração e cancelamento de benefícios, auditado.';
comment on table public.rh_sst_records is 'Exames, treinamentos, EPIs e ocorrências de SST. Conteúdo clínico fica isolado por clinical_confidential e exige rh.admin.';
comment on function public.audit_rh_mutation() is 'Registra em audit_logs toda mutação de ausências, solicitações de benefício, adesões e SST.';


-- ========================================================================
-- VERIFICAÇÃO FINAL
-- ========================================================================

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
