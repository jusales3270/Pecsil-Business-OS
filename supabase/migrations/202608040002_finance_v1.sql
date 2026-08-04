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
