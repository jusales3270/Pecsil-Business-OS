-- ============================================================================
-- Treino também vai à Forja (16/10/2026, decisão do proprietário)
-- ============================================================================
-- O orçamento de treino ganho cria o rascunho na Forja marcado TREINO (código TREINO-T-n/item): o
-- Rafael pratica completar roteiro, desenhos e materiais, mas a Forja não deixa liberar (nunca vai
-- para o Tótem). Reabrir o treino ou apagar o treino (comercial_treino_apagar) apaga o rascunho lá.
-- Os treinos já ganhos entram na fila agora.
-- ============================================================================

create or replace function public.forja_os_envios_do_orcamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  liberada text;
begin
  if new.situacao = 'ganho' and old.situacao is distinct from 'ganho' then
    insert into public.forja_os_envios (organization_id, quote_id, quote_item_id, ref)
    select new.organization_id, new.id, i.id, i.id::text from public.sales_quote_items i where i.quote_id = new.id
    on conflict (ref) do update set status = 'pendente', tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
      where forja_os_envios.status in ('cancelar', 'cancelado');

  elsif old.situacao = 'ganho' and new.situacao in ('rascunho', 'cancelado') then
    -- A previsão a receber cancelada solta o nº do pedido: sem isso, ganhar de novo esbarrava no
    -- índice único do documento (uq_finance_title_document). A descrição continua citando o pedido.
    update public.finance_titles set document_number = null, updated_at = now()
     where organization_id = new.organization_id and source_module = 'comercial' and source_entity_id = new.id and is_forecast and status = 'cancelled';
    select coalesce(forja_codigo, 'a OS') into liberada from public.forja_os_envios
     where quote_id = new.id and status = 'enviado' and forja_status in ('aberta', 'em_producao', 'finalizada', 'atrasada') limit 1;
    if liberada is not null then
      raise exception 'A OS % já foi liberada para produção na Forja: cancele lá primeiro.', liberada;
    end if;
    -- Nunca chegou à Forja: só sai da fila. Já chegou: a sincronização cancela o rascunho lá.
    update public.forja_os_envios set status = 'cancelado', updated_at = now()
     where quote_id = new.id and status in ('pendente', 'erro') and forja_os_id is null;
    update public.forja_os_envios set status = 'cancelar', tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
     where quote_id = new.id and (status = 'enviado' or (status = 'erro' and forja_os_id is not null));
  end if;
  return new;
end;
$$;
revoke all on function public.forja_os_envios_do_orcamento() from public, anon, authenticated;

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
  -- OS de treino na Forja: a sincronização apaga o rascunho lá (o que nunca chegou só sai da fila).
  update public.forja_os_envios set status = case when forja_os_id is null then 'cancelado' else 'cancelar' end,
         tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
   where quote_id = any(quotes) and status <> 'cancelado';
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

-- Treinos já ganhos (antes desta mudança) entram na fila.
insert into public.forja_os_envios (organization_id, quote_id, quote_item_id, ref)
select q.organization_id, q.id, i.id, i.id::text
  from public.sales_quotes q join public.sales_quote_items i on i.quote_id = q.id
 where q.treino and q.situacao = 'ganho'
on conflict (ref) do nothing;
