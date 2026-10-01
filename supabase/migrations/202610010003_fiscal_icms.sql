-- Módulo Fiscal — primeira parte: Painel do ICMS.
--
-- Substitui a planilha mensal do ICMS (uma linha por nota de entrada, com as
-- marcações F/U/RS de centro e XML/LACTO/AUT de situação, mais o livro de
-- apuração do mês). As notas que o Almoxarifado recebe entram sozinhas; as do
-- administrativo (Jeferson) e de terceiros (Rosana) entram aqui mesmo.
--
-- Permissão: fiscal.icms — operar para quem lança (Jeferson, Henrique, Rosana),
-- ver para quem só acompanha (Ricardo). O dono concede em Pessoas e Acessos.

insert into public.access_features (code, module_code, label, levels, sort) values
  ('fiscal.icms', 'fiscal', 'Painel do ICMS', '{ver,operar}', 10)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('fiscal', 'Fiscal', '1.0.0', '/modules/fiscal', 'fiscal.view', 'integrated', 25)
on conflict (code) do update set status = 'integrated', name = 'Fiscal', route = excluded.route, menu_order = excluded.menu_order;

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'fiscal', true, true from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- --- Notas de entrada do mês ---------------------------------------------------------
create table if not exists public.fiscal_icms_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  emitida date,
  recebida date,
  fornecedor text not null,
  fantasia text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  cnpj text,
  nfe text,
  serie text,
  chave text check (chave is null or chave ~ '^\d{44}$'),
  valor numeric(18,2) not null default 0,
  vlr_cobrado numeric(18,2) not null default 0,
  base_icms numeric(18,2) not null default 0,
  icms numeric(18,2) not null default 0,
  ipi numeric(18,2) not null default 0,
  tipo text,
  -- Centro (colunas F, U e RS da planilha): uma nota pode ratear entre eles.
  fundicao boolean not null default false,
  usinagem boolean not null default false,
  administrativo boolean not null default false,
  -- Situação (colunas XML, LACTO. e AUT.).
  xml_ok boolean not null default false,
  lancado boolean not null default false,
  autorizado boolean not null default false,
  obs text,
  origem text not null default 'manual' check (origem in ('almoxarifado', 'manual', 'historico')),
  receipt_id uuid,
  legacy_key text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fiscal_icms_entries_mes on public.fiscal_icms_entries (organization_id, competencia, recebida);
create unique index if not exists uq_fiscal_icms_chave on public.fiscal_icms_entries (organization_id, chave) where chave is not null;
create unique index if not exists uq_fiscal_icms_legacy on public.fiscal_icms_entries (organization_id, legacy_key) where legacy_key is not null;

-- --- Livro de apuração do mês --------------------------------------------------------
create table if not exists public.fiscal_icms_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  ordem int not null default 1,
  descricao text not null,
  credito numeric(18,2) not null default 0,
  debito numeric(18,2) not null default 0,
  saldo numeric(18,2),
  legacy_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fiscal_icms_ledger_mes on public.fiscal_icms_ledger (organization_id, competencia, ordem);
create unique index if not exists uq_fiscal_icms_ledger_legacy on public.fiscal_icms_ledger (organization_id, legacy_key) where legacy_key is not null;

alter table public.fiscal_icms_entries enable row level security;
alter table public.fiscal_icms_ledger enable row level security;

drop policy if exists fiscal_icms_entries_read on public.fiscal_icms_entries;
create policy fiscal_icms_entries_read on public.fiscal_icms_entries for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.icms'))
);
drop policy if exists fiscal_icms_entries_write on public.fiscal_icms_entries;
create policy fiscal_icms_entries_write on public.fiscal_icms_entries for all using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.icms', 'operar'))
) with check (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.icms', 'operar'))
);

drop policy if exists fiscal_icms_ledger_read on public.fiscal_icms_ledger;
create policy fiscal_icms_ledger_read on public.fiscal_icms_ledger for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.icms'))
);
drop policy if exists fiscal_icms_ledger_write on public.fiscal_icms_ledger;
create policy fiscal_icms_ledger_write on public.fiscal_icms_ledger for all using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.icms', 'operar'))
) with check (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('fiscal.icms', 'operar'))
);

-- Quem lançou e quando: preenchido pelo banco.
create or replace function public.fiscal_icms_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.organization_id := coalesce(new.organization_id, public.current_organization_id());
    new.created_by := coalesce(new.created_by, public.current_profile_id());
    new.created_by_name := coalesce(new.created_by_name, (select full_name from public.profiles where id = new.created_by));
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fiscal_icms_entries_stamp on public.fiscal_icms_entries;
create trigger fiscal_icms_entries_stamp before insert or update on public.fiscal_icms_entries
  for each row execute function public.fiscal_icms_stamp();
