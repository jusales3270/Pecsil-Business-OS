-- Compras › pedidos do Almoxarifado e da Fundição: ramos por fornecedor e compra imediata (pedido do
-- proprietário, 20/10/2026).
--   * Um pedido com vários itens pode ser cotado com fornecedores diferentes. A Kaylane marca os itens,
--     escolhe o fornecedor (do cadastro) e encaminha: nasce um RAMO "aguardando preço". Quando o preço
--     chega (digitado por ela ou pelo link do fornecedor), o ramo vira a cotação daquele fornecedor, que
--     segue o fluxo de sempre (aprovação → OC → compra → financeiro).
--   * Cada item da cotação passa a saber de qual item do pedido veio (material_request_item_id). A
--     situação do pedido sai dos itens: só fica "Comprada" quando TODOS os itens foram comprados, e
--     "Recebida" quando todas as OCs dele foram encerradas no recebimento. Pedido antigo sem esse vínculo
--     segue a regra antiga.
--   * Compra imediata: itens marcados + fornecedor + preço, sem cotação, autorizada por quem aprova
--     compras (escolhido numa lista, não digitado). Fica no histórico quem registrou e quem autorizou, e
--     quem autorizou é avisado em nome próprio.

-- 1) Vínculo do item cotado com o item do pedido.
alter table public.cotacao_produtos add column if not exists material_request_item_id uuid references public.material_request_items (id) on delete set null;
create index if not exists idx_cotacao_produtos_item_pedido on public.cotacao_produtos (material_request_item_id) where material_request_item_id is not null;

-- 2) Ramos.
create table if not exists public.compras_ramos (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  material_request_id uuid not null references public.material_requests (id) on delete cascade,
  supplier_id         uuid references public.suppliers (id) on delete set null,
  fornecedor          text not null check (length(btrim(fornecedor)) between 2 and 200),
  situacao            text not null default 'aguardando' check (situacao in ('aguardando', 'cotado', 'cancelado')),
  cotacao_id          bigint references public.cotacoes (id) on delete set null,
  criado_por          uuid references public.profiles (id) on delete set null,
  criado_por_nome     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_compras_ramos_pedido on public.compras_ramos (organization_id, material_request_id);
create table if not exists public.compras_ramo_itens (
  ramo_id uuid not null references public.compras_ramos (id) on delete cascade,
  item_id uuid not null references public.material_request_items (id) on delete cascade,
  primary key (ramo_id, item_id)
);
alter table public.compras_ramos enable row level security;
alter table public.compras_ramo_itens enable row level security;
drop policy if exists compras_ramos_read on public.compras_ramos;
create policy compras_ramos_read on public.compras_ramos for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('compras.cotacoes')));
drop policy if exists compras_ramo_itens_read on public.compras_ramo_itens;
create policy compras_ramo_itens_read on public.compras_ramo_itens for select to authenticated
  using (exists (select 1 from public.compras_ramos r where r.id = ramo_id));
revoke insert, update, delete on public.compras_ramos, public.compras_ramo_itens from anon, authenticated;
grant select on public.compras_ramos, public.compras_ramo_itens to authenticated;

alter table public.cotacoes add column if not exists ramo_id uuid references public.compras_ramos (id) on delete set null;
alter table public.cotacoes add column if not exists autorizado_por_id uuid references public.profiles (id) on delete set null;
alter table public.compras_convites add column if not exists ramo_id uuid references public.compras_ramos (id) on delete set null;

-- 3) Situação de cada item do pedido, pelo que as cotações e os ramos dizem dele.
create or replace function public.compras_estado_itens(p_pedido uuid)
returns table (item_id uuid, estado text)
language sql stable security definer set search_path = public as $$
  select i.id,
    case
      when exists (select 1 from public.cotacao_produtos p join public.cotacoes c on c.id = p.cotacao_id
                   where p.material_request_item_id = i.id and c.deleted_at is null and p.status = 'APROVADO'
                     and (c.status = 'COMPRADO' or exists (select 1 from public.compras k where k.cotacao_id = c.id and k.produto = p.produto))) then 'comprado'
      when exists (select 1 from public.cotacao_produtos p join public.cotacoes c on c.id = p.cotacao_id
                   where p.material_request_item_id = i.id and c.deleted_at is null and p.status = 'APROVADO' and c.status in ('APROVADO', 'PENDENTE')) then 'aprovado'
      when exists (select 1 from public.cotacao_produtos p join public.cotacoes c on c.id = p.cotacao_id
                   where p.material_request_item_id = i.id and c.deleted_at is null and coalesce(p.status, 'PENDENTE') = 'PENDENTE' and c.status <> 'REJEITADO')
        or exists (select 1 from public.compras_ramo_itens ri join public.compras_ramos r on r.id = ri.ramo_id
                   where ri.item_id = i.id and (r.situacao = 'aguardando'
                     -- a cotação do ramo acabou de nascer e os itens dela ainda estão sendo gravados
                     or (r.situacao = 'cotado' and not exists (select 1 from public.cotacao_produtos p where p.cotacao_id = r.cotacao_id)))) then 'em_cotacao'
      when exists (select 1 from public.cotacao_produtos p join public.cotacoes c on c.id = p.cotacao_id
                   where p.material_request_item_id = i.id and c.deleted_at is null) then 'rejeitado'
      else 'aberto'
    end
  from public.material_request_items i
  where i.request_id = p_pedido;
$$;
revoke all on function public.compras_estado_itens(uuid) from public, anon, authenticated;

-- Situação do pedido pelos itens; null = pedido antigo sem vínculo por item (vale a regra antiga).
create or replace function public.compras_situacao_por_item(p_pedido uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  total int; comprado int; aprovado int; rejeitado int; aberto int;
  ocs int; encerradas int; recebidas int;
begin
  if not exists (select 1 from public.cotacao_produtos p join public.material_request_items i on i.id = p.material_request_item_id where i.request_id = p_pedido)
     and not exists (select 1 from public.compras_ramos r where r.material_request_id = p_pedido) then
    return null;
  end if;
  select count(*), count(*) filter (where estado = 'comprado'), count(*) filter (where estado = 'aprovado'),
         count(*) filter (where estado = 'rejeitado'), count(*) filter (where estado = 'aberto')
    into total, comprado, aprovado, rejeitado, aberto
  from public.compras_estado_itens(p_pedido);
  if total = 0 then return null; end if;
  if comprado = total then
    select count(*), count(*) filter (where exists (select 1 from public.receipts rc where rc.cotacao_id = c.id and rc.encerra_pedido)),
           count(*) filter (where exists (select 1 from public.receipts rc where rc.cotacao_id = c.id))
      into ocs, encerradas, recebidas
    from public.cotacoes c
    where c.material_request_id = p_pedido and c.deleted_at is null and exists (select 1 from public.compras k where k.cotacao_id = c.id);
    return case when ocs > 0 and encerradas = ocs then 'recebida' when recebidas > 0 then 'parcial' else 'comprada' end;
  end if;
  if comprado + aprovado = total then return 'aprovada'; end if;
  if rejeitado = total then return 'rejeitada'; end if;
  if aberto = total then return 'aberta'; end if;
  return 'em_cotacao';
end $$;
revoke all on function public.compras_situacao_por_item(uuid) from public, anon, authenticated;

-- 4) A situação do pedido segue os itens (e os avisos de sempre a quem pediu).
create or replace function public.almoxarifado_atualizar_solicitacao(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  req public.material_requests%rowtype;
  nova text;
  aprovador text;
  motivo text;
  link text;
  modulo text;
begin
  if p_request is null or current_setting('pecsil.adiar_pedido', true) = 'on' then return; end if;
  select * into req from public.material_requests where id = p_request for update;
  if req.id is null or req.status = 'cancelada' then return; end if;

  nova := public.compras_situacao_por_item(req.id);
  if nova is null then
    -- Pedido antigo (sem vínculo por item): regra de antes; recebido não volta.
    if req.status in ('recebida', 'parcial') then return; end if;
    select case
        when bool_or(c.status = 'COMPRADO') or exists (select 1 from public.compras k join public.cotacoes c2 on c2.id = k.cotacao_id where c2.material_request_id = p_request and c2.deleted_at is null) then 'comprada'
        when bool_or(c.status = 'APROVADO') then 'aprovada'
        when bool_or(c.status = 'PENDENTE') then 'em_cotacao'
        when count(*) > 0 then 'rejeitada'
        else 'aberta'
      end
      into nova
    from public.cotacoes c
    where c.material_request_id = p_request and c.deleted_at is null;
  end if;
  select max(c.aprovado_por) filter (where c.status in ('APROVADO', 'COMPRADO')), max(c.motivo_rejeicao) filter (where c.status = 'REJEITADO')
    into aprovador, motivo
  from public.cotacoes c where c.material_request_id = p_request and c.deleted_at is null;

  if nova is null or nova = req.status then return; end if;
  update public.material_requests set status = nova, updated_at = now() where id = req.id;

  if req.origem = 'FUNDICAO' then
    modulo := 'fundicao';
    link := '/?module=fundicao';
  else
    modulo := 'almoxarifado';
    link := '/?module=almoxarifado&secao=' || case when nova = 'comprada' then 'A%20caminho' else 'Solicita%C3%A7%C3%B5es' end;
  end if;
  if nova = 'em_cotacao' and req.status in ('aberta', 'rejeitada') then
    perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'info',
      format('Pedido #%s em cotação', req.numero), 'O Compras está cotando o material.', link);
  elsif nova = 'aprovada' then
    perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'info',
      format('Pedido #%s aprovado', req.numero), format('Cotação aprovada%s. Aguarde o aviso de compra.', coalesce(' por ' || aprovador, '')), link);
  elsif nova = 'rejeitada' then
    perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'attention',
      format('Pedido #%s rejeitado', req.numero), coalesce(motivo, 'Todas as cotações foram rejeitadas.'), link);
  elsif nova = 'comprada' then
    perform public.notify_feature(req.organization_id, 'almoxarifado.recebimento', 'operar', 'almoxarifado', 'info',
      format('Material comprado · pedido #%s%s', req.numero, case when req.origem = 'FUNDICAO' then ' (Fundição)' else '' end),
      'A compra foi feita. Confira o material e lance a nota quando chegar.', '/?module=almoxarifado&secao=A%20caminho');
    if not exists (select 1 from public.user_feature_grants g where g.profile_id = req.requested_by and g.feature_code = 'almoxarifado.recebimento' and g.level >= 'operar') then
      perform public.notify_profile(req.organization_id, req.requested_by, modulo, 'info',
        format('Material comprado · pedido #%s', req.numero), 'A compra foi feita e o material está a caminho.', link);
    end if;
  end if;
end $$;

-- Parte do pedido comprada (os outros itens seguem em cotação): o Almoxarifado é avisado desta OC.
create or replace function public.compras_avisar_parte_comprada(p_cotacao bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.cotacoes%rowtype;
  req public.material_requests%rowtype;
  itens text;
  faltam int;
begin
  select * into c from public.cotacoes where id = p_cotacao;
  if c.material_request_id is null then return; end if;
  select * into req from public.material_requests where id = c.material_request_id;
  if req.id is null or req.status in ('comprada', 'parcial', 'recebida', 'cancelada') then return; end if;
  select count(*) into faltam from public.compras_estado_itens(req.id) where estado <> 'comprado';
  if faltam = 0 then return; end if;
  select string_agg(p.produto, ', ' order by p.id) into itens from public.cotacao_produtos p where p.cotacao_id = c.id and p.status = 'APROVADO';
  perform public.notify_feature(req.organization_id, 'almoxarifado.recebimento', 'operar', 'almoxarifado', 'info',
    format('Parte do pedido #%s comprada · OC nº %s', req.numero, c.id),
    format('%s com %s. Falta(m) %s item(ns) do pedido, ainda em cotação.', coalesce(itens, 'Itens'), c.fornecedor, faltam),
    '/?module=almoxarifado&secao=A%20caminho');
  if not exists (select 1 from public.user_feature_grants g where g.profile_id = req.requested_by and g.feature_code = 'almoxarifado.recebimento' and g.level >= 'operar') then
    perform public.notify_profile(req.organization_id, req.requested_by, case when req.origem = 'FUNDICAO' then 'fundicao' else 'almoxarifado' end, 'info',
      format('Parte do pedido #%s comprada', req.numero), format('%s com %s. O resto segue em cotação.', coalesce(itens, 'Itens'), c.fornecedor),
      case when req.origem = 'FUNDICAO' then '/?module=fundicao' else '/?module=almoxarifado&secao=A%20caminho' end);
  end if;
end $$;
revoke all on function public.compras_avisar_parte_comprada(bigint) from public, anon, authenticated;

-- O recebimento de uma OC não fecha o pedido inteiro quando ainda há item sem comprar.
create or replace function public.material_requests_situacao_por_item()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.status in ('recebida', 'parcial') and new.status is distinct from old.status then
    v := public.compras_situacao_por_item(new.id);
    if v is not null then new.status := v; end if;
  end if;
  return new;
end $$;
drop trigger if exists material_requests_situacao_por_item on public.material_requests;
create trigger material_requests_situacao_por_item before update of status on public.material_requests
  for each row execute function public.material_requests_situacao_por_item();

-- Gatilhos: cotação (cabeçalho), itens cotados e compras recalculam o pedido.
create or replace function public.trg_cotacao_solicitacao()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.material_request_id is distinct from new.material_request_id then
    perform public.almoxarifado_atualizar_solicitacao(old.material_request_id);
  end if;
  perform public.almoxarifado_atualizar_solicitacao(new.material_request_id);
  if tg_op = 'UPDATE' and new.status = 'COMPRADO' and old.status is distinct from 'COMPRADO' then
    perform public.compras_avisar_parte_comprada(new.id);
  end if;
  return new;
end $$;

create or replace function public.trg_cotacao_produto_solicitacao()
returns trigger
language plpgsql security definer set search_path = public as $$
declare cot bigint := coalesce(new.cotacao_id, old.cotacao_id);
begin
  perform public.almoxarifado_atualizar_solicitacao((select material_request_id from public.cotacoes where id = cot));
  return null;
end $$;
drop trigger if exists cotacao_produtos_solicitacao on public.cotacao_produtos;
create trigger cotacao_produtos_solicitacao after insert or delete or update of status, material_request_item_id on public.cotacao_produtos
  for each row execute function public.trg_cotacao_produto_solicitacao();

create or replace function public.trg_compra_solicitacao()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.almoxarifado_atualizar_solicitacao((select material_request_id from public.cotacoes where id = new.cotacao_id));
  return null;
end $$;
drop trigger if exists compras_solicitacao on public.compras;
create trigger compras_solicitacao after insert on public.compras for each row execute function public.trg_compra_solicitacao();

-- O item cotado só pode apontar para um item do pedido da própria cotação.
create or replace function public.cotacao_produtos_item_do_pedido()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.material_request_item_id is not null and not exists (
    select 1 from public.material_request_items i join public.cotacoes c on c.material_request_id = i.request_id
    where i.id = new.material_request_item_id and c.id = new.cotacao_id) then
    raise exception 'O item não é do pedido desta cotação.' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists cotacao_produtos_item_do_pedido on public.cotacao_produtos;
create trigger cotacao_produtos_item_do_pedido before insert or update of material_request_item_id, cotacao_id on public.cotacao_produtos
  for each row execute function public.cotacao_produtos_item_do_pedido();

-- A cotação nascida de um ramo fecha o ramo ("cotado"); apagada, o ramo volta a aguardar preço.
create or replace function public.trg_cotacao_ramo()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ramo_id is null then return null; end if;
  if not exists (select 1 from public.compras_ramos r where r.id = new.ramo_id and r.organization_id = new.organization_id
                 and r.material_request_id is not distinct from new.material_request_id) then
    raise exception 'O ramo não é deste pedido.' using errcode = '23514';
  end if;
  if new.deleted_at is not null then
    update public.compras_ramos set situacao = 'aguardando', cotacao_id = null, updated_at = now()
    where id = new.ramo_id and cotacao_id = new.id and situacao = 'cotado';
  else
    update public.compras_ramos set situacao = 'cotado', cotacao_id = new.id, updated_at = now()
    where id = new.ramo_id and situacao = 'aguardando';
  end if;
  return null;
end $$;
drop trigger if exists cotacoes_ramo on public.cotacoes;
create trigger cotacoes_ramo after insert or update of ramo_id, deleted_at on public.cotacoes
  for each row execute function public.trg_cotacao_ramo();

-- 5) Ramos: encaminhar itens a um fornecedor e cancelar.
create or replace function public.compras_ramo_criar(p_pedido uuid, p_itens uuid[], p_supplier uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  ped public.material_requests%rowtype;
  nome text;
  r_id uuid;
  ruim text;
begin
  if org is null or not public.has_feature('compras.cotacoes', 'operar') then
    raise exception 'Encaminhar para cotação é de quem lança cotações no Compras.' using errcode = '42501';
  end if;
  select * into ped from public.material_requests where id = p_pedido and organization_id = org;
  if ped.id is null then raise exception 'Pedido de material não encontrado.'; end if;
  if ped.status in ('cancelada', 'recebida') then raise exception 'Este pedido já foi encerrado.'; end if;
  if coalesce(cardinality(p_itens), 0) = 0 then raise exception 'Marque ao menos um item do pedido.'; end if;
  if exists (select 1 from unnest(p_itens) x where not exists (select 1 from public.material_request_items i where i.id = x and i.request_id = ped.id)) then
    raise exception 'Há item que não é deste pedido.';
  end if;
  select coalesce(nullif(btrim(trade_name), ''), name) into nome from public.suppliers where id = p_supplier and organization_id = org and merged_into is null;
  if nome is null then raise exception 'Escolha o fornecedor no cadastro (ou cadastre-o na hora).'; end if;
  select string_agg(i.produto, ', ') into ruim from public.compras_estado_itens(ped.id) e join public.material_request_items i on i.id = e.item_id
  where e.item_id = any (p_itens) and e.estado = 'comprado';
  if ruim is not null then raise exception 'Já comprado: %.', ruim; end if;
  select string_agg(i.produto, ', ') into ruim from public.compras_ramos r join public.compras_ramo_itens ri on ri.ramo_id = r.id
    join public.material_request_items i on i.id = ri.item_id
  where r.material_request_id = ped.id and r.situacao = 'aguardando' and r.supplier_id = p_supplier and ri.item_id = any (p_itens);
  if ruim is not null then raise exception 'Já está aguardando preço com %: %.', nome, ruim; end if;

  insert into public.compras_ramos (organization_id, material_request_id, supplier_id, fornecedor, criado_por, criado_por_nome)
  values (org, ped.id, p_supplier, left(nome, 200), me, (select full_name from public.profiles where id = me))
  returning id into r_id;
  insert into public.compras_ramo_itens (ramo_id, item_id) select r_id, x from (select distinct unnest(p_itens) x) s;
  perform public.emit_module_event(org, 'compras', 'compras.ramo.criado', 'pedido', ped.id::text,
    format('Pedido nº %s · %s item(ns) encaminhado(s) a %s para cotar', ped.numero, cardinality(p_itens), nome),
    jsonb_build_object('ramo', r_id, 'fornecedor', nome, 'itens', cardinality(p_itens)));
  perform public.almoxarifado_atualizar_solicitacao(ped.id);
  return jsonb_build_object('id', r_id, 'fornecedor', nome);
end $$;
revoke all on function public.compras_ramo_criar(uuid, uuid[], uuid) from public, anon;
grant execute on function public.compras_ramo_criar(uuid, uuid[], uuid) to authenticated;

create or replace function public.compras_ramo_cancelar(p_ramo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  r public.compras_ramos%rowtype;
begin
  if org is null or not public.has_feature('compras.cotacoes', 'operar') then
    raise exception 'Cancelar o encaminhamento é de quem lança cotações no Compras.' using errcode = '42501';
  end if;
  update public.compras_ramos set situacao = 'cancelado', updated_at = now()
  where id = p_ramo and organization_id = org and situacao = 'aguardando' returning * into r;
  if r.id is null then raise exception 'Só dá para cancelar o que ainda aguarda preço.'; end if;
  update public.compras_convites set situacao = 'cancelado' where ramo_id = r.id and situacao = 'aberto';
  perform public.emit_module_event(org, 'compras', 'compras.ramo.cancelado', 'pedido', r.material_request_id::text,
    format('Encaminhamento a %s cancelado', r.fornecedor), jsonb_build_object('ramo', r.id, 'fornecedor', r.fornecedor));
  perform public.almoxarifado_atualizar_solicitacao(r.material_request_id);
end $$;
revoke all on function public.compras_ramo_cancelar(uuid) from public, anon;
grant execute on function public.compras_ramo_cancelar(uuid) to authenticated;

-- 6) Quem pode autorizar uma compra imediata: quem aprova compras. Só id e nome.
create or replace function public.compras_autorizadores()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not (public.has_feature('compras.cotacoes', 'operar') or public.has_feature('compras.realizadas', 'operar')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.full_name) order by p.full_name)
    from public.profiles p
    where p.organization_id = org and p.status = 'active' and (p.access_expires_at is null or p.access_expires_at > now())
      and exists (select 1 from public.user_feature_grants g where g.profile_id = p.id and g.organization_id = org
                  and g.feature_code = 'compras.aprovacoes' and g.level >= 'aprovar')), '[]'::jsonb);
end $$;
revoke all on function public.compras_autorizadores() from public, anon;
grant execute on function public.compras_autorizadores() to authenticated;

-- 7) Compra direta / imediata: pode nascer de um pedido (itens ligados) e com o autorizador escolhido
--    na lista (registrado pelo id, com aviso a ele).
create or replace function public.compras_direta_registrar(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = me);
  cot public.cotacoes%rowtype;
  ped public.material_requests%rowtype;
  item jsonb;
  fornecedor text := nullif(btrim(coalesce(p ->> 'fornecedor', '')), '');
  autorizado text := nullif(btrim(coalesce(p ->> 'autorizado_por', '')), '');
  autorizador uuid := nullif(p ->> 'autorizado_por_id', '')::uuid;
  fornecedor_id uuid := nullif(p ->> 'supplier_id', '')::uuid;
  quando date := coalesce(nullif(p ->> 'data_compra', '')::date, current_date);
  item_ped uuid;
  qtd numeric;
  vu numeric;
  n int := 0;
  ruim text;
begin
  if org is null or not (public.has_feature('compras.cotacoes', 'operar') or public.has_feature('compras.realizadas', 'operar')) then
    raise exception 'Sem permissão para registrar compra direta.' using errcode = '42501';
  end if;
  if fornecedor_id is not null then
    select coalesce(nullif(btrim(trade_name), ''), name) into fornecedor from public.suppliers where id = fornecedor_id and organization_id = org;
    if fornecedor is null then raise exception 'Fornecedor não encontrado no cadastro.'; end if;
  end if;
  if fornecedor is null then raise exception 'Informe o fornecedor.'; end if;
  if autorizador is not null then
    select pr.full_name into autorizado from public.profiles pr
    where pr.id = autorizador and pr.organization_id = org and pr.status = 'active'
      and exists (select 1 from public.user_feature_grants g where g.profile_id = pr.id and g.organization_id = org and g.feature_code = 'compras.aprovacoes' and g.level >= 'aprovar');
    if autorizado is null then raise exception 'Quem autoriza precisa ser alguém que aprova compras.'; end if;
  end if;
  if autorizado is null then raise exception 'Informe quem autorizou a compra direta.'; end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]'::jsonb)) = 0 then raise exception 'Inclua ao menos um item.'; end if;
  if nullif(p ->> 'material_request_id', '') is not null then
    select * into ped from public.material_requests where id = (p ->> 'material_request_id')::uuid and organization_id = org;
    if ped.id is null then raise exception 'Pedido de material não encontrado.'; end if;
    if ped.status in ('cancelada', 'recebida') then raise exception 'Este pedido já foi encerrado.'; end if;
    if autorizador is null then raise exception 'Escolha quem autorizou a compra imediata.'; end if;
    select string_agg(i.produto, ', ') into ruim from public.compras_estado_itens(ped.id) e join public.material_request_items i on i.id = e.item_id
    where e.estado = 'comprado' and e.item_id in (select nullif(x ->> 'pedido_item_id', '')::uuid from jsonb_array_elements(p -> 'itens') x);
    if ruim is not null then raise exception 'Já comprado: %.', ruim; end if;
  end if;

  -- O pedido é recalculado uma vez só, no fim (sem avisos de passagem).
  perform set_config('pecsil.adiar_pedido', 'on', true);
  perform set_config('pecsil.compra_direta', 'on', true);
  insert into public.cotacoes (organization_id, fornecedor, supplier_id, divisao, status, user_id, aprovado_por, data_decisao, origem, autorizado_por, autorizado_por_id,
    material_request_id, frete_tipo, frete_valor, seguro_valor, outras_despesas, prazo_entrega, observacao)
  values (org, left(fornecedor, 200), fornecedor_id,
    case when coalesce(ped.divisao, p ->> 'divisao') = 'FUNDICAO' then 'FUNDICAO' else 'USINAGEM' end, 'COMPRADO', '1',
    left(autorizado, 120), now(), 'direta', left(autorizado, 120), autorizador, ped.id,
    case when p ->> 'frete_tipo' in ('CIF', 'FOB', 'SEM') then p ->> 'frete_tipo' else 'CIF' end,
    greatest(coalesce((p ->> 'frete_valor')::numeric, 0), 0), greatest(coalesce((p ->> 'seguro_valor')::numeric, 0), 0),
    greatest(coalesce((p ->> 'outras_despesas')::numeric, 0), 0), nullif(p ->> 'prazo_entrega', '')::date,
    nullif(left(btrim(coalesce(p ->> 'observacao', '')), 2000), ''))
  returning * into cot;
  perform set_config('pecsil.compra_direta', 'off', true);

  for item in select * from jsonb_array_elements(p -> 'itens') loop
    n := n + 1;
    qtd := coalesce((item ->> 'quantidade')::numeric, 0);
    vu := coalesce((item ->> 'valor_unit')::numeric, 0);
    item_ped := case when ped.id is not null then nullif(item ->> 'pedido_item_id', '')::uuid end;
    if nullif(btrim(coalesce(item ->> 'produto', '')), '') is null or qtd <= 0 or vu < 0 then
      raise exception 'Item %: informe o produto, a quantidade e o valor.', n;
    end if;
    insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status, material_id, material_request_item_id)
    values (cot.id, left(btrim(item ->> 'produto'), 300), vu, qtd, coalesce(nullif(upper(btrim(item ->> 'unidade')), ''), 'UN'),
      coalesce((item ->> 'icms')::numeric, 0), coalesce((item ->> 'ipi')::numeric, 0), coalesce(item ->> 'prazo', ''), nullif(item ->> 'obs', ''), 'APROVADO',
      public.material_da_org(nullif(item ->> 'material_id', '')::uuid), item_ped);
    -- A compra registrada gera a previsão a pagar e põe a OC em "A caminho" (gatilho atual).
    insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, data_compra, obs, material_id)
    values (org, cot.id, cot.fornecedor, left(btrim(item ->> 'produto'), 300), qtd, coalesce(nullif(upper(btrim(item ->> 'unidade')), ''), 'UN'),
      vu, round(qtd * vu, 2), quando, case when ped.id is not null then 'Compra imediata' else 'Compra direta' end, public.material_da_org(nullif(item ->> 'material_id', '')::uuid));
  end loop;
  perform set_config('pecsil.adiar_pedido', 'off', true);

  if ped.id is not null then
    perform public.almoxarifado_atualizar_solicitacao(ped.id);
    perform public.compras_avisar_parte_comprada(cot.id);
  end if;
  perform public.notify_feature(org, 'compras.aprovacoes', 'aprovar', 'compras', 'info',
    format('%s · OC nº %s · %s', case when ped.id is not null then 'Compra imediata' else 'Compra direta' end, cot.id, cot.fornecedor),
    format('Registrada no Compras por %s, autorizada por %s.', coalesce(meu_nome, '—'), autorizado), '/?module=compras&secao=diretas', coalesce(autorizador, me));
  if autorizador is not null then
    perform public.notify_profile(org, autorizador, 'compras', 'attention',
      format('Compra autorizada por você · OC nº %s', cot.id),
      format('%s registrou a compra com %s%s dizendo que você autorizou. Se não foi você, avise o Compras.', coalesce(meu_nome, 'O Compras'), cot.fornecedor,
        case when ped.id is not null then format(' (pedido nº %s)', ped.numero) else '' end),
      '/?module=compras&secao=diretas');
  end if;
  return jsonb_build_object('id', cot.id);
end $$;

-- O evento da compra direta leva também quem autorizou pelo id.
create or replace function public.events_compras_cotacao()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.origem = 'direta' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.direta.registrada', 'cotacao', new.id::text,
        format('OC nº %s · %s · %s · autorizada por %s', new.id, case when new.material_request_id is not null then 'compra imediata do pedido nº '
          || (select numero from public.material_requests where id = new.material_request_id) else 'compra direta' end,
          coalesce(new.fornecedor, 'fornecedor não informado'), coalesce(new.autorizado_por, '—')),
        jsonb_build_object('fornecedor', new.fornecedor, 'divisao', new.divisao, 'autorizado_por', new.autorizado_por, 'autorizado_por_id', new.autorizado_por_id,
          'pela_nota', new.receipt_id is not null, 'pedido', new.material_request_id, 'imediata', new.material_request_id is not null));
    else
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.criada', 'cotacao', new.id::text,
        format('Cotação nº %s lançada · %s', new.id, coalesce(new.fornecedor, 'fornecedor não informado')),
        jsonb_build_object('fornecedor', new.fornecedor, 'divisao', new.divisao, 'ramo', new.ramo_id));
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'APROVADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.aprovada', 'cotacao', new.id::text,
        format('Cotação nº %s aprovada: agora é a OC nº %s · %s', new.id, new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'aprovado_por', new.aprovado_por, 'de', old.status));
    elsif new.status = 'REJEITADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.rejeitada', 'cotacao', new.id::text,
        format('Cotação nº %s rejeitada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'motivo', new.motivo_rejeicao, 'de', old.status));
    elsif new.status = 'COMPRADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.comprada', 'cotacao', new.id::text,
        format('OC nº %s comprada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'de', old.status));
    elsif new.status = 'PENDENTE' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.reaberta', 'cotacao', new.id::text,
        format('Cotação nº %s voltou para aprovação · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'de', old.status));
    end if;
  end if;
  return new;
end $$;

-- 8) Convite por link de um ramo: o fornecedor vê só os itens do ramo; a resposta fecha o ramo.
drop function if exists public.compras_convite_criar(uuid, uuid, text, int);
create or replace function public.compras_convite_criar(p_pedido uuid, p_supplier uuid, p_fornecedor text, p_dias int default 7, p_ramo uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  ped public.material_requests%rowtype;
  ramo public.compras_ramos%rowtype;
  nome text := nullif(btrim(coalesce(p_fornecedor, '')), '');
  fornecedor_id uuid := p_supplier;
  codigo text;
  v_id uuid;
  dias int := least(greatest(coalesce(p_dias, 7), 1), 30);
begin
  if org is null or not public.has_feature('compras.cotacoes', 'operar') then
    raise exception 'Convidar fornecedor é de quem lança cotações no Compras.' using errcode = '42501';
  end if;
  select * into ped from public.material_requests where id = p_pedido and organization_id = org;
  if ped.id is null then raise exception 'Pedido de material não encontrado.'; end if;
  if ped.status in ('cancelada', 'recebida', 'comprada', 'parcial') then raise exception 'Este pedido já não está em cotação.'; end if;
  if p_ramo is not null then
    select * into ramo from public.compras_ramos where id = p_ramo and organization_id = org and material_request_id = ped.id;
    if ramo.id is null then raise exception 'Encaminhamento não encontrado neste pedido.'; end if;
    if ramo.situacao <> 'aguardando' then raise exception 'Este encaminhamento já não aguarda preço.'; end if;
    fornecedor_id := ramo.supplier_id;
    nome := ramo.fornecedor;
  elsif fornecedor_id is not null then
    select coalesce(nullif(btrim(trade_name), ''), name) into nome from public.suppliers where id = fornecedor_id and organization_id = org;
    if nome is null then raise exception 'Fornecedor não encontrado no cadastro.'; end if;
  end if;
  if nome is null or length(nome) < 2 then raise exception 'Informe o fornecedor.'; end if;
  -- Um convite aberto por fornecedor e pedido (ou por ramo): o novo substitui o anterior.
  update public.compras_convites set situacao = 'cancelado'
  where organization_id = org and material_request_id = ped.id and situacao = 'aberto'
    and ramo_id is not distinct from p_ramo
    and (supplier_id = fornecedor_id or (fornecedor_id is null and supplier_id is null and lower(fornecedor) = lower(nome)));
  codigo := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.compras_convites (organization_id, material_request_id, supplier_id, fornecedor, token_hash, expira_em, criado_por, criado_por_nome, ramo_id)
  values (org, ped.id, fornecedor_id, nome, encode(digest(codigo, 'sha256'), 'hex'), now() + make_interval(days => dias), me,
    (select full_name from public.profiles where id = me), p_ramo)
  returning id into v_id;
  perform public.emit_module_event(org, 'compras', 'compras.convite.criado', 'pedido', ped.id::text,
    format('Convite de cotação · pedido nº %s · %s', ped.numero, nome), jsonb_build_object('convite', v_id, 'dias', dias, 'ramo', p_ramo));
  return jsonb_build_object('id', v_id, 'codigo', codigo, 'expira_em', now() + make_interval(days => dias), 'fornecedor', nome);
end $$;
revoke all on function public.compras_convite_criar(uuid, uuid, text, int, uuid) from public, anon;
grant execute on function public.compras_convite_criar(uuid, uuid, text, int, uuid) to authenticated;
grant select (ramo_id) on public.compras_convites to authenticated;

create or replace function public.compras_convite_ler(p_codigo text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.compras_convites%rowtype;
  ped public.material_requests%rowtype;
  empresa text;
begin
  select * into c from public.compras_convites where token_hash = encode(digest(coalesce(p_codigo, ''), 'sha256'), 'hex');
  if c.id is null then return jsonb_build_object('situacao', 'inexistente'); end if;
  select * into ped from public.material_requests where id = c.material_request_id;
  select coalesce(nullif(f.razao_social, ''), o.legal_name, o.display_name) into empresa
  from public.organizations o left join public.fiscal_config f on f.organization_id = o.id where o.id = c.organization_id;
  if c.situacao = 'aberto' and c.aberto_em is null then update public.compras_convites set aberto_em = now() where id = c.id; end if;
  return jsonb_build_object(
    'situacao', case when c.situacao = 'aberto' and c.expira_em < now() then 'expirado' else c.situacao end,
    'empresa', empresa, 'fornecedor', c.fornecedor, 'expira_em', c.expira_em, 'respondido_em', c.respondido_em,
    'pedido', ped.numero, 'precisa_ate', ped.precisa_ate,
    'itens', case when c.situacao = 'aberto' and c.expira_em >= now() then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'produto', coalesce(m.descricao, i.produto), 'codigo', m.codigo, 'quantidade', i.quantidade,
        'unidade', i.unidade, 'observacao', i.observacao) order by i.ordem)
      from public.material_request_items i left join public.materials m on m.id = i.material_id
      where i.request_id = ped.id
        and (c.ramo_id is null or exists (select 1 from public.compras_ramo_itens ri where ri.ramo_id = c.ramo_id and ri.item_id = i.id))), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;
revoke all on function public.compras_convite_ler(text) from public, anon, authenticated;
grant execute on function public.compras_convite_ler(text) to service_role;

create or replace function public.compras_convite_responder(
  p_codigo text, p_itens jsonb, p_prazo_entrega date, p_condicao text, p_frete_tipo text, p_frete_valor numeric,
  p_observacao text, p_ip inet, p_navegador text,
  p_arquivo_nome text, p_arquivo_mime text, p_arquivo_tamanho bigint, p_arquivo_sha256 text, p_arquivo_caminho text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.compras_convites%rowtype;
  ped public.material_requests%rowtype;
  cot bigint;
  doc uuid;
  n int := 0;
  it record;
  condicao text := left(nullif(btrim(coalesce(p_condicao, '')), ''), 120);
  ramo uuid;
begin
  select * into c from public.compras_convites where token_hash = encode(digest(coalesce(p_codigo, ''), 'sha256'), 'hex') for update;
  if c.id is null then raise exception 'Link inválido.'; end if;
  if c.situacao = 'respondido' then raise exception 'Esta cotação já foi respondida por este link.'; end if;
  if c.situacao = 'cancelado' then raise exception 'Este link foi cancelado pela empresa.'; end if;
  if c.expira_em < now() then raise exception 'Este link venceu. Peça um novo à empresa.'; end if;
  if condicao is null then raise exception 'Informe a condição de pagamento.'; end if;
  if p_frete_tipo not in ('CIF', 'FOB') then raise exception 'Frete inválido.'; end if;
  if p_prazo_entrega is not null and p_prazo_entrega < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'O prazo de entrega já passou.'; end if;
  select * into ped from public.material_requests where id = c.material_request_id;
  ramo := (select r.id from public.compras_ramos r where r.id = c.ramo_id and r.situacao = 'aguardando');

  insert into public.cotacoes (organization_id, fornecedor, supplier_id, status, user_id, divisao, material_request_id, ramo_id, prazo_entrega,
    frete_tipo, frete_valor, observacao, produto, valor_unit, quantidade, unidade, prazo)
  values (c.organization_id, c.fornecedor, c.supplier_id, 'PENDENTE', coalesce(c.criado_por::text, 'convite'), ped.divisao, ped.id, ramo, p_prazo_entrega,
    p_frete_tipo, greatest(coalesce(p_frete_valor, 0), 0),
    left(concat_ws(' · ', 'Respondida pelo fornecedor pelo link do portal', nullif(btrim(coalesce(p_observacao, '')), '')), 1000),
    null, null, null, null, condicao)
  returning id into cot;

  for it in
    select i.*, (x ->> 'valor_unit')::numeric v, coalesce((x ->> 'ipi')::numeric, 0) ipi, coalesce((x ->> 'quantidade')::numeric, i.quantidade) q, left(x ->> 'obs', 300) obs
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x
    join public.material_request_items i on i.id = (x ->> 'id')::uuid and i.request_id = ped.id
    where (x ->> 'valor_unit') is not null and (x ->> 'valor_unit')::numeric > 0
      and (c.ramo_id is null or exists (select 1 from public.compras_ramo_itens ri where ri.ramo_id = c.ramo_id and ri.item_id = i.id))
  loop
    if it.q <= 0 then raise exception 'Quantidade inválida em %.', it.produto; end if;
    if it.ipi < 0 or it.ipi > 100 then raise exception 'IPI inválido em %.', it.produto; end if;
    insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status, material_id, material_request_item_id)
    values (cot, it.produto, round(it.v, 4), it.q, it.unidade, 0, it.ipi, condicao, coalesce(it.obs, ''), 'PENDENTE', it.material_id, it.id);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Informe o preço de pelo menos um item.'; end if;

  if p_arquivo_caminho is not null then
    if p_arquivo_caminho not like c.organization_id::text || '/compras/%' then raise exception 'Caminho do arquivo inválido.'; end if;
    insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
      sha256, storage_path, version, source, entity_type, entity_id, uploaded_by_name)
    values (c.organization_id, 'compras', 'compras.cotacoes', left(format('Proposta · %s · cotação nº %s', c.fornecedor, cot), 200), 'Proposta de fornecedor',
      left(p_arquivo_nome, 255), p_arquivo_mime, coalesce(p_arquivo_tamanho, 0), lower(p_arquivo_sha256), p_arquivo_caminho, 1, 'envio',
      'cotacao', cot::text, left(c.fornecedor || ' (pelo link)', 200))
    returning id into doc;
  end if;

  update public.compras_convites set situacao = 'respondido', cotacao_id = cot, document_id = doc, respondido_em = now(),
    resposta_ip = p_ip, resposta_navegador = left(p_navegador, 300)
  where id = c.id;
  perform public.notify_feature(c.organization_id, 'compras.cotacoes', 'operar', 'compras', 'info',
    format('Fornecedor respondeu · pedido nº %s', ped.numero),
    format('%s enviou a cotação nº %s (%s item(ns)) pelo link do portal.', c.fornecedor, cot, n),
    '/?module=compras', null);
  perform public.emit_module_event(c.organization_id, 'compras', 'compras.convite.respondido', 'cotacao', cot::text,
    format('Cotação nº %s respondida pelo fornecedor %s pelo link', cot, c.fornecedor), jsonb_build_object('convite', c.id, 'itens', n, 'pedido', ped.numero));
  return jsonb_build_object('cotacao', cot, 'itens', n, 'documento', doc, 'organizacao', c.organization_id);
end $$;
revoke all on function public.compras_convite_responder(text, jsonb, date, text, text, numeric, text, inet, text, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.compras_convite_responder(text, jsonb, date, text, text, numeric, text, inet, text, text, text, bigint, text, text) to service_role;

-- 9) Itens já cotados nos pedidos atuais: liga pelo material do catálogo ou pelo mesmo texto (único no
--    pedido). Sem avisos: a situação de cada pedido é recalculada calada.
select set_config('pecsil.adiar_pedido', 'on', true);
update public.cotacao_produtos p set material_request_item_id = m.item_id
from (
  select p2.id produto_id, (array_agg(i.id))[1] item_id
  from public.cotacao_produtos p2
  join public.cotacoes c on c.id = p2.cotacao_id and c.material_request_id is not null
  join public.material_request_items i on i.request_id = c.material_request_id
    and ((p2.material_id is not null and p2.material_id = i.material_id) or upper(btrim(p2.produto)) = upper(btrim(i.produto)))
  where p2.material_request_item_id is null
  group by p2.id
  having count(*) = 1
) m
where p.id = m.produto_id;
select set_config('pecsil.adiar_pedido', 'off', true);
