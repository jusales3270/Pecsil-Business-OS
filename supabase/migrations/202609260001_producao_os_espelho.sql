-- ============================================================================
-- Produção: a OS do Forja dentro do Business OS (espelho só de leitura)
-- e o cliente único (etapas 2 e 3 do docs/PLANO-CUSTO-MARGEM.md)
-- ============================================================================
-- O Forja continua a fonte da verdade da produção. Aqui a OS vira uma
-- REFERÊNCIA que os outros módulos podem apontar (compras, títulos, estoque),
-- para o custo e a margem saírem por OS sem engenharia de dados depois.
--
--   production_orders            parte operacional (cliente, artigo, prazo, status)
--   production_order_financials  preço, NF e recebimento — acesso mais restrito
--   customer_external_ids        vínculo do cliente único com o id em outro sistema
--   integration_sync_runs        cada rodada de sincronização, para a tela de saúde
--
-- Ninguém grava pelas telas: só a sincronização (chave de serviço). OS que some
-- da lista do Forja é marcada (`removed_from_source_at`), nunca apagada.
-- ============================================================================

-- --- Vínculo do cliente único com sistemas de origem -------------------------
create table if not exists public.customer_external_ids (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source text not null check (source in ('forja')),
  external_id text not null,
  external_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index if not exists idx_customer_external_ids_customer on public.customer_external_ids(customer_id);

-- --- OS: parte operacional ---------------------------------------------------
create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null default 'forja' check (source in ('forja')),
  external_id text not null,
  code text not null,
  customer_id uuid references public.customers(id) on delete set null,
  external_customer_id text,
  customer_name text,
  article_code text,
  article_description text,
  product_type text,
  quantity integer,
  due_date date,
  opened_at timestamptz,
  priority text,
  status text not null,
  lots_count integer,
  source_updated_at timestamptz,
  removed_from_source_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index if not exists idx_production_orders_code on public.production_orders(organization_id, code);
create index if not exists idx_production_orders_customer on public.production_orders(customer_id);
create index if not exists idx_production_orders_status on public.production_orders(organization_id, status);

-- --- OS: parte financeira (acesso restrito) ---------------------------------
create table if not exists public.production_order_financials (
  order_id uuid primary key references public.production_orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_price numeric(12,2),
  total_value numeric(14,2),
  customer_po text,
  invoice_number text,
  invoice_status text,
  invoice_date date,
  amount_received numeric(14,2),
  paid_at date,
  updated_at timestamptz not null default now()
);

-- --- Rodadas de sincronização ------------------------------------------------
create table if not exists public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null,
  mode text not null check (mode in ('apply', 'simulate')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  counts jsonb not null default '{}',
  error text
);
create index if not exists idx_integration_sync_runs_recent on public.integration_sync_runs(organization_id, source, started_at desc);

drop trigger if exists customer_external_ids_updated_at on public.customer_external_ids;
create trigger customer_external_ids_updated_at before update on public.customer_external_ids
for each row execute function public.set_updated_at();
drop trigger if exists production_orders_updated_at on public.production_orders;
create trigger production_orders_updated_at before update on public.production_orders
for each row execute function public.set_updated_at();
drop trigger if exists production_order_financials_updated_at on public.production_order_financials;
create trigger production_order_financials_updated_at before update on public.production_order_financials
for each row execute function public.set_updated_at();

-- --- Eventos na trilha -------------------------------------------------------
-- OS aberta (primeira vez que aparece), mudança de status e OS faturada (NF).
-- O resumo não leva valor: a trilha é lida por mais gente que o financeiro.
-- Na primeira carga chegam todas as OS antigas de uma vez: só o que é recente
-- (aberta ou faturada nos últimos 7 dias) vira evento, senão a trilha
-- ganharia centenas de "OS aberta" que aconteceram há meses.
create or replace function public.events_producao_os()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.opened_at is not null and new.opened_at < now() - interval '7 days' then
      return new;
    end if;
    perform public.emit_module_event(new.organization_id, 'producao', 'producao.os.aberta', 'os', new.id::text,
      format('OS %s aberta · %s · %s', new.code, coalesce(new.customer_name, 'cliente'), coalesce(new.article_code, 'artigo')),
      jsonb_build_object('code', new.code, 'status', new.status, 'due_date', new.due_date));
    return new;
  end if;
  if new.status is distinct from old.status then
    perform public.emit_module_event(new.organization_id, 'producao', 'producao.os.status', 'os', new.id::text,
      format('OS %s: %s → %s', new.code, old.status, new.status),
      jsonb_build_object('code', new.code, 'from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;
revoke all on function public.events_producao_os() from public;

drop trigger if exists production_orders_events on public.production_orders;
create trigger production_orders_events after insert or update of status on public.production_orders
for each row execute function public.events_producao_os();

create or replace function public.events_producao_os_faturada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  codigo text;
begin
  if new.invoice_number is null or (tg_op = 'UPDATE' and new.invoice_number is not distinct from old.invoice_number) then
    return new;
  end if;
  if new.invoice_date is not null and new.invoice_date < current_date - 7 then
    return new;
  end if;
  select code into codigo from public.production_orders where id = new.order_id;
  perform public.emit_module_event(new.organization_id, 'producao', 'producao.os.faturada', 'os', new.order_id::text,
    format('OS %s faturada · NF %s', coalesce(codigo, '?'), new.invoice_number),
    jsonb_build_object('code', codigo, 'invoice_number', new.invoice_number));
  return new;
end;
$$;
revoke all on function public.events_producao_os_faturada() from public;

drop trigger if exists production_order_financials_events on public.production_order_financials;
create trigger production_order_financials_events after insert or update of invoice_number on public.production_order_financials
for each row execute function public.events_producao_os_faturada();

-- --- RLS ---------------------------------------------------------------------
-- Leitura; escrita só pela chave de serviço (nenhuma policy de escrita).
alter table public.production_orders enable row level security;
drop policy if exists production_orders_read on public.production_orders;
create policy production_orders_read on public.production_orders for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('producao.os')
  or public.has_feature('financeiro.receber')
  or public.has_feature('comercial.cobranca')
  or public.has_feature('comercial.funil')
));

-- Valores: Financeiro e Comercial (decisão do proprietário em 26/09/2026).
alter table public.production_order_financials enable row level security;
drop policy if exists production_order_financials_read on public.production_order_financials;
create policy production_order_financials_read on public.production_order_financials for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('financeiro.receber')
  or public.has_feature('comercial.cobranca')
  or public.has_feature('comercial.funil')
));

alter table public.customer_external_ids enable row level security;
drop policy if exists customer_external_ids_read on public.customer_external_ids;
create policy customer_external_ids_read on public.customer_external_ids for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('comercial.clientes') or public.has_feature('fundacao.cadastros') or public.has_feature('producao.os')
));

alter table public.integration_sync_runs enable row level security;
drop policy if exists integration_sync_runs_read on public.integration_sync_runs;
create policy integration_sync_runs_read on public.integration_sync_runs for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('producao.conexao'));

comment on table public.production_orders is 'Espelho só de leitura das OS do Forja (fonte da verdade). Gravado apenas pela sincronização.';
comment on table public.production_order_financials is 'Preço, NF e recebimento da OS. Leitura: financeiro.receber, comercial.cobranca, comercial.funil.';
