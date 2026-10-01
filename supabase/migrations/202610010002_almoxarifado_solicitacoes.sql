-- Almoxarifado: solicitação de material ligada ao Compras e à previsão no Financeiro.
--
-- Fluxo (docs/PROCESSOS-PECSIL.md, Cadeia 1):
--   1. Almoxarifado pede o material (material_requests)      → aviso a quem cota
--   2. Compras cota a partir do pedido (cotacoes.material_request_id)
--   3. Gestor aprova ou rejeita                                → aviso ao solicitante
--   4. Compras dá o aviso de compra (linhas em public.compras) → previsão em Contas a
--      pagar, aviso a quem paga e a quem recebe o material
--   5. Recebimento com a nota (migração seguinte)              → conta a pagar real
--
-- A situação do pedido é calculada pelo banco a partir das cotações ligadas; ninguém
-- a edita à mão. Avisos e previsão saem de gatilhos security definer, para não
-- dependerem da permissão de quem clicou (Kaylane não tem acesso ao Financeiro).

-- --- Permissões e registro do módulo ----------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('almoxarifado.solicitacoes', 'almoxarifado', 'Solicitações', '{ver,operar}', 10),
  ('almoxarifado.recebimento', 'almoxarifado', 'Recebimento', '{ver,operar}', 20)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('almoxarifado', 'Almoxarifado', '1.0.0', '/modules/almoxarifado', 'almoxarifado.view', 'integrated', 45)
on conflict (code) do update set status = 'integrated', name = 'Almoxarifado', route = excluded.route, menu_order = excluded.menu_order;

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'almoxarifado', true, true from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- --- Aviso para uma pessoa específica (o solicitante) --------------------------------
create or replace function public.notify_profile(p_org uuid, p_profile uuid, p_module text, p_severity text, p_title text, p_body text, p_action_url text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
  select p_org, p.id, p_module, p_severity, p_title, p_body, p_action_url
  from public.profiles p
  where p.id = p_profile and p.status = 'active';
$$;
revoke all on function public.notify_profile(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- --- Pedido de material -----------------------------------------------------------
create table if not exists public.material_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero bigint generated always as identity unique,
  divisao text not null default 'USINAGEM' check (divisao in ('USINAGEM', 'FUNDICAO', 'GERAL')),
  urgencia text not null default 'normal' check (urgencia in ('normal', 'urgente')),
  observacao text,
  status text not null default 'aberta'
    check (status in ('aberta', 'em_cotacao', 'aprovada', 'rejeitada', 'comprada', 'parcial', 'recebida', 'cancelada')),
  requested_by uuid references public.profiles(id) on delete set null,
  -- Nome de quem pediu, gravado na hora: o Compras não lê perfis de outras pessoas.
  requested_by_name text,
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_material_requests_org_status on public.material_requests (organization_id, status, created_at desc);

create table if not exists public.material_request_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.material_requests(id) on delete cascade,
  ordem int not null default 1,
  produto text not null check (length(trim(produto)) > 0),
  quantidade numeric(14,3) not null check (quantidade > 0),
  unidade text not null default 'UN',
  observacao text
);
create index if not exists idx_material_request_items_request on public.material_request_items (request_id, ordem);

-- Cotação nasce do pedido; ref_id é a chave uuid que o Financeiro guarda (o id da cotação é bigint).
alter table public.cotacoes
  add column if not exists material_request_id uuid references public.material_requests(id) on delete set null,
  add column if not exists ref_id uuid not null default gen_random_uuid();
create unique index if not exists uq_cotacoes_ref_id on public.cotacoes (ref_id);
create index if not exists idx_cotacoes_material_request on public.cotacoes (material_request_id) where material_request_id is not null;

alter table public.material_requests enable row level security;
alter table public.material_request_items enable row level security;

-- Quem pede, quem recebe e quem cota/aprova enxerga os pedidos.
create or replace function public.can_read_material_requests()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('almoxarifado.solicitacoes') or public.has_feature('almoxarifado.recebimento')
      or public.has_feature('compras.cotacoes') or public.has_feature('compras.aprovacoes');
$$;

drop policy if exists material_requests_read on public.material_requests;
create policy material_requests_read on public.material_requests for select using (
  organization_id = (select public.current_organization_id()) and (select public.can_read_material_requests())
);
drop policy if exists material_request_items_read on public.material_request_items;
create policy material_request_items_read on public.material_request_items for select using (
  organization_id = (select public.current_organization_id()) and (select public.can_read_material_requests())
);
-- Gravação só pelas funções abaixo (security definer), que conferem a permissão.

-- --- Criar e cancelar pedido ----------------------------------------------------------
-- p_itens: [{ produto, quantidade, unidade, observacao }]
create or replace function public.almoxarifado_criar_solicitacao(p_divisao text, p_urgencia text, p_observacao text, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  req public.material_requests%rowtype;
  item jsonb;
  n int := 0;
  resumo text;
begin
  if org is null or not public.has_feature('almoxarifado.solicitacoes', 'operar') then
    raise exception 'Sem permissão para pedir material.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe ao menos um item.';
  end if;

  insert into public.material_requests (organization_id, divisao, urgencia, observacao, requested_by, requested_by_name)
  values (org, coalesce(nullif(p_divisao, ''), 'USINAGEM'), coalesce(nullif(p_urgencia, ''), 'normal'), nullif(trim(coalesce(p_observacao, '')), ''), me,
    (select full_name from public.profiles where id = me))
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
    format('%sPedido de material #%s · %s', case when req.urgencia = 'urgente' then 'URGENTE · ' else '' end, req.numero, initcap(lower(req.divisao))),
    left(coalesce((select full_name from public.profiles where id = me) || ': ', '') || resumo, 400), '/?module=compras&secao=solicitacoes', me);

  perform public.emit_module_event(org, 'almoxarifado', 'almoxarifado.solicitacao.criada', 'solicitacao', req.id::text,
    format('Pedido de material #%s · %s itens', req.numero, n),
    jsonb_build_object('numero', req.numero, 'divisao', req.divisao, 'urgencia', req.urgencia, 'itens', n));

  return jsonb_build_object('id', req.id, 'numero', req.numero);
end;
$$;
revoke all on function public.almoxarifado_criar_solicitacao(text, text, text, jsonb) from public, anon;
grant execute on function public.almoxarifado_criar_solicitacao(text, text, text, jsonb) to authenticated;

create or replace function public.almoxarifado_cancelar_solicitacao(p_request uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  req public.material_requests%rowtype;
begin
  if not public.has_feature('almoxarifado.solicitacoes', 'operar') then
    raise exception 'Sem permissão para cancelar o pedido.' using errcode = '42501';
  end if;
  select * into req from public.material_requests where id = p_request and organization_id = org for update;
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
      format('Pedido de material #%s cancelado', req.numero), trim(p_motivo), '/?module=compras&secao=solicitacoes', public.current_profile_id());
  end if;
  perform public.emit_module_event(org, 'almoxarifado', 'almoxarifado.solicitacao.cancelada', 'solicitacao', req.id::text,
    format('Pedido de material #%s cancelado', req.numero), jsonb_build_object('numero', req.numero, 'motivo', trim(p_motivo)));
end;
$$;
revoke all on function public.almoxarifado_cancelar_solicitacao(uuid, text) from public, anon;
grant execute on function public.almoxarifado_cancelar_solicitacao(uuid, text) to authenticated;

-- --- Situação do pedido a partir das cotações ligadas ---------------------------------
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

  link := '/?module=almoxarifado&secao=' || case when nova = 'comprada' then 'A%20caminho' else 'Solicita%C3%A7%C3%B5es' end;
  if nova = 'em_cotacao' then
    perform public.notify_profile(req.organization_id, req.requested_by, 'almoxarifado', 'info',
      format('Pedido #%s em cotação', req.numero), 'O Compras está cotando o material.', link);
  elsif nova = 'aprovada' then
    perform public.notify_profile(req.organization_id, req.requested_by, 'almoxarifado', 'info',
      format('Pedido #%s aprovado', req.numero), format('Cotação aprovada%s. Aguarde o aviso de compra.', coalesce(' por ' || aprovador, '')), link);
  elsif nova = 'rejeitada' then
    perform public.notify_profile(req.organization_id, req.requested_by, 'almoxarifado', 'attention',
      format('Pedido #%s rejeitado', req.numero), coalesce(motivo, 'Todas as cotações foram rejeitadas.'), link);
  elsif nova = 'comprada' then
    perform public.notify_feature(req.organization_id, 'almoxarifado.recebimento', 'operar', 'almoxarifado', 'info',
      format('Material comprado · pedido #%s', req.numero), 'A compra foi feita. Confira o material e lance a nota quando chegar.', link);
    if not exists (select 1 from public.user_feature_grants g where g.profile_id = req.requested_by and g.feature_code = 'almoxarifado.recebimento' and g.level >= 'operar') then
      perform public.notify_profile(req.organization_id, req.requested_by, 'almoxarifado', 'info',
        format('Material comprado · pedido #%s', req.numero), 'A compra foi feita e o material está a caminho.', link);
    end if;
  end if;
end;
$$;
revoke all on function public.almoxarifado_atualizar_solicitacao(uuid) from public, anon, authenticated;

create or replace function public.trg_cotacao_solicitacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.material_request_id is distinct from new.material_request_id then
    perform public.almoxarifado_atualizar_solicitacao(old.material_request_id);
  end if;
  perform public.almoxarifado_atualizar_solicitacao(new.material_request_id);
  return new;
end;
$$;
drop trigger if exists cotacoes_solicitacao on public.cotacoes;
create trigger cotacoes_solicitacao
  after insert or update of status, material_request_id, deleted_at on public.cotacoes
  for each row execute function public.trg_cotacao_solicitacao();

-- --- Conta do plano sugerida pelo histórico do fornecedor ----------------------------
create or replace function public.finance_suggest_account(p_org uuid, p_supplier uuid, p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.chart_account_id
  from public.finance_title_allocations a
  join public.finance_titles t on t.id = a.title_id
  join public.finance_chart_accounts c on c.id = a.chart_account_id
  where t.organization_id = p_org and t.direction = 'payable' and c.allows_posting and c.active
    and ((p_supplier is not null and t.supplier_id = p_supplier)
      or lower(t.counterparty_name) = lower(trim(p_name))
      or lower(t.counterparty_group) = lower(trim(p_name)))
  group by a.chart_account_id
  order by count(*) desc, max(t.issue_date) desc
  limit 1;
$$;
revoke all on function public.finance_suggest_account(uuid, uuid, text) from public, anon, authenticated;

-- --- Aviso de compra → previsão em Contas a pagar ------------------------------------
-- Cada item comprado é uma linha em public.compras (o navegador grava em paralelo).
-- A previsão é uma só por cotação: valor = soma do que já foi comprado.
create or replace function public.trg_compra_previsao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cot public.cotacoes%rowtype;
  total numeric(18,2);
  primeira date;
  dias int;
  vence date;
  conta uuid;
  previsao uuid;
  parcela uuid;
begin
  select * into cot from public.cotacoes where id = new.cotacao_id;
  if cot.id is null then return new; end if;
  -- Itens gravados em paralelo: um de cada vez por cotação.
  perform pg_advisory_xact_lock(hashtextextended('compra-previsao:' || cot.ref_id::text, 0));

  select coalesce(sum(k.total), 0), min(k.data_compra) into total, primeira from public.compras k where k.cotacao_id = cot.id;
  if total <= 0 then return new; end if;

  select id into previsao from public.finance_titles
   where organization_id = cot.organization_id and source_module = 'compras' and source_entity_id = cot.ref_id and is_forecast
   order by created_at limit 1 for update;

  if previsao is null then
    -- Prazo do fornecedor ("30", "28 dias", "30/60/90"): o primeiro número; sem prazo, 30 dias.
    select nullif(substring(s.payment_terms from '\d+'), '')::int into dias from public.suppliers s where s.id = cot.supplier_id;
    vence := coalesce(primeira, current_date) + coalesce(dias, 30);
    conta := public.finance_suggest_account(cot.organization_id, cot.supplier_id, cot.fornecedor);
    insert into public.finance_titles (
      organization_id, direction, counterparty_name, supplier_id, description, notes, issue_date, competence_date,
      original_amount, chart_account_id, cost_center_id, status, approved_at, source_module, source_entity_id,
      is_forecast, needs_review, review_reason
    ) values (
      cot.organization_id, 'payable', cot.fornecedor, cot.supplier_id,
      format('Compra · cotação #%s (previsão até a nota chegar)', cot.id),
      'Gerada pelo aviso de compra. Vira conta a pagar quando o Almoxarifado lançar a nota.',
      coalesce(primeira, current_date), coalesce(primeira, current_date), total, conta, cot.cost_center_id,
      'approved', now(), 'compras', cot.ref_id, true, conta is null,
      case when conta is null then 'Conta do plano a definir: fornecedor sem histórico' end
    ) returning id into previsao;
    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (cot.organization_id, previsao, 1, vence, total, 0, 'pending');
    if conta is not null then
      insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
      values (cot.organization_id, previsao, conta, total);
    end if;
    perform public.notify_feature(cot.organization_id, 'financeiro.pagar', 'aprovar', 'financeiro', 'info',
      format('Compra aprovada · %s', cot.fornecedor),
      format('R$ %s previstos para %s (cotação #%s). Vira conta a pagar quando a nota chegar.', public.brl(total), to_char(vence, 'DD/MM/YYYY'), cot.id),
      '/?module=financeiro&secao=Contas%20a%20pagar');
    -- Compra sem pedido do almoxarifado: quem recebe material também precisa saber.
    if cot.material_request_id is null then
      perform public.notify_feature(cot.organization_id, 'almoxarifado.recebimento', 'operar', 'almoxarifado', 'info',
        format('Material comprado · %s', cot.fornecedor),
        format('Cotação #%s comprada. Confira o material e lance a nota quando chegar.', cot.id), '/?module=almoxarifado&secao=A%20caminho');
    end if;
  else
    update public.finance_titles set original_amount = total, updated_at = now() where id = previsao and original_amount <> total;
    select id into parcela from public.finance_installments where title_id = previsao order by installment_number limit 1;
    update public.finance_installments set amount = total where id = parcela and settled_amount = 0 and amount <> total;
    update public.finance_title_allocations set amount = total where title_id = previsao and amount <> total
      and (select count(*) from public.finance_title_allocations where title_id = previsao) = 1;
  end if;

  perform public.almoxarifado_atualizar_solicitacao(cot.material_request_id);
  return new;
end;
$$;
drop trigger if exists compras_previsao on public.compras;
create trigger compras_previsao
  after insert on public.compras
  for each row execute function public.trg_compra_previsao();
