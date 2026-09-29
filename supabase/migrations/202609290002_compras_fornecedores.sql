-- ============================================================================
-- Compras › Fornecedores: cadastro completo e histórico por fornecedor
-- ============================================================================
-- O cadastro mestre (suppliers, 202609210002) já liga cada cotação e compra
-- ao fornecedor. Aqui ele ganha os dados de cadastro (contato, endereço, dados
-- comerciais, classificação) e o Compras ganha permissão própria para mantê-lo
-- — quem tem Fundação › Cadastros continua podendo. O histórico sai dos
-- lançamentos que já existem; nada é copiado.
-- ============================================================================

alter table public.suppliers
  add column if not exists legal_name text,
  add column if not exists trade_name text,
  add column if not exists state_registration text,
  add column if not exists contact_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists payment_terms text,
  add column if not exists divisions text[] not null default '{}',
  add column if not exists category text,
  add column if not exists notes text;

do $$ begin
  alter table public.suppliers
    add constraint suppliers_divisions_check check (divisions <@ array['USINAGEM', 'FUNDICAO']::text[]);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.suppliers
    add constraint suppliers_state_check check (state is null or state ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

-- --- Permissão --------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('compras.fornecedores', 'compras', 'Fornecedores', '{ver,operar}', 40)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- Quem mantém o cadastro: Fundação › Cadastros ou Compras › Fornecedores (operar).
create or replace function public.can_manage_suppliers()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('fundacao.cadastros', 'operar') or public.has_feature('compras.fornecedores', 'operar');
$$;
revoke all on function public.can_manage_suppliers() from public;
grant execute on function public.can_manage_suppliers() to authenticated;

drop policy if exists suppliers_manage on public.suppliers;
create policy suppliers_manage on public.suppliers for all to authenticated
using (organization_id = public.current_organization_id() and public.can_manage_suppliers())
with check (organization_id = public.current_organization_id() and public.can_manage_suppliers());

-- Unificar passa a aceitar as duas permissões (o corpo é o de 202609210002).
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
  if not public.can_manage_suppliers() then
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
  update public.suppliers set merged_into = keep_id where merged_into = drop_id;
  update public.suppliers set merged_into = keep_id, active = false where id = drop_id;

  perform public.emit_module_event(org, 'cadastros', 'cadastros.fornecedor.unificado', 'fornecedor', keep_id::text,
    format('Fornecedores unificados · "%s" agora é "%s"', drop_name, keep_name),
    jsonb_build_object('mantido', keep_id, 'unificado', drop_id));
end;
$$;
revoke all on function public.merge_suppliers(uuid, uuid) from public;
grant execute on function public.merge_suppliers(uuid, uuid) to authenticated;

-- --- Resumo de compras por fornecedor ----------------------------------------
-- Uma linha por fornecedor principal. Cotações apagadas (deleted_at) ficam fora.
create or replace function public.supplier_purchase_summary()
returns table (
  supplier_id uuid,
  cotacoes bigint,
  aprovadas bigint,
  rejeitadas bigint,
  compradas bigint,
  pendentes bigint,
  compras bigint,
  total_comprado numeric,
  primeira_compra date,
  ultima_compra date,
  ultima_cotacao timestamptz,
  divisoes text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id,
    count(distinct c.id),
    count(distinct c.id) filter (where c.status = 'APROVADO'),
    count(distinct c.id) filter (where c.status = 'REJEITADO'),
    count(distinct c.id) filter (where c.status = 'COMPRADO'),
    count(distinct c.id) filter (where c.status = 'PENDENTE'),
    (select count(*) from public.compras x where x.supplier_id = s.id),
    (select coalesce(sum(x.total), 0) from public.compras x where x.supplier_id = s.id),
    (select min(x.data_compra) from public.compras x where x.supplier_id = s.id),
    (select max(x.data_compra) from public.compras x where x.supplier_id = s.id),
    max(c.created_at),
    coalesce(array_agg(distinct c.divisao) filter (where c.divisao is not null), '{}')
  from public.suppliers s
  left join public.cotacoes c on c.supplier_id = s.id and c.deleted_at is null
  where s.organization_id = public.current_organization_id()
    and s.merged_into is null
    and (public.has_module('compras') or public.has_feature('fundacao.cadastros'))
  group by s.id;
$$;
revoke all on function public.supplier_purchase_summary() from public;
grant execute on function public.supplier_purchase_summary() to authenticated;
