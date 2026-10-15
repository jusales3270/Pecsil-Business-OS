-- ============================================================================
-- Treino do orçamento ao faturamento (15/10/2026, pedido do proprietário)
-- ============================================================================
-- O Rafael monta orçamentos de treino (numeração própria, T-1, T-2…), dá o ganho e lança a entrada
-- de produção; o Jefferson fatura em "A faturar" no treino. Tudo com as mesmas regras do real, mas:
--   - o ganho não cria previsão a receber nem mexe no funil, e não entra na trilha de eventos;
--   - a auditoria não registra os registros de treino;
--   - os avisos saem marcados "TREINO";
--   - o "A faturar" do treino mostra só orçamentos de treino, e o real só os reais; nota real
--     nunca fatura orçamento de treino (e vice-versa) — o banco recusa;
--   - comercial_treino_apagar() remove tudo de treino quando a plataforma entrar em produção.
-- ============================================================================

alter table public.sales_quotes add column if not exists treino boolean not null default false;
alter table public.production_entries add column if not exists treino boolean not null default false;
alter table public.sales_quote_numbering add column if not exists proximo_treino bigint not null default 1 check (proximo_treino between 1 and 999999999);

-- Numeração: a do treino é separada (o T-1 não tira número do orçamento real).
alter table public.sales_quotes drop constraint if exists sales_quotes_organization_id_numero_key;
alter table public.sales_quotes drop constraint if exists sales_quotes_numero_unico;
alter table public.sales_quotes add constraint sales_quotes_numero_unico unique (organization_id, treino, numero);
create index if not exists idx_sales_quotes_treino on public.sales_quotes (organization_id, treino, situacao);

create or replace function public.sales_quotes_numerar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.treino then
    insert into public.sales_quote_numbering (organization_id, proximo_treino) values (new.organization_id, 2)
    on conflict (organization_id) do update set proximo_treino = public.sales_quote_numbering.proximo_treino + 1, updated_at = now()
    returning proximo_treino - 1 into new.numero;
    while exists (select 1 from public.sales_quotes where organization_id = new.organization_id and treino and numero = new.numero) loop
      update public.sales_quote_numbering set proximo_treino = proximo_treino + 1 where organization_id = new.organization_id returning proximo_treino - 1 into new.numero;
    end loop;
    return new;
  end if;
  insert into public.sales_quote_numbering (organization_id, proximo) values (new.organization_id, 2)
  on conflict (organization_id) do update set proximo = public.sales_quote_numbering.proximo + 1, updated_at = now()
  returning proximo - 1 into new.numero;
  while exists (select 1 from public.sales_quotes where organization_id = new.organization_id and not treino and numero = new.numero) loop
    update public.sales_quote_numbering set proximo = proximo + 1 where organization_id = new.organization_id returning proximo - 1 into new.numero;
  end loop;
  return new;
end;
$$;

-- Treino ou real é decidido na criação e não muda depois.
create or replace function public.sales_quotes_protege()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.treino is distinct from old.treino then
    raise exception 'Orçamento de treino não vira real (nem o contrário).' using errcode = '42501';
  end if;
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

-- Auditoria: registro de treino não entra na trilha (é apagado quando a plataforma entrar em produção).
create or replace function public.audit_mudanca()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  antes jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  depois jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  linha jsonb := coalesce(depois, antes);
  mudou jsonb := '{}'::jsonb;
  k text;
  corta constant int := 200;
begin
  if (linha ->> 'treino') = 'true' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(depois) loop
      continue when k in ('updated_at', 'created_at', 'synced_at', 'normalized_name');
      if (antes -> k) is distinct from (depois -> k) then
        mudou := mudou || jsonb_build_object(k, jsonb_build_array(left(antes ->> k, corta), left(depois ->> k, corta)));
      end if;
    end loop;
    if mudou = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (
    nullif(linha ->> 'organization_id', '')::uuid, auth.uid(), public.current_profile_id(), coalesce(tg_argv[0], 'core'),
    tg_table_name || '.' || lower(tg_op), tg_table_name, nullif(linha ->> 'id', '')::uuid,
    coalesce(tg_argv[1], 'normal'),
    jsonb_build_object('operation', tg_op)
      || case when tg_op = 'UPDATE' then jsonb_build_object('mudou', mudou) else '{}'::jsonb end
      || case when linha ? 'numero' then jsonb_build_object('numero', linha -> 'numero') else '{}'::jsonb end
      || case when linha ? 'codigo' then jsonb_build_object('codigo', linha -> 'codigo') else '{}'::jsonb end
      || case when linha ? 'descricao' then jsonb_build_object('descricao', left(linha ->> 'descricao', 120)) else '{}'::jsonb end
      || case when linha ? 'name' then jsonb_build_object('nome', left(linha ->> 'name', 120)) else '{}'::jsonb end
      || case when linha ? 'quantidade' then jsonb_build_object('quantidade', linha -> 'quantidade') else '{}'::jsonb end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Situação do orçamento: no treino, sem previsão a receber, sem funil e sem evento; aviso marcado TREINO.
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
  rotulo text;
begin
  if not public.has_feature('comercial.orcamentos', 'operar') then
    raise exception 'Sem permissão para mudar orçamentos.' using errcode = '42501';
  end if;
  select * into q from public.sales_quotes where id = p_quote and organization_id = public.current_organization_id() for update;
  if q.id is null then raise exception 'Orçamento não encontrado.'; end if;
  select coalesce(full_name, email) into autor from public.profiles where id = public.current_profile_id();
  select name into cliente from public.customers where id = q.customer_id;
  rotulo := case when q.treino then format('TREINO · orçamento T-%s', q.numero) else format('Orçamento #%s', q.numero) end;
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
    select round(coalesce(sum(quantidade * preco_unitario), 0), 2) into total from public.sales_quote_items where quote_id = q.id;

    if not q.treino then
      -- Previsão a receber (decisão O4): o total do pedido, até as notas chegarem.
      if total > 0 then
        dias := nullif(substring(coalesce(q.condicao_pagamento, '') from '\d+'), '')::int;
        vence := coalesce(q.prazo_entrega, current_date) + coalesce(dias, 30);
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
    end if;
    perform public.notify_feature(q.organization_id, 'producao.entrada', 'operar', 'producao', 'info',
      format('%s ganho · %s', rotulo, cliente),
      format('%sPedido %s aprovado (R$ %s). Lance a entrada de produção quando as peças ficarem prontas.', case when q.treino then 'Treino: ' else '' end, q.pedido_cliente, public.brl(total)),
      case when q.treino then '/?module=producao&secao=Entrada%20de%20produção&treino=1' else '/?module=producao&secao=Entrada%20de%20produção' end,
      public.current_profile_id());

  elsif p_situacao = 'perdido' then
    if q.situacao not in ('rascunho', 'enviado') then raise exception 'Este orçamento não está em aberto.'; end if;
    if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga por que o orçamento foi perdido.'; end if;
    update public.sales_quotes set situacao = 'perdido', motivo_perda = left(btrim(p_motivo), 500) where id = q.id;
    if not q.treino then
      if q.crm_card_id is not null then
        select id into estagio from public.crm_stages where organization_id = q.organization_id and code = 'perdido';
        if estagio is not null then update public.crm_cards set stage_id = estagio, lost_reason = left(btrim(p_motivo), 500), updated_at = now() where id = q.crm_card_id and status = 'aberto'; end if;
      end if;
      perform public.emit_module_event(q.organization_id, 'comercial', 'comercial.orcamento.perdido', 'orcamento', q.id::text,
        format('Orçamento #%s perdido · %s', q.numero, cliente), jsonb_build_object('motivo', left(btrim(p_motivo), 500)));
    end if;

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

-- Entrada de produção: a do treino fica marcada, sem evento; aviso marcado TREINO.
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
  insert into public.production_entries (organization_id, quote_item_id, quantidade, observacao, created_by, created_by_name, treino)
  values (i.organization_id, i.id, p_quantidade, nullif(left(btrim(coalesce(p_observacao, '')), 500), ''), public.current_profile_id(), autor, q.treino)
  returning id into novo;
  if not q.treino then
    perform public.emit_module_event(i.organization_id, 'producao', 'producao.entrada.registrada', 'orcamento_item', i.id::text,
      format('Entrada de produção · %s peças de %s (orçamento #%s)', trim_scale(p_quantidade), i.descricao, q.numero),
      jsonb_build_object('quantidade', p_quantidade, 'orcamento', q.numero));
  end if;
  perform public.notify_feature(i.organization_id, 'fiscal.nfe', 'operar', 'fiscal', 'info',
    case when q.treino then format('TREINO · peças prontas para faturar · orçamento T-%s', q.numero) else format('Peças prontas para faturar · orçamento #%s', q.numero) end,
    format('%s × %s (pedido %s).', trim_scale(p_quantidade), i.descricao, q.pedido_cliente),
    '/?module=fiscal&secao=A%20faturar', public.current_profile_id());
  return novo;
end;
$$;

-- Estorno: o "já faturado" é o do ambiente do orçamento (treino ou produção).
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
  if public.faturamento_faturado(e.quote_item_id, case when e.treino then 'treino' else 'producao' end) > produzido - e.quantidade then
    raise exception 'Essas peças já foram faturadas: o estorno deixaria a nota sem produção.';
  end if;
  delete from public.production_entries where id = e.id;
end;
$$;

-- A faturar: no treino, só orçamentos de treino; em homologação e produção, só os reais.
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
    i_qtd, prod, fat, greatest(prod - fat, 0), greatest(i_qtd - fat, 0)
  from base
  where i_qtd - fat > 0
  order by q_numero, i_ordem;
end;
$$;

-- Origens da nota: nota de treino só fatura orçamento de treino; nota real só fatura orçamento real.
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
    select situacao, treino into sit, de_treino from public.sales_quotes where id = i.quote_id;
    if sit <> 'ganho' then raise exception 'O orçamento de "%" não está ganho.', i.descricao; end if;
    if de_treino and n.ambiente <> 'treino' then raise exception '"%" é de um orçamento de treino: só nota de treino.', i.descricao; end if;
    if not de_treino and n.ambiente = 'treino' then raise exception '"%" é de um orçamento real: nota de treino só fatura orçamento de treino.', i.descricao; end if;
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

-- Apaga o treino inteiro (para a entrada em produção): só o proprietário, e só quando chamado.
-- Devolve os caminhos dos arquivos dos anexos de treino, para quem chamou tirar do armazenamento.
create or replace function public.comercial_treino_apagar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  quotes uuid[];
  docs uuid[];
  caminhos text[];
  notas uuid[];
  n_quotes int; n_notas int; n_docs int;
begin
  if not public.is_owner() then raise exception 'Só o proprietário apaga o treino.' using errcode = '42501'; end if;
  select coalesce(array_agg(id), '{}') into quotes from public.sales_quotes where organization_id = org and treino;
  select coalesce(array_agg(distinct document_id), '{}') into docs from public.sales_quote_attachments where quote_id = any(quotes);
  select coalesce(array_agg(storage_path), '{}') into caminhos from public.company_documents where id = any(docs);
  select coalesce(array_agg(id), '{}') into notas from public.fiscal_nfe where organization_id = org and ambiente = 'treino';
  n_quotes := cardinality(quotes); n_notas := cardinality(notas); n_docs := cardinality(docs);
  perform set_config('pecsil.orcamento_situacao', 'on', true);
  delete from public.fiscal_nfe_origens where nfe_id = any(notas) or quote_item_id in (select id from public.sales_quote_items where quote_id = any(quotes));
  delete from public.fiscal_nfe_eventos where nfe_id = any(notas);
  delete from public.fiscal_nfe where id = any(notas);
  delete from public.fiscal_nfe_numeracao where organization_id = org and ambiente = 'treino';
  delete from public.production_entries where organization_id = org and treino;
  delete from public.sales_quote_attachments where quote_id = any(quotes);
  delete from public.sales_quote_notes where quote_id = any(quotes);
  delete from public.sales_quote_items where quote_id = any(quotes);
  delete from public.sales_quotes where id = any(quotes);
  delete from public.company_document_links where document_id = any(docs);
  delete from public.company_document_texts where document_id = any(docs);
  delete from public.company_documents where id = any(docs);
  delete from public.notifications where organization_id = org and title like 'TREINO · %';
  update public.sales_quote_numbering set proximo_treino = 1 where organization_id = org;
  perform set_config('pecsil.orcamento_situacao', 'off', true);
  return jsonb_build_object('orcamentos', n_quotes, 'notas', n_notas, 'documentos', n_docs, 'arquivos', to_jsonb(caminhos));
end;
$$;
revoke all on function public.comercial_treino_apagar() from public, anon;
grant execute on function public.comercial_treino_apagar() to authenticated;
