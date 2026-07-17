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
