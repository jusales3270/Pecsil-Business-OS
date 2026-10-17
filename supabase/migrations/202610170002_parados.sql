-- A-11 (roadmap) · "parados há X dias": o que está esperando alguém em cada área, com há quantos
-- dias e o link para resolver. É SÓ A LISTA: não escala nem manda mensagem (o SLA com WhatsApp é o
-- P-06, compartilhado com a Forja). Cada linha pertence à área que resolve e só aparece para quem tem
-- a permissão dela (decisão é da área, não do proprietário).
--
-- Prazo a partir do qual conta como parado (dias corridos):
--   pedido de material sem cotação ........ 2   (quem cota no Compras)
--   cotação esperando aprovação ............ 2   (quem aprova cotações)
--   cotação aprovada e não comprada ........ 2   (quem cota)
--   compra com prazo de entrega vencido .... 1   (Almoxarifado, que recebe)
--   rascunho de OS na Forja não liberado ... 3   (PCP: quem lança a entrada de produção)
--   orçamento enviado sem resposta ......... 7   (Comercial)
--   pedido ganho com saldo a faturar ....... 3   (Fiscal: quem aprova NF-e)
--   conta a pagar esperando aprovação ...... 2   (Financeiro: quem aprova contas)
--   nota recebida da SEFAZ sem lançamento .. 5   (Almoxarifado)

create or replace function public.parados_listar()
returns table (tipo text, area text, titulo text, detalhe text, desde timestamptz, dias int, link text, ref text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  agora timestamptz := now();
begin
  if org is null then raise exception 'Sem organização.' using errcode = '42501'; end if;
  return query
  with base as (
    -- Pedido de material aberto, sem cotação andando
    select 'pedido_material'::text t, 'Compras'::text a, 'compras.cotacoes'::text f, 'operar'::public.access_level n,
      format('Pedido de material #%s · %s', r.numero, initcap(lower(r.divisao))) ti,
      coalesce((select string_agg(format('%s %s %s', trim(to_char(i.quantidade, 'FM999G999G990D###')), i.unidade, i.produto), ' · ' order by i.ordem)
                from public.material_request_items i where i.request_id = r.id), '') || coalesce(' · pediu ' || r.requested_by_name, '') de,
      coalesce(r.updated_at, r.created_at) d, 2 lim, '/?module=compras&secao=solicitacoes' l, r.id::text rf
    from public.material_requests r
    where r.organization_id = org and r.status in ('aberta', 'em_cotacao')
    union all
    -- Cotação esperando a decisão do gestor
    select 'cotacao_aprovacao', 'Compras', 'compras.aprovacoes', 'aprovar',
      format('Cotação nº %s · %s', c.id, c.fornecedor),
      coalesce((select format('%s item(ns) · R$ %s', count(*), public.brl(sum(p.valor_unit * p.quantidade))) from public.cotacao_produtos p where p.cotacao_id = c.id), ''),
      coalesce(c.updated_at, c.created_at), 2, '/?module=compras&secao=pendentes', c.id::text
    from public.cotacoes c
    where c.organization_id = org and c.deleted_at is null and c.status = 'PENDENTE'
    union all
    -- Cotação aprovada que ainda não virou compra
    select 'cotacao_sem_compra', 'Compras', 'compras.cotacoes', 'operar',
      format('OC nº %s aprovada · %s', c.id, c.fornecedor), 'Aprovada e ainda não registrada como compra',
      coalesce(c.data_decisao, c.updated_at, c.created_at), 2, '/?module=compras&secao=cotacoes', c.id::text
    from public.cotacoes c
    where c.organization_id = org and c.deleted_at is null and c.status = 'APROVADO'
    union all
    -- Compra com prazo de entrega vencido e sem nota recebida (a partir da virada do Compras)
    select 'compra_atrasada', 'Almoxarifado', 'almoxarifado.recebimento', 'operar',
      format('OC nº %s · %s', c.id, c.fornecedor), format('Entrega prevista para %s e ainda sem nota recebida', to_char(c.prazo_entrega, 'DD/MM/YYYY')),
      (c.prazo_entrega::timestamp at time zone 'America/Sao_Paulo'), 1, '/?module=almoxarifado&secao=A%20caminho', c.id::text
    from public.cotacoes c
    where c.organization_id = org and c.deleted_at is null and c.status = 'COMPRADO' and c.prazo_entrega is not null
      and c.created_at >= '2026-10-01' and not exists (select 1 from public.receipts rc where rc.cotacao_id = c.id)
    union all
    -- Rascunho de OS na Forja que ninguém liberou (orçamentos reais)
    select 'os_rascunho', 'Produção', 'producao.entrada', 'operar',
      format('OS em rascunho na Forja · %s', coalesce(e.forja_codigo, e.ref)),
      coalesce((select format('Orçamento nº %s · %s', q.numero, cu.name) from public.sales_quotes q left join public.customers cu on cu.id = q.customer_id where q.id = e.quote_id), ''),
      coalesce(e.enviado_em, e.created_at), 3, '/?module=comercial&secao=orcamentos', e.id::text
    from public.forja_os_envios e
    join public.sales_quotes q on q.id = e.quote_id and not q.treino
    where e.organization_id = org and e.status = 'enviado' and coalesce(e.forja_status, 'rascunho') = 'rascunho'
    union all
    -- Orçamento enviado ao cliente sem resposta
    select 'orcamento_sem_resposta', 'Comercial', 'comercial.orcamentos', 'operar',
      format('Orçamento nº %s · %s', q.numero, coalesce(cu.name, '—')), coalesce('Pedido do cliente ' || q.pedido_cliente, 'Enviado e sem ganho ou perda registrados'),
      coalesce(q.updated_at, q.created_at), 7, '/?module=comercial&secao=orcamentos', q.id::text
    from public.sales_quotes q left join public.customers cu on cu.id = q.customer_id
    where q.organization_id = org and not q.treino and q.situacao = 'enviado'
    union all
    -- Pedido ganho com saldo ainda a faturar
    select 'a_faturar', 'Fiscal', 'fiscal.nfe', 'aprovar',
      format('Pedido nº %s · %s', q.numero, coalesce(cu.name, '—')),
      format('%s item(ns) com saldo a faturar', (select count(*) from public.sales_quote_items i where i.quote_id = q.id and i.quantidade > public.faturamento_faturado(i.id, 'producao'))),
      coalesce(q.ganho_em, q.updated_at), 3, '/?module=fiscal&secao=A%20faturar', q.id::text
    from public.sales_quotes q left join public.customers cu on cu.id = q.customer_id
    where q.organization_id = org and not q.treino and q.situacao = 'ganho'
      and exists (select 1 from public.sales_quote_items i where i.quote_id = q.id and i.quantidade > public.faturamento_faturado(i.id, 'producao'))
    union all
    -- Conta a pagar esperando aprovação
    select 'conta_aprovacao', 'Financeiro', 'financeiro.pagar', 'aprovar',
      format('Conta a pagar · %s', t.counterparty_name), format('R$ %s%s', public.brl(t.original_amount), coalesce(' · ' || t.document_number, '')),
      t.created_at, 2, '/?module=financeiro&secao=Contas%20a%20pagar', t.id::text
    from public.finance_titles t
    where t.organization_id = org and t.direction = 'payable' and t.status = 'pending_approval' and not coalesce(t.is_forecast, false)
    union all
    -- Nota emitida contra a empresa (SEFAZ) que ninguém lançou no recebimento
    select 'nota_sem_lancamento', 'Almoxarifado', 'almoxarifado.recebimento', 'operar',
      format('NF de %s', coalesce(d.emitente_nome, d.emitente_cnpj)), format('R$ %s · emitida em %s', public.brl(coalesce(d.valor, 0)), to_char(d.emissao, 'DD/MM/YYYY')),
      coalesce(d.emissao::timestamptz, d.created_at), 5, '/?module=almoxarifado&secao=A%20caminho', d.id::text
    from public.fiscal_dfe d
    where d.organization_id = org and coalesce(d.situacao, '') not in ('cancelada', 'denegada')
      and not exists (select 1 from public.receipts rc where rc.organization_id = org and rc.nf_chave = d.chave)
  )
  select b.t, b.a, b.ti, b.de, b.d, (extract(epoch from (agora - b.d)) / 86400)::int, b.l, b.rf
  from base b
  where b.d <= agora - make_interval(days => b.lim)
    and public.has_feature(b.f, b.n)
  order by agora - b.d desc;
end;
$$;
revoke all on function public.parados_listar() from public, anon;
grant execute on function public.parados_listar() to authenticated;
