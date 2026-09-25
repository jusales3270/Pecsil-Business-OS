-- ============================================================================
-- RH — entregas de EPI (ficha de EPI da NR-6)
-- ============================================================================
-- `rh_sst_records` guarda obrigação com prazo (exame, treinamento). Entrega de
-- EPI é outra coisa: um registro por item entregue, com o CA, a quantidade e a
-- assinatura de quem recebeu. Por isso duas tabelas próprias:
--
--   rh_ppe_items       catálogo — o mesmo EPI com CA diferente é outro produto
--                      certificado, então a chave é nome + CA;
--   rh_ppe_deliveries  cada entrega, ligada ao colaborador e ao item.
--
-- Quem vê: `rh.sst` (ver), ou o próprio colaborador a sua ficha. Quem grava:
-- `rh.sst` em operar. Nenhum documento pessoal (CPF) é guardado aqui: o
-- vínculo com a pessoa é o `employee_id`.
-- ============================================================================

create table if not exists public.rh_ppe_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  -- Chave de reconhecimento: nome sem acento, caixa ou espaço duplo.
  normalized_name text not null,
  ca_number text check (ca_number is null or ca_number ~ '^\d+$'),
  -- Validade do CA e vida útil prevista: ainda não vêm na exportação do ponto.
  ca_valid_until date,
  replacement_days integer check (replacement_days is null or replacement_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_rh_ppe_items_key
  on public.rh_ppe_items(organization_id, normalized_name, coalesce(ca_number, ''));

create table if not exists public.rh_ppe_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  item_id uuid not null references public.rh_ppe_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  delivered_on date not null,
  -- Nulo = entregue sem assinatura de recebimento.
  signed_on date,
  signature_method text check (signature_method is null or signature_method in ('biometria', 'papel')),
  source text,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((signed_on is null) = (signature_method is null)),
  constraint rh_ppe_deliveries_source_key_key unique (organization_id, source_key)
);

create index if not exists idx_rh_ppe_deliveries_employee
  on public.rh_ppe_deliveries(employee_id, delivered_on desc);
create index if not exists idx_rh_ppe_deliveries_org_date
  on public.rh_ppe_deliveries(organization_id, delivered_on desc);

drop trigger if exists rh_ppe_items_updated_at on public.rh_ppe_items;
create trigger rh_ppe_items_updated_at before update on public.rh_ppe_items
for each row execute function public.set_updated_at();
drop trigger if exists rh_ppe_deliveries_updated_at on public.rh_ppe_deliveries;
create trigger rh_ppe_deliveries_updated_at before update on public.rh_ppe_deliveries
for each row execute function public.set_updated_at();

drop trigger if exists rh_ppe_deliveries_audit on public.rh_ppe_deliveries;
create trigger rh_ppe_deliveries_audit after insert or update or delete on public.rh_ppe_deliveries
for each row execute function public.audit_rh_mutation();

-- --- RLS --------------------------------------------------------------------
alter table public.rh_ppe_items enable row level security;
drop policy if exists rh_ppe_items_read on public.rh_ppe_items;
create policy rh_ppe_items_read on public.rh_ppe_items for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.sst')
  -- O colaborador precisa do nome do item para ler a própria ficha.
  or exists (select 1 from public.employees e where e.profile_id = public.current_profile_id())
));
drop policy if exists rh_ppe_items_manage on public.rh_ppe_items;
create policy rh_ppe_items_manage on public.rh_ppe_items for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.sst', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.sst', 'operar'));

alter table public.rh_ppe_deliveries enable row level security;
drop policy if exists rh_ppe_deliveries_read on public.rh_ppe_deliveries;
create policy rh_ppe_deliveries_read on public.rh_ppe_deliveries for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.sst')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
drop policy if exists rh_ppe_deliveries_manage on public.rh_ppe_deliveries;
create policy rh_ppe_deliveries_manage on public.rh_ppe_deliveries for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.sst', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.sst', 'operar'));

comment on table public.rh_ppe_items is 'Catálogo de EPI. Mesmo nome com CA diferente é outro produto certificado (NR-6).';
comment on table public.rh_ppe_deliveries is 'Ficha de EPI: cada entrega, com quantidade, data e assinatura de recebimento. Sem documento pessoal.';
