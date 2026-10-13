-- Faturamento a partir do orçamento (13/10/2026, docs/PLANO-ORCAMENTO.md, etapa E4).
--
-- Regras do proprietário e do Jefferson:
--   · a nota segue o pedido de compra do orçamento; entrega em uma ou mais vezes, e a soma das
--     notas por item NUNCA passa do pedido;
--   · só se fatura o que já teve entrada de produção;
--   · nota cancelada devolve a quantidade (deixa de contar); rascunho descartado também;
--   · o orçamento mostra as notas que entregaram cada item.
-- Cada ambiente (treino, homologação, produção) tem o seu saldo: o treino segue a mesma regra,
-- mas nunca consome o saldo real (produção).

create table if not exists public.fiscal_nfe_origens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nfe_id uuid not null references public.fiscal_nfe(id) on delete cascade,
  quote_item_id uuid not null references public.sales_quote_items(id) on delete restrict,
  ambiente text not null check (ambiente in ('treino', 'homologacao', 'producao')),
  quantidade numeric(14,4) not null check (quantidade > 0),
  created_at timestamptz not null default now(),
  unique (nfe_id, quote_item_id)
);
create index if not exists idx_fiscal_nfe_origens_item on public.fiscal_nfe_origens (quote_item_id, ambiente);

alter table public.fiscal_nfe_origens enable row level security;
drop policy if exists fiscal_nfe_origens_read on public.fiscal_nfe_origens;
create policy fiscal_nfe_origens_read on public.fiscal_nfe_origens for select using (
  organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver())
);
revoke insert, update, delete on public.fiscal_nfe_origens from anon, authenticated;

-- Quanto do item já foi faturado no ambiente (notas não canceladas).
create or replace function public.faturamento_faturado(p_item uuid, p_ambiente text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(o.quantidade), 0)
  from public.fiscal_nfe_origens o join public.fiscal_nfe n on n.id = o.nfe_id
  where o.quote_item_id = p_item and o.ambiente = p_ambiente and n.situacao <> 'cancelada';
$$;
revoke all on function public.faturamento_faturado(uuid, text) from public, anon, authenticated;

-- Itens a faturar (o "assistente de faturamento"): orçamentos ganhos, item a item.
create or replace function public.fiscal_a_faturar(p_ambiente text default 'producao')
returns table (
  quote_id uuid, numero bigint, cliente_id uuid, cliente text, pedido_cliente text, item_id uuid, ordem int, product_id uuid,
  codigo text, descricao text, unidade text, preco_unitario numeric, item_pedido text,
  pedido numeric, produzido numeric, faturado numeric, disponivel numeric, falta numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_feature('fiscal.nfe', 'ver') or public.has_feature('comercial.orcamentos', 'ver') or public.has_feature('producao.entrada', 'ver')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if p_ambiente not in ('treino', 'homologacao', 'producao') then raise exception 'Ambiente inválido.'; end if;
  return query
  with base as (
    select q.id as q_id, q.numero as q_numero, q.customer_id as q_cliente_id, c.name as q_cliente, q.pedido_cliente as q_pedido, i.id as i_id, i.ordem as i_ordem,
      i.product_id as i_produto, p.codigo as p_codigo, i.descricao as i_descricao, i.unidade as i_unidade, i.preco_unitario as i_preco, i.item_pedido as i_item_pedido,
      i.quantidade as i_qtd,
      (select coalesce(sum(e.quantidade), 0) from public.production_entries e where e.quote_item_id = i.id) as prod,
      public.faturamento_faturado(i.id, p_ambiente) as fat
    from public.sales_quotes q
    join public.sales_quote_items i on i.quote_id = q.id
    join public.products p on p.id = i.product_id
    join public.customers c on c.id = q.customer_id
    where q.organization_id = public.current_organization_id() and q.situacao = 'ganho'
  )
  select q_id, q_numero, q_cliente_id, q_cliente, q_pedido, i_id, i_ordem, i_produto, p_codigo, i_descricao, i_unidade, i_preco, i_item_pedido,
    i_qtd, prod, fat, greatest(prod - fat, 0), greatest(i_qtd - fat, 0)
  from base
  where i_qtd - fat > 0
  order by q_numero, i_ordem;
end;
$$;
revoke all on function public.fiscal_a_faturar(text) from public, anon;
grant execute on function public.fiscal_a_faturar(text) to authenticated;

-- Define (substitui) os itens de orçamento que uma nota fatura, conferindo o teto com as linhas
-- travadas: duas notas ao mesmo tempo não passam juntas do pedido. Só o servidor chama, depois de
-- conferir a permissão da sessão. p_itens: [{"item": uuid, "quantidade": n}].
create or replace function public.fiscal_nfe_origens_definir(p_org uuid, p_nfe uuid, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.fiscal_nfe%rowtype;
  x record;
  i public.sales_quote_items%rowtype;
  sit text;
  produzido numeric;
  faturado numeric;
begin
  select * into n from public.fiscal_nfe where id = p_nfe and organization_id = p_org for update;
  if n.id is null then raise exception 'Nota não encontrada.'; end if;
  if n.situacao in ('autorizada', 'cancelada') then raise exception 'Nota já autorizada ou cancelada: os itens não mudam.'; end if;
  -- Trava os itens envolvidos sempre na mesma ordem (evita impasse entre duas notas).
  perform 1 from public.sales_quote_items
   where id in (select (e ->> 'item')::uuid from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e)
   order by id for update;
  delete from public.fiscal_nfe_origens where nfe_id = n.id;
  for x in
    select (e ->> 'item')::uuid as item, sum((e ->> 'quantidade')::numeric) as quantidade
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e group by 1
  loop
    select * into i from public.sales_quote_items where id = x.item and organization_id = p_org;
    if i.id is null then raise exception 'Item de orçamento não encontrado.'; end if;
    select situacao into sit from public.sales_quotes where id = i.quote_id;
    if sit <> 'ganho' then raise exception 'O orçamento de "%" não está ganho.', i.descricao; end if;
    if x.quantidade is null or x.quantidade <= 0 then raise exception 'Quantidade inválida em "%".', i.descricao; end if;
    select coalesce(sum(quantidade), 0) into produzido from public.production_entries where quote_item_id = i.id;
    faturado := public.faturamento_faturado(i.id, n.ambiente);
    if faturado + x.quantidade > i.quantidade then
      raise exception '"%": passa do pedido. Pedido %, já faturado %, cabem %.', i.descricao, trim_scale(i.quantidade), trim_scale(faturado), trim_scale(greatest(i.quantidade - faturado, 0));
    end if;
    if faturado + x.quantidade > produzido then
      raise exception '"%": só % produzidas e % já faturadas; disponível %.', i.descricao, trim_scale(produzido), trim_scale(faturado), trim_scale(greatest(produzido - faturado, 0));
    end if;
    insert into public.fiscal_nfe_origens (organization_id, nfe_id, quote_item_id, ambiente, quantidade)
    values (p_org, n.id, i.id, n.ambiente, x.quantidade);
  end loop;
end;
$$;
revoke all on function public.fiscal_nfe_origens_definir(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fiscal_nfe_origens_definir(uuid, uuid, jsonb) to service_role;

-- Notas de cada item do orçamento (para quem vê o orçamento, mesmo sem ver o Fiscal).
create or replace function public.comercial_orcamento_notas(p_quote uuid)
returns table (item_id uuid, nfe_id uuid, ambiente text, situacao text, serie int, numero bigint, emissao timestamptz, quantidade numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.orcamentos_pode_ver() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return query
  select o.quote_item_id, n.id, n.ambiente, n.situacao, n.serie, n.numero, n.emissao, o.quantidade
  from public.fiscal_nfe_origens o
  join public.fiscal_nfe n on n.id = o.nfe_id
  join public.sales_quote_items i on i.id = o.quote_item_id
  where i.quote_id = p_quote and i.organization_id = public.current_organization_id()
  order by n.created_at;
end;
$$;
revoke all on function public.comercial_orcamento_notas(uuid) from public, anon;
grant execute on function public.comercial_orcamento_notas(uuid) to authenticated;

-- Estorno de entrada de produção: não pode deixar nota de produção sem peça produzida.
create or replace function public.producao_entrada_estornar(p_entrada uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.production_entries%rowtype;
  produzido numeric;
begin
  if not public.has_feature('producao.entrada', 'operar') then
    raise exception 'Sem permissão para estornar entrada de produção.' using errcode = '42501';
  end if;
  select * into e from public.production_entries where id = p_entrada and organization_id = public.current_organization_id() for update;
  if e.id is null then raise exception 'Entrada não encontrada.'; end if;
  perform 1 from public.sales_quote_items where id = e.quote_item_id for update;
  select coalesce(sum(quantidade), 0) into produzido from public.production_entries where quote_item_id = e.quote_item_id;
  if public.faturamento_faturado(e.quote_item_id, 'producao') > produzido - e.quantidade then
    raise exception 'Essas peças já foram faturadas: o estorno deixaria a nota sem produção.';
  end if;
  delete from public.production_entries where id = e.id;
end;
$$;
revoke all on function public.producao_entrada_estornar(uuid) from public, anon;
grant execute on function public.producao_entrada_estornar(uuid) to authenticated;
