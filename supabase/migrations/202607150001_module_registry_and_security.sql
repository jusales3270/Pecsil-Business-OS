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
