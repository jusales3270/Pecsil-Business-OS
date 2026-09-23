-- ============================================================================
-- Comercial (CRM): cadastro de clientes e e-mails conhecidos
-- ============================================================================
-- O Business OS tinha cadastro de fornecedor e centro de custo, mas nenhum de
-- CLIENTE: no Financeiro o cliente era só texto (finance_titles.counterparty_name
-- quando direction = 'receivable'). O CRM precisa do cliente como entidade para
-- ligar e-mail, card do funil e cobrança à mesma pessoa jurídica.
--
-- `party_emails` é a lista de REMETENTES CONHECIDOS: e-mail → cliente ou
-- fornecedor. É o filtro da caixa do diretor de operações — de lá o sistema só
-- registra o que vem de quem já está cadastrado, e nada mais.
--
-- Espelha 202609210002_master_data.sql (fornecedores): nome normalizado único,
-- unificação de duplicados com apelido (merged_into), vínculo automático por
-- gatilho e evento na trilha.
-- ============================================================================

-- --- Clientes ---------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  tax_id text,
  active boolean not null default true,
  merged_into uuid references public.customers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_name)
);

create unique index if not exists idx_customers_tax_id on public.customers(organization_id, tax_id) where tax_id is not null;

drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();

-- Cliente cadastrado à mão (a tela não manda a chave): o banco a calcula a
-- partir do nome. Renomear depois NÃO muda a chave, de propósito — é ela que
-- reconhece a grafia antiga em lançamento e e-mail que chegam.
create or replace function public.customers_set_key()
returns trigger
language plpgsql
as $$
begin
  if new.normalized_name is null or btrim(new.normalized_name) = '' then
    new.normalized_name := public.normalize_party_name(new.name);
  end if;
  if new.normalized_name is null then
    raise exception 'Informe o nome do cliente.';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_key on public.customers;
create trigger customers_key before insert on public.customers
for each row execute function public.customers_set_key();

alter table public.finance_titles add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists idx_finance_titles_customer on public.finance_titles(customer_id);

-- Acha (ou cria) o cliente pelo nome; um duplicado unificado devolve o principal.
create or replace function public.resolve_customer(target_org uuid, raw_name text)
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
  select coalesce(c.merged_into, c.id) into found
  from public.customers c
  where c.organization_id = target_org and c.normalized_name = key;
  if found is null then
    insert into public.customers (organization_id, name, normalized_name)
    values (target_org, btrim(raw_name), key)
    on conflict (organization_id, normalized_name) do update set name = public.customers.name
    returning id into found;
  end if;
  return found;
end;
$$;

revoke all on function public.resolve_customer(uuid, text) from public;

-- Carga inicial: um cliente por nome distinto nos títulos a receber.
insert into public.customers (organization_id, name, normalized_name)
select distinct on (organization_id, normalized)
  organization_id, name, normalized
from (
  select organization_id, btrim(counterparty_name) as name,
         public.normalize_party_name(counterparty_name) as normalized, created_at
  from public.finance_titles where direction = 'receivable'
) nomes
where normalized is not null
order by organization_id, normalized, created_at desc
on conflict (organization_id, normalized_name) do nothing;

update public.finance_titles t set customer_id = c.id
from public.customers c
where t.customer_id is null and t.direction = 'receivable' and c.organization_id = t.organization_id
  and c.normalized_name = public.normalize_party_name(t.counterparty_name);

-- Vínculo automático a cada gravação de título a receber. O gatilho de
-- fornecedor já cuida do 'payable' e ignora o resto; este faz o contrário.
create or replace function public.link_customer_from_text()
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
  if tg_table_name = 'finance_titles' and (to_jsonb(new) ->> 'direction') <> 'receivable' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    previous := to_jsonb(old) ->> col;
  end if;
  if tg_op = 'INSERT' or new.customer_id is null
     or public.normalize_party_name(raw) is distinct from public.normalize_party_name(previous) then
    new.customer_id := public.resolve_customer(new.organization_id, raw);
  end if;
  return new;
end;
$$;

revoke all on function public.link_customer_from_text() from public;

drop trigger if exists finance_titles_link_customer on public.finance_titles;
create trigger finance_titles_link_customer before insert or update of counterparty_name on public.finance_titles
for each row execute function public.link_customer_from_text('counterparty_name');

-- Unificar duplicados: move os vínculos para o principal e guarda o apelido.
create or replace function public.merge_customers(keep_id uuid, drop_id uuid)
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
    raise exception 'Sem permissão para unificar clientes.' using errcode = '42501';
  end if;
  if keep_id = drop_id then
    raise exception 'Escolha dois clientes diferentes.';
  end if;
  select name into keep_name from public.customers where id = keep_id and organization_id = org and merged_into is null;
  select name into drop_name from public.customers where id = drop_id and organization_id = org and merged_into is null;
  if keep_name is null or drop_name is null then
    raise exception 'Cliente não encontrado.';
  end if;

  update public.finance_titles set customer_id = keep_id where customer_id = drop_id;
  update public.party_emails set customer_id = keep_id where customer_id = drop_id;
  update public.customers set merged_into = keep_id where merged_into = drop_id;
  update public.customers set merged_into = keep_id, active = false where id = drop_id;

  perform public.emit_module_event(org, 'cadastros', 'cadastros.cliente.unificado', 'cliente', keep_id::text,
    format('Clientes unificados · "%s" agora é "%s"', drop_name, keep_name),
    jsonb_build_object('mantido', keep_id, 'unificado', drop_id));
end;
$$;

revoke all on function public.merge_customers(uuid, uuid) from public;
grant execute on function public.merge_customers(uuid, uuid) to authenticated;

create or replace function public.events_cadastros_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_module_event(new.organization_id, 'cadastros', 'cadastros.cliente.criado', 'cliente', new.id::text,
    format('Cliente cadastrado · %s', new.name), jsonb_build_object('tax_id', new.tax_id));
  return new;
end;
$$;

revoke all on function public.events_cadastros_cliente() from public;

drop trigger if exists customers_events on public.customers;
create trigger customers_events after insert on public.customers
for each row execute function public.events_cadastros_cliente();

-- RLS igual à dos fornecedores: todos da organização leem (Financeiro e CRM
-- precisam); editar é de quem tem Fundação › Cadastros (operar).
alter table public.customers enable row level security;
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated
using (organization_id = public.current_organization_id());
drop policy if exists customers_manage on public.customers;
create policy customers_manage on public.customers for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('fundacao.cadastros', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('fundacao.cadastros', 'operar'));

-- --- E-mails conhecidos -----------------------------------------------------
-- Um e-mail pertence a um cliente OU a um fornecedor, nunca aos dois.
create table if not exists public.party_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  customer_id uuid references public.customers(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email),
  constraint party_emails_email_lower check (email = lower(btrim(email))),
  constraint party_emails_email_forma check (email like '%_@_%._%'),
  constraint party_emails_um_dono check (num_nonnulls(customer_id, supplier_id) = 1)
);

create index if not exists idx_party_emails_customer on public.party_emails(customer_id);
create index if not exists idx_party_emails_supplier on public.party_emails(supplier_id);

drop trigger if exists party_emails_updated_at on public.party_emails;
create trigger party_emails_updated_at before update on public.party_emails
for each row execute function public.set_updated_at();

alter table public.party_emails enable row level security;
drop policy if exists party_emails_read on public.party_emails;
create policy party_emails_read on public.party_emails for select to authenticated
using (organization_id = public.current_organization_id());
drop policy if exists party_emails_manage on public.party_emails;
create policy party_emails_manage on public.party_emails for all to authenticated
using (organization_id = public.current_organization_id()
  and (public.has_feature('fundacao.cadastros', 'operar') or public.has_feature('comercial.clientes', 'operar')))
with check (organization_id = public.current_organization_id()
  and (public.has_feature('fundacao.cadastros', 'operar') or public.has_feature('comercial.clientes', 'operar')));

-- Uso de cada cliente, para a tela de Cadastros. Security definer: quem cuida
-- dos cadastros vê as contagens sem precisar de acesso ao Financeiro.
create or replace function public.customer_usage()
returns table (customer_id uuid, titulos bigint, emails bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
    (select count(*) from public.finance_titles t where t.customer_id = c.id),
    (select count(*) from public.party_emails e where e.customer_id = c.id)
  from public.customers c
  where c.organization_id = public.current_organization_id()
    and public.has_feature('fundacao.cadastros');
$$;

revoke all on function public.customer_usage() from public;
grant execute on function public.customer_usage() to authenticated;

-- --- Funcionalidades do CRM no catálogo de acesso ---------------------------
-- O departamento Comercial tem duas áreas: CRM (aqui) e Compras (que mantém
-- os códigos `compras.*` de sempre — nada é renomeado).
insert into public.access_features (code, module_code, label, levels, sort) values
  ('comercial.caixa',    'comercial', 'Caixa de entrada', '{ver,operar}',        10),
  ('comercial.funil',    'comercial', 'Funil',            '{ver,operar}',        20),
  ('comercial.clientes', 'comercial', 'Clientes',         '{ver,operar}',        30),
  ('comercial.cobranca', 'comercial', 'Cobrança',         '{ver,operar,aprovar}', 40),
  ('comercial.conexao',  'comercial', 'Conexão de e-mail', '{ver}',              50)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;
