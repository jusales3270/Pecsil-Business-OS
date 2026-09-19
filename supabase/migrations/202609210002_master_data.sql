-- ============================================================================
-- Cadastros mestres: fornecedor e centro de custo
-- ============================================================================
-- Fornecedor era texto livre no Compras (cotacoes/compras.fornecedor) e no
-- Financeiro (finance_titles.counterparty_name). Agora existe um cadastro
-- único e cada registro aponta para ele (supplier_id). A tela do Compras não
-- muda: um gatilho resolve o fornecedor pelo nome normalizado a cada
-- gravação — acha o existente ou cria. Duplicados ("Aço Forte" x "ACO FORTE")
-- são unificados na Fundação › Cadastros; o nome do duplicado continua
-- apontando para o principal (merged_into), então lançamentos futuros com a
-- grafia antiga caem no fornecedor certo.
--
-- Centro de custo (finance_cost_centers) passa a ser comum: todos da
-- organização leem; Compras ganha cost_center_id para quando o processo
-- definir quem informa.
-- ============================================================================

-- --- Normalização de nomes --------------------------------------------------
create or replace function public.normalize_party_name(raw text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(
    translate(lower(coalesce(raw, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ.,;:/\-_()"''',
      'aaaaaeeeeiiiiooooouuuucn              '),
    '\s+', ' ', 'g')), '');
$$;

-- --- Fornecedores -------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  tax_id text,
  active boolean not null default true,
  merged_into uuid references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_name)
);

create unique index if not exists idx_suppliers_tax_id on public.suppliers(organization_id, tax_id) where tax_id is not null;

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at before update on public.suppliers
for each row execute function public.set_updated_at();

alter table public.cotacoes add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.compras add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.finance_titles add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.cotacoes add column if not exists cost_center_id uuid references public.finance_cost_centers(id) on delete set null;
alter table public.compras add column if not exists cost_center_id uuid references public.finance_cost_centers(id) on delete set null;

create index if not exists idx_cotacoes_supplier on public.cotacoes(supplier_id);
create index if not exists idx_compras_supplier on public.compras(supplier_id);
create index if not exists idx_finance_titles_supplier on public.finance_titles(supplier_id);

-- Acha (ou cria) o fornecedor pelo nome; um duplicado unificado devolve o principal.
create or replace function public.resolve_supplier(target_org uuid, raw_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  key text := public.normalize_party_name(raw_name);
  found uuid;
begin
  if key is null or target_org is null then
    return null;
  end if;
  select coalesce(s.merged_into, s.id) into found
  from public.suppliers s
  where s.organization_id = target_org and s.normalized_name = key;
  if found is null then
    insert into public.suppliers (organization_id, name, normalized_name)
    values (target_org, btrim(raw_name), key)
    on conflict (organization_id, normalized_name) do update set name = public.suppliers.name
    returning id into found;
  end if;
  return found;
end;
$$;

revoke all on function public.resolve_supplier(uuid, text) from public;

-- Carga inicial: um fornecedor por nome distinto (cotações, compras e títulos a pagar).
insert into public.suppliers (organization_id, name, normalized_name)
select distinct on (organization_id, normalized)
  organization_id, name, normalized
from (
  select organization_id, btrim(fornecedor) as name, public.normalize_party_name(fornecedor) as normalized, created_at from public.cotacoes
  union all
  select organization_id, btrim(fornecedor), public.normalize_party_name(fornecedor), created_at from public.compras
  union all
  select organization_id, btrim(counterparty_name), public.normalize_party_name(counterparty_name), created_at
  from public.finance_titles where direction = 'payable'
) names
where normalized is not null
order by organization_id, normalized, created_at desc
on conflict (organization_id, normalized_name) do nothing;

update public.cotacoes c set supplier_id = s.id
from public.suppliers s
where c.supplier_id is null and s.organization_id = c.organization_id
  and s.normalized_name = public.normalize_party_name(c.fornecedor);
update public.compras c set supplier_id = s.id
from public.suppliers s
where c.supplier_id is null and s.organization_id = c.organization_id
  and s.normalized_name = public.normalize_party_name(c.fornecedor);
update public.finance_titles t set supplier_id = s.id
from public.suppliers s
where t.supplier_id is null and t.direction = 'payable' and s.organization_id = t.organization_id
  and s.normalized_name = public.normalize_party_name(t.counterparty_name);

-- Vínculo automático a cada gravação (a tela do Compras não muda). O nome da
-- coluna de texto vem como argumento do gatilho: as tabelas têm colunas
-- diferentes e o PL/pgSQL não aceita referenciar campo inexistente de NEW.
create or replace function public.link_supplier_from_text()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col text := tg_argv[0];
  raw text := to_jsonb(new) ->> col;
  previous text;
begin
  if tg_table_name = 'finance_titles' and (to_jsonb(new) ->> 'direction') <> 'payable' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    previous := to_jsonb(old) ->> col;
  end if;
  if tg_op = 'INSERT' or new.supplier_id is null
     or public.normalize_party_name(raw) is distinct from public.normalize_party_name(previous) then
    new.supplier_id := public.resolve_supplier(new.organization_id, raw);
  end if;
  return new;
end;
$$;

revoke all on function public.link_supplier_from_text() from public;

drop trigger if exists cotacoes_link_supplier on public.cotacoes;
create trigger cotacoes_link_supplier before insert or update of fornecedor on public.cotacoes
for each row execute function public.link_supplier_from_text('fornecedor');
drop trigger if exists compras_link_supplier on public.compras;
create trigger compras_link_supplier before insert or update of fornecedor on public.compras
for each row execute function public.link_supplier_from_text('fornecedor');
drop trigger if exists finance_titles_link_supplier on public.finance_titles;
create trigger finance_titles_link_supplier before insert or update of counterparty_name on public.finance_titles
for each row execute function public.link_supplier_from_text('counterparty_name');

-- Unificar duplicados: move os vínculos para o principal e guarda o apelido.
create or replace function public.merge_suppliers(keep_id uuid, drop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  keep_name text;
  drop_name text;
begin
  if not public.has_feature('fundacao.cadastros', 'operar') then
    raise exception 'Sem permissão para unificar fornecedores.' using errcode = '42501';
  end if;
  if keep_id = drop_id then
    raise exception 'Escolha dois fornecedores diferentes.';
  end if;
  select name into keep_name from public.suppliers where id = keep_id and organization_id = org and merged_into is null;
  select name into drop_name from public.suppliers where id = drop_id and organization_id = org and merged_into is null;
  if keep_name is null or drop_name is null then
    raise exception 'Fornecedor não encontrado.';
  end if;

  update public.cotacoes set supplier_id = keep_id where supplier_id = drop_id;
  update public.compras set supplier_id = keep_id where supplier_id = drop_id;
  update public.finance_titles set supplier_id = keep_id where supplier_id = drop_id;
  -- Apelidos que apontavam para o unificado passam a apontar para o principal.
  update public.suppliers set merged_into = keep_id where merged_into = drop_id;
  update public.suppliers set merged_into = keep_id, active = false where id = drop_id;

  perform public.emit_module_event(org, 'cadastros', 'cadastros.fornecedor.unificado', 'fornecedor', keep_id::text,
    format('Fornecedores unificados · "%s" agora é "%s"', drop_name, keep_name),
    jsonb_build_object('mantido', keep_id, 'unificado', drop_id));
end;
$$;

revoke all on function public.merge_suppliers(uuid, uuid) from public;
grant execute on function public.merge_suppliers(uuid, uuid) to authenticated;

-- Evento de novo fornecedor (inclusive os criados pelo vínculo automático).
create or replace function public.events_cadastros_fornecedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_module_event(new.organization_id, 'cadastros', 'cadastros.fornecedor.criado', 'fornecedor', new.id::text,
    format('Fornecedor cadastrado · %s', new.name), jsonb_build_object('tax_id', new.tax_id));
  return new;
end;
$$;

revoke all on function public.events_cadastros_fornecedor() from public;

drop trigger if exists suppliers_events on public.suppliers;
create trigger suppliers_events after insert on public.suppliers
for each row execute function public.events_cadastros_fornecedor();

-- RLS: todos da organização leem (Compras e Financeiro precisam); editar é de
-- quem tem Fundação › Cadastros (operar). O vínculo automático passa pelo
-- gatilho (security definer), não por esta policy.
alter table public.suppliers enable row level security;
drop policy if exists suppliers_read on public.suppliers;
create policy suppliers_read on public.suppliers for select to authenticated
using (organization_id = public.current_organization_id());
drop policy if exists suppliers_manage on public.suppliers;
create policy suppliers_manage on public.suppliers for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('fundacao.cadastros', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('fundacao.cadastros', 'operar'));

-- --- Centro de custo comum -------------------------------------------------------
drop policy if exists finance_cost_centers_read on public.finance_cost_centers;
create policy finance_cost_centers_read on public.finance_cost_centers for select to authenticated
using (organization_id = public.current_organization_id());
drop policy if exists finance_cost_centers_admin on public.finance_cost_centers;
create policy finance_cost_centers_admin on public.finance_cost_centers for all to authenticated
using (organization_id = public.current_organization_id()
  and (public.has_feature('financeiro.centros', 'operar') or public.has_feature('fundacao.cadastros', 'operar')))
with check (organization_id = public.current_organization_id()
  and (public.has_feature('financeiro.centros', 'operar') or public.has_feature('fundacao.cadastros', 'operar')));

create or replace function public.events_cadastros_centro_custo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'cadastros', 'cadastros.centro_custo.criado', 'centro_custo', new.id::text,
      format('Centro de custo criado · %s %s', new.code, new.name), '{}'::jsonb);
  elsif old.active and not new.active then
    perform public.emit_module_event(new.organization_id, 'cadastros', 'cadastros.centro_custo.desativado', 'centro_custo', new.id::text,
      format('Centro de custo desativado · %s %s', new.code, new.name), '{}'::jsonb);
  end if;
  return new;
end;
$$;

revoke all on function public.events_cadastros_centro_custo() from public;

drop trigger if exists finance_cost_centers_events on public.finance_cost_centers;
create trigger finance_cost_centers_events after insert or update of active on public.finance_cost_centers
for each row execute function public.events_cadastros_centro_custo();

-- Uso de cada fornecedor (cotações, compras, títulos) para a tela de
-- Cadastros. Security definer: quem cuida dos cadastros vê as contagens sem
-- precisar de acesso às tabelas do Compras e do Financeiro.
create or replace function public.supplier_usage()
returns table (supplier_id uuid, cotacoes bigint, compras bigint, titulos bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.id,
    (select count(*) from public.cotacoes c where c.supplier_id = s.id),
    (select count(*) from public.compras c where c.supplier_id = s.id),
    (select count(*) from public.finance_titles t where t.supplier_id = s.id)
  from public.suppliers s
  where s.organization_id = public.current_organization_id()
    and public.has_feature('fundacao.cadastros');
$$;

revoke all on function public.supplier_usage() from public;
grant execute on function public.supplier_usage() to authenticated;
