-- C-18 (31/10/2026, ideia do vídeo da secretária de IA): o funil anda com o trabalho. Orçamento enviado cria o card
-- em "Proposta enviada" ou avança o card ligado, nunca para trás, e emite comercial.orcamento.enviado.
-- A função abaixo é a da 202610150002 com só isso a mais; o treino continua fora do funil.

alter type public.crm_card_origem add value if not exists 'orcamento';

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
  ordem numeric;
  card uuid;
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
    if not q.treino then
      -- O funil anda com o trabalho (C-18): sem card, nasce em "Proposta enviada"; com card, só anda para a frente.
      select round(coalesce(sum(quantidade * preco_unitario), 0), 2) into total from public.sales_quote_items where quote_id = q.id;
      select s.id, s.position into estagio, ordem from public.crm_stages s where s.organization_id = q.organization_id and s.code = 'proposta';
      if estagio is not null then
        if q.crm_card_id is null then
          insert into public.crm_cards (organization_id, stage_id, title, kind, customer_id, value_cents, origem, created_by_profile_id)
          values (q.organization_id, estagio, format('Orçamento #%s · %s', q.numero, coalesce(cliente, 'sem cliente')), 'pedido', q.customer_id,
            round(total * 100)::bigint, 'orcamento', public.current_profile_id())
          returning id into card;
          update public.sales_quotes set crm_card_id = card where id = q.id;
        else
          update public.crm_cards c set stage_id = estagio, updated_at = now()
           where c.id = q.crm_card_id and c.status = 'aberto'
             and (select s.position from public.crm_stages s where s.id = c.stage_id) < ordem;
        end if;
      end if;
      perform public.emit_module_event(q.organization_id, 'comercial', 'comercial.orcamento.enviado', 'orcamento', q.id::text,
        format('Orçamento #%s enviado · %s', q.numero, coalesce(cliente, 'sem cliente')), jsonb_build_object('total', total));
    end if;

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
    -- Cancelado: o card que o próprio orçamento criou não fica parado no funil. Card feito à mão segue com a área.
    if p_situacao = 'cancelado' and q.crm_card_id is not null and not q.treino then
      select id into estagio from public.crm_stages where organization_id = q.organization_id and code = 'perdido';
      if estagio is not null then
        update public.crm_cards set stage_id = estagio, lost_reason = 'Orçamento cancelado', updated_at = now()
         where id = q.crm_card_id and status = 'aberto' and origem = 'orcamento';
      end if;
    end if;
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
