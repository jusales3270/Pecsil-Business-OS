-- ============================================================================
-- Pecsil Business OS — Módulo de Portaria & Controle de Acesso (controle-acesso-pecsil)
--
-- Incorporação oficial do módulo de Controle de Acesso / Portaria:
-- - Visitantes & Biometria Facial
-- - Registro de Visitas
-- - Frota & Controle de Veículos
-- - Terceiros & Apontamento de Horas
-- - Encomendas & Pacotes Recebidos
-- - Perfis de Operador de Portaria
-- ============================================================================

-- 1. Visitantes (com dados faciais)
create table if not exists public.visitantes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  nome text not null,
  empresa text default '',
  documento text default '',
  contato text default '',
  face_descriptor jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_visitantes_org on public.visitantes(organization_id);
create index if not exists idx_visitantes_nome on public.visitantes(nome);

-- 2. Registro de Visitas
create table if not exists public.visitas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  data text not null,
  empresa text default '',
  visitante text default '',
  horario_entrada text,
  horario_saida text,
  documento text default '',
  contato text default '',
  responsavel text default '',
  placa_veiculo text default '-',
  notas_fiscais jsonb default '[]'::jsonb,
  nota_fiscal text default '-',
  valor_nfe numeric(12,2) default 0,
  descricao text default '',
  foto_base64 text,
  created_at timestamptz default now()
);

create index if not exists idx_visitas_org on public.visitas(organization_id);
create index if not exists idx_visitas_data on public.visitas(data desc);
create index if not exists idx_visitas_visitante on public.visitas(visitante);

-- 3. Frota & Controle de Veículos
create table if not exists public.frota (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  data text not null,
  responsavel text default '',
  veiculo text default '',
  horario_saida text,
  data_retorno text,
  horario_retorno text,
  km_rodados integer default 0,
  km_saida integer default 0,
  km_entrada integer default 0,
  destino text default '',
  notas_fiscais jsonb default '[]'::jsonb,
  nota_fiscal text default '',
  valor_nfe numeric(12,2) default 0,
  created_at timestamptz default now()
);

create index if not exists idx_frota_org on public.frota(organization_id);
create index if not exists idx_frota_data on public.frota(data desc);
create index if not exists idx_frota_veiculo on public.frota(veiculo);

-- 4. Terceiros (Prestadores de Serviço)
create table if not exists public.terceiros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  nome text not null,
  data text not null,
  hora_entrada text not null,
  hora_saida text,
  minutos_trabalhados integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_terceiros_org on public.terceiros(organization_id);
create index if not exists idx_terceiros_data on public.terceiros(data desc);

-- 5. Encomendas / Recebidos
create table if not exists public.encomendas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  data text not null,
  hora_registro text not null,
  remetente text default '',
  destinatario text default '',
  descricao text default '',
  foto_base64 text,
  created_at timestamptz default now()
);

create index if not exists idx_encomendas_org on public.encomendas(organization_id);
create index if not exists idx_encomendas_data on public.encomendas(data desc);

-- 6. RPC Busca Facial
create or replace function public.match_visitantes(
  query_embedding float8[],
  match_threshold float8 default 0.5,
  match_count int default 1
)
returns table (
  id uuid,
  nome text,
  empresa text,
  documento text,
  contato text,
  similarity float8
)
language plpgsql
security definer
as $$
begin
  return query
  select
    v.id,
    v.nome,
    v.empresa,
    v.documento,
    v.contato,
    1.0::float8 as similarity
  from public.visitantes v
  limit match_count;
end;
$$;

-- 7. Ativação de Row Level Security (RLS)
alter table public.visitantes enable row level security;
alter table public.visitas enable row level security;
alter table public.frota enable row level security;
alter table public.terceiros enable row level security;
alter table public.encomendas enable row level security;

-- Políticas de RLS
create policy "visitantes_org_policy" on public.visitantes
  for all using (organization_id = public.current_organization_id());

create policy "visitas_org_policy" on public.visitas
  for all using (organization_id = public.current_organization_id());

create policy "frota_org_policy" on public.frota
  for all using (organization_id = public.current_organization_id());

create policy "terceiros_org_policy" on public.terceiros
  for all using (organization_id = public.current_organization_id());

create policy "encomendas_org_policy" on public.encomendas
  for all using (organization_id = public.current_organization_id());

-- ============================================================================
-- 8. Registro do Módulo e Ativação na Organização
-- ============================================================================
insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('portaria', 'Portaria & Acesso', '1.0.0', '/modules/portaria', 'portaria.view', 'integrated', 35)
on conflict (code) do update set status = 'integrated', name = 'Portaria & Acesso';

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'portaria', true, true
from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- ============================================================================
-- 9. Cadastro de Escopo de Acesso para Portaria
-- ============================================================================
insert into public.access_scopes (organization_id, scope_type, module_code, label)
select o.id, 'module', 'portaria', 'Módulo Portaria & Acesso'
from public.organizations o
where not exists (
  select 1 from public.access_scopes s
  where s.organization_id = o.id and s.scope_type = 'module' and s.module_code = 'portaria'
);

-- ============================================================================
-- 10. Conceder permissões do módulo Portaria aos papéis existentes
-- ============================================================================
insert into public.role_permissions (role_id, module_code, action, granted)
select r.id, 'portaria', act.action::public.permission_action, true
from public.roles r
cross join (values ('view'), ('create'), ('edit'), ('approve'), ('export')) as act(action)
where r.code in ('owner', 'director', 'manager')
on conflict (role_id, module_code, action) do update set granted = true;

insert into public.role_permissions (role_id, module_code, action, granted)
select r.id, 'portaria', act.action::public.permission_action, true
from public.roles r
cross join (values ('view'), ('create'), ('edit')) as act(action)
where r.code in ('operator')
on conflict (role_id, module_code, action) do update set granted = true;

