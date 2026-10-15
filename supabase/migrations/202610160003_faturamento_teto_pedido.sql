-- ============================================================================
-- Faturamento: o teto é só o pedido (16/10/2026, decisão do proprietário)
-- ============================================================================
-- Antes, a nota só faturava o que já tinha entrada de produção ("sem produção" travava o A faturar).
-- Agora fatura em quantas notas for preciso até o total do pedido ganho (pedido 50, já faturadas 48:
-- cabem 2), com ou sem entrada de produção; o produzido fica só como informação. O teto continua no
-- banco e conta toda nota não cancelada (inclusive rascunho), então duas notas abertas ao mesmo tempo
-- também não estouram o pedido.
--
-- As notas do orçamento passam a trazer o preço praticado, o valor da nota e se já há DANFE.
-- ============================================================================

-- A faturar: disponível = o que falta do pedido (não mais o produzido).
create or replace function public.fiscal_a_faturar(p_ambiente text default 'producao')
returns table(quote_id uuid, numero bigint, cliente_id uuid, cliente text, pedido_cliente text, item_id uuid, ordem integer, product_id uuid, codigo text,
  descricao text, unidade text, preco_unitario numeric, item_pedido text, pedido numeric, produzido numeric, faturado numeric, disponivel numeric, falta numeric)
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
    where q.organization_id = public.current_organization_id() and q.situacao = 'ganho' and q.treino = (p_ambiente = 'treino')
  )
  select q_id, q_numero, q_cliente_id, q_cliente, q_pedido, i_id, i_ordem, i_produto, p_codigo, i_descricao, i_unidade, i_preco, i_item_pedido,
    i_qtd, prod, fat, greatest(i_qtd - fat, 0), greatest(i_qtd - fat, 0)
  from base
  where i_qtd - fat > 0
  order by q_numero, i_ordem;
end;
$$;

-- Origens da nota: teto só no pedido (a soma das notas não canceladas nunca passa do orçado).
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
  de_treino boolean;
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
    select situacao, treino into sit, de_treino from public.sales_quotes where id = i.quote_id;
    if sit <> 'ganho' then raise exception 'O orçamento de "%" não está ganho.', i.descricao; end if;
    if de_treino and n.ambiente <> 'treino' then raise exception '"%" é de um orçamento de treino: só nota de treino.', i.descricao; end if;
    if not de_treino and n.ambiente = 'treino' then raise exception '"%" é de um orçamento real: nota de treino só fatura orçamento de treino.', i.descricao; end if;
    if x.quantidade is null or x.quantidade <= 0 then raise exception 'Quantidade inválida em "%".', i.descricao; end if;
    faturado := public.faturamento_faturado(i.id, n.ambiente);
    if faturado + x.quantidade > i.quantidade then
      raise exception '"%": passa do pedido. Pedido %, já faturado %, cabem %.', i.descricao, trim_scale(i.quantidade), trim_scale(faturado), trim_scale(greatest(i.quantidade - faturado, 0));
    end if;
    insert into public.fiscal_nfe_origens (organization_id, nfe_id, quote_item_id, ambiente, quantidade)
    values (p_org, n.id, i.id, n.ambiente, x.quantidade);
  end loop;
end;
$$;

-- Estorno de entrada de produção: com o faturamento livre da produção, o estorno não depende mais
-- do que já foi faturado.
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
  delete from public.production_entries where id = e.id;
end;
$$;

-- Notas do orçamento, com o preço praticado (do item da nota ligado a este item do orçamento), o valor
-- da nota e se já há DANFE (nota autorizada).
drop function if exists public.comercial_orcamento_notas(uuid);
create function public.comercial_orcamento_notas(p_quote uuid)
returns table (item_id uuid, nfe_id uuid, ambiente text, situacao text, serie int, numero bigint, emissao timestamptz, quantidade numeric,
  valor_unitario numeric, valor_nota numeric, chave text, tem_danfe boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.orcamentos_pode_ver() then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return query
  select o.quote_item_id, n.id, n.ambiente, n.situacao, n.serie, n.numero, n.emissao, o.quantidade,
    coalesce((select (it ->> 'valorUnitario')::numeric from jsonb_array_elements(coalesce(n.nota -> 'itens', '[]'::jsonb)) it
               where it ->> 'itemOrcamento' = o.quote_item_id::text limit 1), i.preco_unitario),
    n.valor_total, n.chave, n.xml_autorizado is not null
  from public.fiscal_nfe_origens o
  join public.fiscal_nfe n on n.id = o.nfe_id
  join public.sales_quote_items i on i.id = o.quote_item_id
  where i.quote_id = p_quote and i.organization_id = public.current_organization_id()
  order by n.created_at;
end;
$$;
revoke all on function public.comercial_orcamento_notas(uuid) from public, anon;
grant execute on function public.comercial_orcamento_notas(uuid) to authenticated;
