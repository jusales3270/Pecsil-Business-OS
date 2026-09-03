-- ============================================================================
-- Pecsil Business OS — Módulo de Compras (compras-pecsil)
--
-- Incorporação oficial do módulo de Compras ao ecossistema corporativo:
-- - Cotações (Usinagem / Fundição)
-- - Itens de Cotação (múltiplos produtos por cotação)
-- - Compras faturadas / realizadas com NF
-- - Notificações de cotações
--
-- Mantém compatibilidade 100% com o schema do compras-pecsil original,
-- adicionando organization_id e RLS para isolamento corporativo.
-- ============================================================================

-- 1. Cotações (Cabeçalho)
create table if not exists public.cotacoes (
  id bigserial primary key,
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  fornecedor text not null,
  divisao text not null default 'USINAGEM' check (divisao in ('USINAGEM', 'FUNDICAO')),
  status text not null default 'PENDENTE' check (status in ('PENDENTE','APROVADO','REJEITADO','COMPRADO')),
  user_id text not null,
  aprovado_por text,
  motivo_rejeicao text,
  data_decisao timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  produto text,
  valor_unit numeric(12,2),
  quantidade numeric(12,3),
  unidade text,
  icms numeric(5,2) default 0,
  ipi numeric(5,2) default 0,
  prazo text,
  obs text default ''
);

create index if not exists idx_cotacoes_org on public.cotacoes(organization_id);
create index if not exists idx_cotacoes_status on public.cotacoes(status);
create index if not exists idx_cotacoes_divisao on public.cotacoes(divisao);
create index if not exists idx_cotacoes_created on public.cotacoes(created_at desc);

-- 2. Itens da Cotação (Múltiplos Produtos)
create table if not exists public.cotacao_produtos (
  id bigserial primary key,
  cotacao_id bigint references public.cotacoes(id) on delete cascade not null,
  produto text not null,
  valor_unit numeric(12,2) not null,
  quantidade numeric(12,3) not null,
  unidade text not null,
  icms numeric(5,2) not null default 0,
  ipi numeric(5,2) not null default 0,
  prazo text not null,
  obs text default '',
  status text not null default 'PENDENTE' check (status in ('PENDENTE','APROVADO','REJEITADO')),
  motivo_rejeicao text,
  created_at timestamptz default now()
);

create index if not exists idx_cotacao_produtos_cotacao on public.cotacao_produtos(cotacao_id);
create index if not exists idx_cotacao_produtos_status on public.cotacao_produtos(status);

-- 3. Compras Realizadas / Faturadas
create table if not exists public.compras (
  id bigserial primary key,
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  cotacao_id bigint references public.cotacoes(id) on delete restrict not null,
  fornecedor text not null,
  produto text not null,
  quantidade numeric(12,3) not null,
  unidade text not null,
  valor_unit numeric(12,2) not null,
  total numeric(14,2) not null,
  nf text,
  data_compra date not null default current_date,
  obs text,
  created_at timestamptz default now()
);

create index if not exists idx_compras_org on public.compras(organization_id);
create index if not exists idx_compras_cotacao on public.compras(cotacao_id);
create index if not exists idx_compras_data on public.compras(data_compra desc);

-- 4. Notificações de Compras
create table if not exists public.notificacoes_compras (
  id bigserial primary key,
  organization_id uuid not null default public.current_organization_id() references public.organizations(id) on delete cascade,
  user_id text not null,
  cotacao_id bigint references public.cotacoes(id) on delete cascade,
  tipo text not null check (tipo in ('COTACAO_APROVADA','COTACAO_REJEITADA','NOVA_COTACAO_PENDENTE','COTACAO_COMPRADA')),
  mensagem text not null,
  lida boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_notif_compras_org_user on public.notificacoes_compras(organization_id, user_id);

-- ============================================================================
-- Políticas de Segurança (Row Level Security)
-- ============================================================================

alter table public.cotacoes enable row level security;
alter table public.cotacao_produtos enable row level security;
alter table public.compras enable row level security;
alter table public.notificacoes_compras enable row level security;

-- Cotações RLS
drop policy if exists cotacoes_all on public.cotacoes;
create policy cotacoes_all on public.cotacoes for all to authenticated
using (organization_id = public.current_organization_id())
with check (organization_id = public.current_organization_id());

-- Cotacao Produtos RLS (herda o isolamento da cotacao pai)
drop policy if exists cotacao_produtos_all on public.cotacao_produtos;
create policy cotacao_produtos_all on public.cotacao_produtos for all to authenticated
using (exists (select 1 from public.cotacoes c where c.id = cotacao_id and c.organization_id = public.current_organization_id()))
with check (exists (select 1 from public.cotacoes c where c.id = cotacao_id and c.organization_id = public.current_organization_id()));

-- Compras RLS
drop policy if exists compras_all on public.compras;
create policy compras_all on public.compras for all to authenticated
using (organization_id = public.current_organization_id())
with check (organization_id = public.current_organization_id());

-- Notificações Compras RLS
drop policy if exists notificacoes_compras_all on public.notificacoes_compras;
create policy notificacoes_compras_all on public.notificacoes_compras for all to authenticated
using (organization_id = public.current_organization_id())
with check (organization_id = public.current_organization_id());

-- ============================================================================
-- Cadastro de Escopo de Acesso para o Módulo de Compras
-- ============================================================================

insert into public.access_scopes (organization_id, scope_type, module_code, label)
select o.id, 'module', 'compras', 'Módulo Compras'
from public.organizations o
where not exists (
  select 1 from public.access_scopes s
  where s.organization_id = o.id and s.scope_type = 'module' and s.module_code = 'compras'
);

-- Conceder permissões do módulo Compras aos papéis existentes
insert into public.role_permissions (role_id, module_code, action, granted)
select r.id, 'compras', act.action::public.permission_action, true
from public.roles r
cross join (values ('view'), ('create'), ('edit'), ('approve'), ('export')) as act(action)
where r.code in ('owner', 'director', 'manager')
on conflict (role_id, module_code, action) do update set granted = true;

insert into public.role_permissions (role_id, module_code, action, granted)
select r.id, 'compras', act.action::public.permission_action, true
from public.roles r
cross join (values ('view'), ('create'), ('edit')) as act(action)
where r.code in ('operator')
on conflict (role_id, module_code, action) do update set granted = true;
