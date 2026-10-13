-- Comercial › Vendas: produtos, orçamentos e entrada de produção (13/10/2026).
-- Plano: docs/PLANO-ORCAMENTO.md (etapas E1, E2 e a entrada de produção da E3).
--
-- O que o Rafael faz hoje no GRV: cadastra o produto (código interno, NCM, desenho), monta o
-- orçamento com os itens, anexa o pedido do cliente e a cotação, anota as mudanças e, ganho o
-- pedido, dá a entrada de produção do que ficou pronto. O Jefferson fatura a partir disso.
--
-- Regras:
--   · ganho exige item, pedido de compra do cliente e os dois anexos (pedido e cotação) — regra
--     do Jefferson; ganho gera a previsão a receber (decisão O4);
--   · item de orçamento ganho não muda (para mudar, reabre — só sem produção lançada);
--   · entrada de produção só em orçamento ganho e nunca acima do pedido;
--   · a situação muda só pelas funções (com as regras), nunca direto na tabela.

-- --- Funcionalidades --------------------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('comercial.orcamentos', 'comercial', 'Orçamentos', '{ver,operar}', 25),
  ('comercial.produtos', 'comercial', 'Produtos', '{ver,operar}', 26),
  ('producao.entrada', 'producao', 'Entrada de produção', '{ver,operar}', 25)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- Quem enxerga produto e orçamento: quem cuida deles, quem dá entrada de produção e quem fatura.
create or replace function public.vendas_pode_ver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('comercial.orcamentos', 'ver') or public.has_feature('comercial.produtos', 'ver')
      or public.has_feature('producao.entrada', 'ver') or public.has_feature('fiscal.nfe', 'ver');
$$;
revoke all on function public.vendas_pode_ver() from public, anon;
grant execute on function public.vendas_pode_ver() to authenticated;

-- --- Produtos (o "material" do GRV) ------------------------------------------------------------
-- Grupo: dá o código interno no formato do GRV ({prefixo}-{grupo}-{sequência}, ex.: 5-24-00040).
create table if not exists public.product_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null check (codigo ~ '^[0-9A-Z]{1,6}$'),
  nome text not null check (length(btrim(nome)) between 1 and 60),
  prefixo text not null default '5' check (prefixo ~ '^[0-9A-Z]{1,6}$'),
  proximo int not null default 1 check (proximo between 1 and 99999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, codigo)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null check (codigo ~ '^[0-9A-Za-z][0-9A-Za-z.\-/]{0,29}$'),
  descricao text not null check (length(btrim(descricao)) between 1 and 120),
  group_id uuid references public.product_groups(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  -- Tipo de peça (o mesmo da Forja): abre a OS do artigo certo.
  tipo_peca text check (tipo_peca is null or tipo_peca in ('forma', 'bloco', 'fundo_forma', 'fundo_bloco', 'molde', 'arruela', 'cabeca_sopro', 'forminha', 'puncao', 'funil', 'outro')),
  unidade text not null default 'PC' check (unidade ~ '^[A-Z0-9]{1,6}$'),
  ncm text check (ncm is null or ncm ~ '^\d{8}$'),
  origem smallint not null default 0 check (origem between 0 and 8),
  material text check (material is null or length(material) <= 60),
  desenho_codigo text check (desenho_codigo is null or length(desenho_codigo) <= 60),
  desenho_revisao text check (desenho_revisao is null or length(desenho_revisao) <= 20),
  -- Como o cliente chama a peça (alguns trabalham em inglês ou com o código deles).
  nome_cliente text check (nome_cliente is null or length(nome_cliente) <= 120),
  peso_liquido numeric(12,3) check (peso_liquido is null or peso_liquido >= 0),
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  ativo boolean not null default true,
  cloned_from uuid references public.products(id) on delete set null,
  forja_artigo_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, codigo)
);
create index if not exists idx_products_busca on public.products (organization_id, ativo, descricao);
create index if not exists idx_products_cliente on public.products (organization_id, customer_id);

-- Próximo código interno do grupo (pula código que já exista, ex.: importado do GRV).
create or replace function public.product_proximo_codigo(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.product_groups%rowtype;
  v_codigo text;
begin
  if not public.has_feature('comercial.produtos', 'operar') then
    raise exception 'Sem permissão para cadastrar produtos.' using errcode = '42501';
  end if;
  select * into g from public.product_groups where id = p_group and organization_id = public.current_organization_id() for update;
  if g.id is null then raise exception 'Grupo não encontrado.'; end if;
  loop
    v_codigo := format('%s-%s-%s', g.prefixo, g.codigo, lpad(g.proximo::text, 5, '0'));
    g.proximo := g.proximo + 1;
    exit when not exists (select 1 from public.products p where p.organization_id = g.organization_id and p.codigo = v_codigo);
  end loop;
  update public.product_groups set proximo = g.proximo, updated_at = now() where id = g.id;
  return v_codigo;
end;
$$;
revoke all on function public.product_proximo_codigo(uuid) from public, anon;
grant execute on function public.product_proximo_codigo(uuid) to authenticated;

-- --- Orçamentos ---------------------------------------------------------------------------------
create table if not exists public.sales_quote_numbering (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  proximo bigint not null default 1 check (proximo between 1 and 999999999),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero bigint not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contato text check (contato is null or length(contato) <= 120),
  crm_card_id uuid references public.crm_cards(id) on delete set null,
  data_orcamento date not null default current_date,
  validade date,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'enviado', 'ganho', 'perdido', 'cancelado')),
  -- Pedido de compra do cliente: a nota segue ele (regra do Jefferson).
  pedido_cliente text check (pedido_cliente is null or length(pedido_cliente) <= 60),
  condicao_pagamento text check (condicao_pagamento is null or length(condicao_pagamento) <= 120),
  frete_modalidade smallint not null default 9 check (frete_modalidade in (0, 1, 2, 9)),
  prazo_entrega date,
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  motivo_perda text check (motivo_perda is null or length(motivo_perda) <= 500),
  ganho_em timestamptz,
  ganho_por_nome text,
  cloned_from uuid references public.sales_quotes(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, numero),
  check ((situacao = 'perdido') = (motivo_perda is not null)),
  check ((situacao = 'ganho') = (ganho_em is not null))
);
create index if not exists idx_sales_quotes_lista on public.sales_quotes (organization_id, situacao, data_orcamento desc);
create index if not exists idx_sales_quotes_cliente on public.sales_quotes (organization_id, customer_id);

create table if not exists public.sales_quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  ordem int not null default 1,
  product_id uuid not null references public.products(id) on delete restrict,
  descricao text not null check (length(btrim(descricao)) between 1 and 120),
  desenho text check (desenho is null or length(desenho) <= 80),
  unidade text not null default 'PC' check (unidade ~ '^[A-Z0-9]{1,6}$'),
  quantidade numeric(14,4) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null default 0 check (preco_unitario >= 0),
  prazo_entrega date,
  -- Nº do item no pedido de compra do cliente (ex.: "060"): vai para a nota.
  item_pedido text check (item_pedido is null or length(item_pedido) <= 20),
  observacao text check (observacao is null or length(observacao) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sales_quote_items on public.sales_quote_items (quote_id, ordem);
create index if not exists idx_sales_quote_items_produto on public.sales_quote_items (organization_id, product_id);

-- Anotações (ex.: "o fundo teve desconto de 890 para 830"): só se acrescenta, nunca se apaga.
create table if not exists public.sales_quote_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  texto text not null check (length(btrim(texto)) between 1 and 2000),
  autor_profile_id uuid references public.profiles(id) on delete set null,
  autor_nome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_quote_notes on public.sales_quote_notes (quote_id, created_at);

-- Anexos: o pedido do cliente e a cotação enviada (obrigatórios para ganhar), e outros.
create table if not exists public.sales_quote_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  document_id uuid not null references public.company_documents(id) on delete cascade,
  tipo text not null check (tipo in ('pedido', 'cotacao', 'outro')),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (quote_id, document_id)
);

-- Número do orçamento: atômico, continuando o do GRV (próximo número definido na virada).
create or replace function public.sales_quotes_numerar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sales_quote_numbering (organization_id, proximo) values (new.organization_id, 2)
  on conflict (organization_id) do update set proximo = public.sales_quote_numbering.proximo + 1, updated_at = now()
  returning proximo - 1 into new.numero;
  while exists (select 1 from public.sales_quotes where organization_id = new.organization_id and numero = new.numero) loop
    update public.sales_quote_numbering set proximo = proximo + 1 where organization_id = new.organization_id returning proximo - 1 into new.numero;
  end loop;
  return new;
end;
$$;
drop trigger if exists sales_quotes_numero on public.sales_quotes;
create trigger sales_quotes_numero before insert on public.sales_quotes
for each row when (new.numero is null) execute function public.sales_quotes_numerar();

-- Situação, ganho e motivo da perda só mudam pelas funções (que conferem as regras).
create or replace function public.sales_quotes_protege()
returns trigger
language plpgsql
as $$
begin
  if current_setting('pecsil.orcamento_situacao', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      if new.situacao <> 'rascunho' or new.ganho_em is not null or new.motivo_perda is not null then
        raise exception 'Orçamento novo começa como rascunho.' using errcode = '42501';
      end if;
    elsif new.situacao is distinct from old.situacao or new.ganho_em is distinct from old.ganho_em
       or new.motivo_perda is distinct from old.motivo_perda or new.numero is distinct from old.numero then
      raise exception 'A situação do orçamento muda pelos botões (ganho, perdido, reabrir).' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.situacao in ('ganho', 'perdido', 'cancelado')
       and (new.customer_id is distinct from old.customer_id or new.pedido_cliente is distinct from old.pedido_cliente) then
      raise exception 'Orçamento fechado: reabra para mudar cliente ou pedido.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists sales_quotes_protecao on public.sales_quotes;
create trigger sales_quotes_protecao before insert or update on public.sales_quotes
for each row execute function public.sales_quotes_protege();

-- Itens de orçamento fechado não mudam.
create or replace function public.sales_quote_items_protege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sit text;
begin
  select situacao into sit from public.sales_quotes where id = coalesce(new.quote_id, old.quote_id);
  if sit in ('ganho', 'perdido', 'cancelado') and current_setting('pecsil.orcamento_situacao', true) is distinct from 'on' then
    raise exception 'Orçamento %: reabra para mudar os itens.', case sit when 'ganho' then 'ganho' when 'perdido' then 'perdido' else 'cancelado' end using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists sales_quote_items_protecao on public.sales_quote_items;
create trigger sales_quote_items_protecao before insert or update or delete on public.sales_quote_items
for each row execute function public.sales_quote_items_protege();

-- --- Entrada de produção (Rafael; decisão O3: manual) ------------------------------------------
create table if not exists public.production_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_item_id uuid not null references public.sales_quote_items(id) on delete restrict,
  quantidade numeric(14,4) not null check (quantidade > 0),
  data date not null default current_date,
  observacao text check (observacao is null or length(observacao) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_production_entries_item on public.production_entries (quote_item_id);

-- --- RLS ----------------------------------------------------------------------------------------
alter table public.product_groups enable row level security;
alter table public.products enable row level security;
alter table public.sales_quote_numbering enable row level security;
alter table public.sales_quotes enable row level security;
alter table public.sales_quote_items enable row level security;
alter table public.sales_quote_notes enable row level security;
alter table public.sales_quote_attachments enable row level security;
alter table public.production_entries enable row level security;

drop policy if exists product_groups_read on public.product_groups;
create policy product_groups_read on public.product_groups for select using (organization_id = (select public.current_organization_id()) and (select public.vendas_pode_ver()));
drop policy if exists product_groups_write on public.product_groups;
create policy product_groups_write on public.product_groups for all
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.produtos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.produtos', 'operar')));

drop policy if exists products_read on public.products;
create policy products_read on public.products for select using (organization_id = (select public.current_organization_id()) and (select public.vendas_pode_ver()));
drop policy if exists products_insert on public.products;
create policy products_insert on public.products for insert with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.produtos', 'operar')));
drop policy if exists products_update on public.products;
create policy products_update on public.products for update
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.produtos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.produtos', 'operar')));
drop policy if exists products_delete on public.products;
create policy products_delete on public.products for delete using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.produtos', 'operar')));

-- Numeração: só lida por quem vê orçamentos; muda pelo gatilho (security definer) e pela função do proprietário.
drop policy if exists sales_quote_numbering_read on public.sales_quote_numbering;
create policy sales_quote_numbering_read on public.sales_quote_numbering for select using (organization_id = (select public.current_organization_id()) and (select public.vendas_pode_ver()));

-- Orçamentos: quem cuida deles, quem dá entrada de produção e quem fatura (fiscal.nfe) leem.
create or replace function public.orcamentos_pode_ver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('comercial.orcamentos', 'ver') or public.has_feature('producao.entrada', 'ver') or public.has_feature('fiscal.nfe', 'ver');
$$;
revoke all on function public.orcamentos_pode_ver() from public, anon;
grant execute on function public.orcamentos_pode_ver() to authenticated;

drop policy if exists sales_quotes_read on public.sales_quotes;
create policy sales_quotes_read on public.sales_quotes for select using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists sales_quotes_insert on public.sales_quotes;
create policy sales_quotes_insert on public.sales_quotes for insert with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')));
drop policy if exists sales_quotes_update on public.sales_quotes;
create policy sales_quotes_update on public.sales_quotes for update
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')));
drop policy if exists sales_quotes_delete on public.sales_quotes;
create policy sales_quotes_delete on public.sales_quotes for delete
  using (organization_id = (select public.current_organization_id()) and situacao = 'rascunho' and (select public.has_feature('comercial.orcamentos', 'operar')));

drop policy if exists sales_quote_items_read on public.sales_quote_items;
create policy sales_quote_items_read on public.sales_quote_items for select using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists sales_quote_items_write on public.sales_quote_items;
create policy sales_quote_items_write on public.sales_quote_items for all
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar'))
    and exists (select 1 from public.sales_quotes q where q.id = quote_id and q.organization_id = sales_quote_items.organization_id));

drop policy if exists sales_quote_notes_read on public.sales_quote_notes;
create policy sales_quote_notes_read on public.sales_quote_notes for select using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists sales_quote_notes_insert on public.sales_quote_notes;
create policy sales_quote_notes_insert on public.sales_quote_notes for insert
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar'))
    and autor_profile_id = (select public.current_profile_id())
    and exists (select 1 from public.sales_quotes q where q.id = quote_id and q.organization_id = sales_quote_notes.organization_id));

drop policy if exists sales_quote_attachments_read on public.sales_quote_attachments;
create policy sales_quote_attachments_read on public.sales_quote_attachments for select using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists sales_quote_attachments_insert on public.sales_quote_attachments;
create policy sales_quote_attachments_insert on public.sales_quote_attachments for insert
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar'))
    and exists (select 1 from public.sales_quotes q where q.id = quote_id and q.organization_id = sales_quote_attachments.organization_id and q.situacao in ('rascunho', 'enviado'))
    and exists (select 1 from public.company_documents d where d.id = document_id and d.organization_id = sales_quote_attachments.organization_id and d.feature_code = 'comercial.orcamentos'));
drop policy if exists sales_quote_attachments_delete on public.sales_quote_attachments;
create policy sales_quote_attachments_delete on public.sales_quote_attachments for delete
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar'))
    and exists (select 1 from public.sales_quotes q where q.id = quote_id and q.situacao in ('rascunho', 'enviado')));

drop policy if exists production_entries_read on public.production_entries;
create policy production_entries_read on public.production_entries for select using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
-- Entrada de produção só pelas funções (conferem o teto do pedido).
revoke insert, update, delete on public.production_entries, public.sales_quote_numbering from anon, authenticated;

-- --- Situação do orçamento ------------------------------------------------------------------------
-- p_situacao: enviado, ganho, perdido (com motivo), cancelado, rascunho (reabrir).
create or replace function public.comercial_orcamento_situacao(p_quote uuid, p_situacao text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.sales_quotes%rowtype;
  autor text;
  total numeric(18,2);
  vence date;
  dias int;
  conta uuid;
  previsao uuid;
  estagio uuid;
  cliente text;
  faltam text[] := '{}';
begin
  if not public.has_feature('comercial.orcamentos', 'operar') then
    raise exception 'Sem permissão para mudar orçamentos.' using errcode = '42501';
  end if;
  select * into q from public.sales_quotes where id = p_quote and organization_id = public.current_organization_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado.'; end if;
  select coalesce(full_name, email) into autor from public.profiles where id = public.current_profile_id();
  select name into cliente from public.customers where id = q.customer_id;
  perform set_config('pecsil.orcamento_situacao', 'on', true);

  if p_situacao = 'enviado' then
    if q.situacao <> 'rascunho' then raise exception 'Só rascunho é marcado como enviado.'; end if;
    update public.sales_quotes set situacao = 'enviado' where id = q.id;

  elsif p_situacao = 'ganho' then
    if q.situacao not in ('rascunho', 'enviado') then raise exception 'Este orçamento não está em aberto.'; end if;
    if not exists (select 1 from public.sales_quote_items where quote_id = q.id) then faltam := faltam || 'itens'::text; end if;
    if btrim(coalesce(q.pedido_cliente, '')) = '' then faltam := faltam || 'o nº do pedido de compra do cliente'::text; end if;
    if not exists (select 1 from public.sales_quote_attachments where quote_id = q.id and tipo = 'pedido') then faltam := faltam || 'o anexo do pedido do cliente'::text; end if;
    if not exists (select 1 from public.sales_quote_attachments where quote_id = q.id and tipo = 'cotacao') then faltam := faltam || 'o anexo da cotação enviada'::text; end if;
    if cardinality(faltam) > 0 then
      raise exception 'Para marcar como ganho, falta: %.', array_to_string(faltam, ', ');
    end if;
    update public.sales_quotes set situacao = 'ganho', ganho_em = now(), ganho_por_nome = autor where id = q.id;

    -- Previsão a receber (decisão O4): o total do pedido, até as notas chegarem.
    select round(coalesce(sum(quantidade * preco_unitario), 0), 2) into total from public.sales_quote_items where quote_id = q.id;
    if total > 0 then
      dias := nullif(substring(coalesce(q.condicao_pagamento, '') from '\d+'), '')::int;
      vence := coalesce(q.prazo_entrega, current_date) + coalesce(dias, 30);
      -- Conta do plano: a mesma do último título a receber do cliente; sem histórico, o Financeiro escolhe.
      select chart_account_id into conta from public.finance_titles
       where organization_id = q.organization_id and direction = 'receivable' and customer_id = q.customer_id and chart_account_id is not null
       order by created_at desc limit 1;
      insert into public.finance_titles (
        organization_id, direction, counterparty_name, customer_id, document_number, description, notes, issue_date, competence_date,
        original_amount, chart_account_id, status, approved_at, source_module, source_entity_id, is_forecast, needs_review, review_reason
      ) values (
        q.organization_id, 'receivable', cliente, q.customer_id, q.pedido_cliente,
        format('Orçamento #%s · pedido %s (previsão até as notas)', q.numero, q.pedido_cliente),
        'Gerada quando o orçamento foi ganho. As notas emitidas viram as contas a receber de verdade.',
        current_date, current_date, total, conta, 'approved', now(), 'comercial', q.id, true, conta is null,
        case when conta is null then 'Conta do plano a definir: cliente sem histórico' end
      ) returning id into previsao;
      insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
      values (q.organization_id, previsao, 1, vence, total, 0, 'pending');
      if conta is not null then
        insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount) values (q.organization_id, previsao, conta, total);
      end if;
    end if;

    -- Card do funil anda junto.
    if q.crm_card_id is not null then
      select id into estagio from public.crm_stages where organization_id = q.organization_id and code = 'ganho';
      if estagio is not null then update public.crm_cards set stage_id = estagio, updated_at = now() where id = q.crm_card_id and status = 'aberto'; end if;
    end if;
    perform public.emit_module_event(q.organization_id, 'comercial', 'comercial.orcamento.ganho', 'orcamento', q.id::text,
      format('Orçamento #%s ganho · %s · pedido %s', q.numero, cliente, q.pedido_cliente),
      jsonb_build_object('total', total, 'pedido', q.pedido_cliente));
    perform public.notify_feature(q.organization_id, 'producao.entrada', 'operar', 'producao', 'info',
      format('Orçamento #%s ganho · %s', q.numero, cliente),
      format('Pedido %s aprovado (R$ %s). Lance a entrada de produção quando as peças ficarem prontas.', q.pedido_cliente, public.brl(total)),
      '/?module=producao&secao=Entrada%20de%20produção', public.current_profile_id());

  elsif p_situacao = 'perdido' then
    if q.situacao not in ('rascunho', 'enviado') then raise exception 'Este orçamento não está em aberto.'; end if;
    if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga por que o orçamento foi perdido.'; end if;
    update public.sales_quotes set situacao = 'perdido', motivo_perda = left(btrim(p_motivo), 500) where id = q.id;
    if q.crm_card_id is not null then
      select id into estagio from public.crm_stages where organization_id = q.organization_id and code = 'perdido';
      if estagio is not null then update public.crm_cards set stage_id = estagio, lost_reason = left(btrim(p_motivo), 500), updated_at = now() where id = q.crm_card_id and status = 'aberto'; end if;
    end if;
    perform public.emit_module_event(q.organization_id, 'comercial', 'comercial.orcamento.perdido', 'orcamento', q.id::text,
      format('Orçamento #%s perdido · %s', q.numero, cliente), jsonb_build_object('motivo', left(btrim(p_motivo), 500)));

  elsif p_situacao in ('rascunho', 'cancelado') then
    -- Reabrir (ganho → rascunho) ou cancelar: só sem produção lançada. A previsão a receber é cancelada.
    if p_situacao = 'rascunho' and q.situacao not in ('ganho', 'perdido', 'enviado') then raise exception 'Nada a reabrir.'; end if;
    if p_situacao = 'cancelado' and q.situacao = 'cancelado' then raise exception 'Já está cancelado.'; end if;
    if exists (select 1 from public.production_entries e join public.sales_quote_items i on i.id = e.quote_item_id where i.quote_id = q.id) then
      raise exception 'Já há entrada de produção neste orçamento: estorne as entradas antes.';
    end if;
    update public.finance_titles set status = 'cancelled', cancelled_at = now(), updated_at = now()
     where organization_id = q.organization_id and source_module = 'comercial' and source_entity_id = q.id and is_forecast and status <> 'cancelled';
    update public.sales_quotes set situacao = p_situacao, ganho_em = null, ganho_por_nome = null, motivo_perda = null where id = q.id;
  else
    raise exception 'Situação desconhecida.';
  end if;

  insert into public.sales_quote_notes (organization_id, quote_id, texto, autor_profile_id, autor_nome)
  values (q.organization_id, q.id, format('Situação: %s → %s%s', q.situacao, p_situacao, coalesce(' (' || nullif(btrim(p_motivo), '') || ')', '')), public.current_profile_id(), autor);
  -- A liberação vale só para esta função, não para o resto da transação.
  perform set_config('pecsil.orcamento_situacao', 'off', true);
  return jsonb_build_object('situacao', p_situacao);
end;
$$;
revoke all on function public.comercial_orcamento_situacao(uuid, text, text) from public, anon;
grant execute on function public.comercial_orcamento_situacao(uuid, text, text) to authenticated;

-- Próximo número do orçamento (para continuar o GRV): só o proprietário.
create or replace function public.comercial_orcamento_definir_proximo(p_numero bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'Só o proprietário define a numeração.' using errcode = '42501'; end if;
  if p_numero < 1 or exists (select 1 from public.sales_quotes where organization_id = public.current_organization_id() and numero >= p_numero) then
    raise exception 'Use um número maior que o do último orçamento.';
  end if;
  insert into public.sales_quote_numbering (organization_id, proximo) values (public.current_organization_id(), p_numero)
  on conflict (organization_id) do update set proximo = p_numero, updated_at = now();
end;
$$;
revoke all on function public.comercial_orcamento_definir_proximo(bigint) from public, anon;
grant execute on function public.comercial_orcamento_definir_proximo(bigint) to authenticated;

-- --- Entrada de produção ------------------------------------------------------------------------
create or replace function public.producao_entrada_registrar(p_item uuid, p_quantidade numeric, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.sales_quote_items%rowtype;
  q public.sales_quotes%rowtype;
  produzido numeric;
  novo uuid;
  autor text;
begin
  if not public.has_feature('producao.entrada', 'operar') then
    raise exception 'Sem permissão para lançar entrada de produção.' using errcode = '42501';
  end if;
  select * into i from public.sales_quote_items where id = p_item and organization_id = public.current_organization_id() for update;
  if i.id is null then raise exception 'Item não encontrado.'; end if;
  select * into q from public.sales_quotes where id = i.quote_id;
  if q.situacao <> 'ganho' then raise exception 'Entrada de produção só em orçamento ganho.'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe a quantidade produzida.'; end if;
  select coalesce(sum(quantidade), 0) into produzido from public.production_entries where quote_item_id = i.id;
  if produzido + p_quantidade > i.quantidade then
    raise exception 'Passa do pedido: % de % já produzidas; cabem mais %.', trim_scale(produzido), trim_scale(i.quantidade), trim_scale(i.quantidade - produzido);
  end if;
  select coalesce(full_name, email) into autor from public.profiles where id = public.current_profile_id();
  insert into public.production_entries (organization_id, quote_item_id, quantidade, observacao, created_by, created_by_name)
  values (i.organization_id, i.id, p_quantidade, nullif(left(btrim(coalesce(p_observacao, '')), 500), ''), public.current_profile_id(), autor)
  returning id into novo;
  perform public.emit_module_event(i.organization_id, 'producao', 'producao.entrada.registrada', 'orcamento_item', i.id::text,
    format('Entrada de produção · %s peças de %s (orçamento #%s)', trim_scale(p_quantidade), i.descricao, q.numero),
    jsonb_build_object('quantidade', p_quantidade, 'orcamento', q.numero));
  perform public.notify_feature(i.organization_id, 'fiscal.nfe', 'operar', 'fiscal', 'info',
    format('Peças prontas para faturar · orçamento #%s', q.numero),
    format('%s × %s (pedido %s).', trim_scale(p_quantidade), i.descricao, q.pedido_cliente),
    '/?module=fiscal&secao=A%20faturar', public.current_profile_id());
  return novo;
end;
$$;
revoke all on function public.producao_entrada_registrar(uuid, numeric, text) from public, anon;
grant execute on function public.producao_entrada_registrar(uuid, numeric, text) to authenticated;

-- Estornar uma entrada lançada por engano. A migração do faturamento acrescenta a regra
-- "não estorna o que já foi faturado".
create or replace function public.producao_entrada_estornar(p_entrada uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.production_entries%rowtype;
begin
  if not public.has_feature('producao.entrada', 'operar') then
    raise exception 'Sem permissão para estornar entrada de produção.' using errcode = '42501';
  end if;
  select * into e from public.production_entries where id = p_entrada and organization_id = public.current_organization_id() for update;
  if e.id is null then raise exception 'Entrada não encontrada.'; end if;
  perform 1 from public.sales_quote_items where id = e.quote_item_id for update;
  delete from public.production_entries where id = e.id;
end;
$$;
revoke all on function public.producao_entrada_estornar(uuid) from public, anon;
grant execute on function public.producao_entrada_estornar(uuid) to authenticated;
