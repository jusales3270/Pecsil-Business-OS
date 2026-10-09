-- Fundição pede material ao Compras (09/10/2026).
--
-- Decisões do dono:
--   * Quem só tem Fundição › Pedidos de material (o Guilherme) cai direto no painel da
--     Fundição e vê apenas os pedidos feitos pela Fundição.
--   * O pedido vai para a divisão Fundição do Compras, assinado por quem pediu.
--   * O material chega pelo Almoxarifado (o Henrique recebe); o solicitante é avisado.
--
-- A origem do pedido (quem pediu: Almoxarifado ou Fundição) passa a ser gravada; a
-- divisão continua dizendo para onde vai o material (Usinagem ou Fundição).

-- --- Permissão e registro do módulo ------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('fundicao.pedidos', 'fundicao', 'Pedidos de material', '{ver,operar}', 10)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('fundicao', 'Fundição', '1.0.0', '/modules/fundicao', 'fundicao.view', 'integrated', 46)
on conflict (code) do update set status = 'integrated', name = 'Fundição', route = excluded.route, menu_order = excluded.menu_order;

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'fundicao', true, true from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- --- Origem do pedido -------------------------------------------------------------------
alter table public.material_requests
  add column if not exists origem text not null default 'ALMOXARIFADO';
alter table public.material_requests drop constraint if exists material_requests_origem_check;
alter table public.material_requests add constraint material_requests_origem_check check (origem in ('ALMOXARIFADO', 'FUNDICAO'));
comment on column public.material_requests.origem is 'Quem pediu: ALMOXARIFADO (Henrique) ou FUNDICAO (painel da Fundição).';
create index if not exists idx_material_requests_origem on public.material_requests (organization_id, origem, created_at desc);

-- --- Leitura: a Fundição só enxerga os pedidos dela ------------------------------------
drop policy if exists material_requests_read on public.material_requests;
create policy material_requests_read on public.material_requests for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.can_read_material_requests())
       or ((select public.has_feature('fundicao.pedidos')) and origem = 'FUNDICAO'))
);
drop policy if exists material_request_items_read on public.material_request_items;
create policy material_request_items_read on public.material_request_items for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.can_read_material_requests())
       or ((select public.has_feature('fundicao.pedidos'))
           and exists (select 1 from public.material_requests r where r.id = request_id and r.origem = 'FUNDICAO')))
);

-- --- Criar e cancelar pedido da Fundição --------------------------------------------------
-- p_itens: [{ produto, quantidade, unidade, observacao }]
create or replace function public.fundicao_criar_pedido(p_urgencia text, p_observacao text, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
  req public.material_requests%rowtype;
  item jsonb;
  n int := 0;
  resumo text;
begin
  if org is null or not public.has_feature('fundicao.pedidos', 'operar') then
    raise exception 'Sem permissão para pedir material pela Fundição.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe ao menos um item.';
  end if;

  insert into public.material_requests (organization_id, divisao, origem, urgencia, observacao, requested_by, requested_by_name)
  values (org, 'FUNDICAO', 'FUNDICAO', case when p_urgencia = 'urgente' then 'urgente' else 'normal' end,
    nullif(trim(coalesce(p_observacao, '')), ''), me, nome)
  returning * into req;

  for item in select * from jsonb_array_elements(p_itens) loop
    n := n + 1;
    if trim(coalesce(item ->> 'produto', '')) = '' then raise exception 'Item % sem descrição.', n; end if;
    if coalesce((item ->> 'quantidade')::numeric, 0) <= 0 then raise exception 'Item % sem quantidade.', n; end if;
    insert into public.material_request_items (organization_id, request_id, ordem, produto, quantidade, unidade, observacao)
    values (org, req.id, n, trim(item ->> 'produto'), (item ->> 'quantidade')::numeric,
      coalesce(nullif(upper(trim(item ->> 'unidade')), ''), 'UN'), nullif(trim(coalesce(item ->> 'observacao', '')), ''));
  end loop;

  select string_agg(format('%s %s %s', trim(to_char(i.quantidade, 'FM999G999G990D###')), i.unidade, i.produto), ' · ' order by i.ordem)
    into resumo from public.material_request_items i where i.request_id = req.id;

  perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras',
    case when req.urgencia = 'urgente' then 'attention' else 'info' end,
    format('%sPedido de material #%s · Fundição', case when req.urgencia = 'urgente' then 'URGENTE · ' else '' end, req.numero),
    left(coalesce(nome || ' (Fundição): ', 'Fundição: ') || resumo, 400), '/?module=compras&secao=solicitacoes', me);

  perform public.emit_module_event(org, 'fundicao', 'fundicao.pedido.criado', 'solicitacao', req.id::text,
    format('Pedido de material #%s da Fundição · %s itens', req.numero, n),
    jsonb_build_object('numero', req.numero, 'divisao', req.divisao, 'origem', req.origem, 'urgencia', req.urgencia, 'itens', n));

  return jsonb_build_object('id', req.id, 'numero', req.numero);
end;
$$;
revoke all on function public.fundicao_criar_pedido(text, text, jsonb) from public, anon;
grant execute on function public.fundicao_criar_pedido(text, text, jsonb) to authenticated;

create or replace function public.fundicao_cancelar_pedido(p_request uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  req public.material_requests%rowtype;
begin
  if not public.has_feature('fundicao.pedidos', 'operar') then
    raise exception 'Sem permissão para cancelar o pedido.' using errcode = '42501';
  end if;
  select * into req from public.material_requests where id = p_request and organization_id = org and origem = 'FUNDICAO' for update;
  if req.id is null then raise exception 'Pedido não encontrado.'; end if;
  if req.status in ('comprada', 'parcial', 'recebida') then
    raise exception 'O material já foi comprado: o pedido não pode mais ser cancelado.';
  end if;
  if req.status = 'cancelada' then return; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento.'; end if;

  update public.material_requests
     set status = 'cancelada', cancel_reason = trim(p_motivo), cancelled_at = now(), updated_at = now()
   where id = req.id;

  if req.status <> 'aberta' then
    perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras', 'attention',
      format('Pedido de material #%s (Fundição) cancelado', req.numero), trim(p_motivo), '/?module=compras&secao=solicitacoes', public.current_profile_id());
  end if;
  perform public.emit_module_event(org, 'fundicao', 'fundicao.pedido.cancelado', 'solicitacao', req.id::text,
    format('Pedido de material #%s da Fundição cancelado', req.numero), jsonb_build_object('numero', req.numero, 'motivo', trim(p_motivo)));
end;
$$;
revoke all on function public.fundicao_cancelar_pedido(uuid, text) from public, anon;
grant execute on function public.fundicao_cancelar_pedido(uuid, text) to authenticated;

-- --- Situação do pedido: avisos levam ao painel de quem pediu ------------------------------
-- Igual à versão de 202610010002, só muda para onde o aviso ao solicitante leva.
create or replace function public.almoxarifado_atualizar_solicitacao(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.material_requests%rowtype;
  nova text;
  aprovador text;
  motivo text;
  link text;
  modulo text;
begin
  if p_request is null then return; end if;
  select * into req from public.material_requests where id = p_request for update;
  if req.id is null or req.status in ('cancelada', 'recebida', 'parcial') then return; end if;

  select case
      when bool_or(c.status = 'COMPRADO') or exists (select 1 from public.compras k join public.cotacoes c2 on c2.id = k.cotacao_id where c2.material_request_id = p_request and c2.deleted_at is null) then 'comprada'
      when bool_or(c.status = 'APROVADO') then 'aprovada'
      when bool_or(c.status = 'PENDENTE') then 'em_cotacao'
      when count(*) > 0 then 'rejeitada'
      else 'aberta'
    end,
    max(c.aprovado_por) filter (where c.status in ('APROVADO', 'COMPRADO')),
    max(c.motivo_rejeicao) filter (where c.status = 'REJEITADO')
    into nova, aprovador, motivo
  from public.cotacoes c
  where c.material_request_id = p_request and c.deleted_at is null;

  if nova is null or nova = req.status then return; end if;
  update public.material_requests set status = nova, updated_at = now() where id = req.id;

  if req.origem = 'FUNDICAO' then
    modulo := 'fundicao';
    link := '/?module=fundicao';
  else
    modulo := 'almoxarifado';
    link := '/?module=almoxarifado&secao=' || case when nova = 'comprada' then 'A%20caminho' else 'Solicita%C3%A7%C3%B5es' end;
  end if;
  if nova = 'em_cotacao' then
    perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'info',
      format('Pedido #%s em cotação', req.numero), 'O Compras está cotando o material.', link);
  elsif nova = 'aprovada' then
    perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'info',
      format('Pedido #%s aprovado', req.numero), format('Cotação aprovada%s. Aguarde o aviso de compra.', coalesce(' por ' || aprovador, '')), link);
  elsif nova = 'rejeitada' then
    perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'attention',
      format('Pedido #%s rejeitado', req.numero), coalesce(motivo, 'Todas as cotações foram rejeitadas.'), link);
  elsif nova = 'comprada' then
    -- Quem recebe o material (Almoxarifado) é avisado sempre; o material da Fundição também chega por lá.
    perform public.notify_feature(req.organization_id, 'almoxarifado.recebimento', 'operar', 'almoxarifado', 'info',
      format('Material comprado · pedido #%s%s', req.numero, case when req.origem = 'FUNDICAO' then ' (Fundição)' else '' end),
      'A compra foi feita. Confira o material e lance a nota quando chegar.', '/?module=almoxarifado&secao=A%20caminho');
    if not exists (select 1 from public.user_feature_grants g where g.profile_id = req.requested_by and g.feature_code = 'almoxarifado.recebimento' and g.level >= 'operar') then
      perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'info',
        format('Material comprado · pedido #%s', req.numero), 'A compra foi feita e o material está a caminho.', link);
    end if;
  end if;
end;
$$;
revoke all on function public.almoxarifado_atualizar_solicitacao(uuid) from public, anon, authenticated;

-- --- Material chegou: avisa quem pediu e não recebe (a Fundição) ---------------------------
create or replace function public.trg_material_request_chegou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('recebida', 'parcial') and old.status is distinct from new.status
     and not exists (select 1 from public.user_feature_grants g where g.profile_id = new.requested_by and g.feature_code = 'almoxarifado.recebimento' and g.level >= 'operar') then
    perform public.notify_profile(new.organization_id, new.requested_by,
      case when new.origem = 'FUNDICAO' then 'fundicao' else 'almoxarifado' end, 'info',
      format('Material %s · pedido #%s', case when new.status = 'recebida' then 'chegou' else 'chegou em parte' end, new.numero),
      case when new.status = 'recebida' then 'O Almoxarifado recebeu o material e lançou a nota.' else 'O Almoxarifado recebeu parte do material; o restante continua a caminho.' end,
      case when new.origem = 'FUNDICAO' then '/?module=fundicao' else '/?module=almoxarifado&secao=Recebidos' end);
  end if;
  return new;
end;
$$;
drop trigger if exists material_requests_chegou on public.material_requests;
create trigger material_requests_chegou
  after update of status on public.material_requests
  for each row execute function public.trg_material_request_chegou();

-- --- A caminho: o Almoxarifado vê de quem é o material --------------------------------------
-- Igual à versão de 202610010004, com 'origem' a mais.
create or replace function public.almoxarifado_a_caminho()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if not (public.has_feature('almoxarifado.recebimento') or public.has_feature('almoxarifado.solicitacoes')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'compradoEm' desc, (x ->> 'cotacaoId')::bigint desc)
    from (
      select jsonb_build_object(
        'cotacaoId', c.id,
        'fornecedor', c.fornecedor,
        'supplierId', c.supplier_id,
        'cnpj', (select regexp_replace(coalesce(s.tax_id, ''), '\D', '', 'g') from public.suppliers s where s.id = c.supplier_id),
        'divisao', c.divisao,
        'pedidoId', r.id,
        'pedidoNumero', r.numero,
        'origem', r.origem,
        'solicitante', r.requested_by_name,
        'compradoEm', (select min(k.data_compra) from public.compras k where k.cotacao_id = c.id),
        'totalComprado', (select coalesce(sum(k.total), 0) from public.compras k where k.cotacao_id = c.id),
        'jaRecebido', coalesce((select sum(rc.valor_total) from public.receipts rc where rc.cotacao_id = c.id), 0),
        'recebimentos', (select count(*) from public.receipts rc where rc.cotacao_id = c.id),
        'previsaoVencimento', (select min(i.due_date) from public.finance_titles t join public.finance_installments i on i.title_id = t.id
                                where t.source_module = 'compras' and t.source_entity_id = c.ref_id and t.is_forecast),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto', k.produto, 'quantidade', k.quantidade, 'unidade', k.unidade,
                    'valorUnit', k.valor_unit, 'total', k.total) order by k.id), '[]'::jsonb)
                  from public.compras k where k.cotacao_id = c.id)
      ) as x
      from public.cotacoes c
      left join public.material_requests r on r.id = c.material_request_id
      where c.organization_id = org and c.deleted_at is null
        and exists (select 1 from public.compras k where k.cotacao_id = c.id)
        and (
          exists (select 1 from public.finance_titles t where t.source_module = 'compras' and t.source_entity_id = c.ref_id and t.is_forecast)
          or exists (select 1 from public.receipts rc where rc.cotacao_id = c.id)
        )
        and not exists (select 1 from public.receipts rc where rc.cotacao_id = c.id and rc.encerra_pedido)
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.almoxarifado_a_caminho() from public, anon;
grant execute on function public.almoxarifado_a_caminho() to authenticated;
