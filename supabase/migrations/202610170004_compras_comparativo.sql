-- A-07 (roadmap) · comparativo de cotações com selos, regra de decisão e saving na OC.
--   * material_requests.precisa_ate: a data em que a produção precisa do material (opcional). É o
--     que a regra "primeiro quem entrega no prazo, depois o menor custo" usa.
--   * cotacoes.saving: a economia calculada na aprovação (contra a maior cotação concorrente do mesmo
--     pedido, contra a última compra dos mesmos itens e o ganho em dias de pagamento). Sai na OC.
--     A conta é a mesma da tela (lib/compras/comparativo.ts).

alter table public.material_requests add column if not exists precisa_ate date;
alter table public.cotacoes add column if not exists saving jsonb;

-- Pedido de material com "precisa até" (o parâmetro novo vai no fim, com padrão nulo).
drop function if exists public.almoxarifado_criar_solicitacao(text, text, text, jsonb);
drop function if exists public.fundicao_criar_pedido(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.almoxarifado_criar_solicitacao(p_divisao text, p_urgencia text, p_observacao text, p_itens jsonb, p_precisa_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if p_precisa_ate is not null and p_precisa_ate < current_date then raise exception 'A data em que a produção precisa do material já passou.'; end if;
  insert into public.material_requests (organization_id, divisao, urgencia, observacao, requested_by, requested_by_name, precisa_ate)
  values (org, coalesce(nullif(p_divisao, ''), 'USINAGEM'), coalesce(nullif(p_urgencia, ''), 'normal'), nullif(trim(coalesce(p_observacao, '')), ''), me,
    (select full_name from public.profiles where id = me), p_precisa_ate)
  returning * into req;

  for item in select * from jsonb_array_elements(p_itens) loop
    n := n + 1;
    if trim(coalesce(item ->> 'produto', '')) = '' then raise exception 'Item % sem descrição.', n; end if;
    if coalesce((item ->> 'quantidade')::numeric, 0) <= 0 then raise exception 'Item % sem quantidade.', n; end if;
    insert into public.material_request_items (organization_id, request_id, ordem, produto, quantidade, unidade, observacao, material_id)
    values (org, req.id, n, trim(item ->> 'produto'), (item ->> 'quantidade')::numeric,
      coalesce(nullif(upper(trim(item ->> 'unidade')), ''), 'UN'), nullif(trim(coalesce(item ->> 'observacao', '')), ''), public.material_da_org(nullif(item ->> 'material_id', '')::uuid));
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
$function$;
revoke all on function public.almoxarifado_criar_solicitacao(text, text, text, jsonb, date) from public, anon;
grant execute on function public.almoxarifado_criar_solicitacao(text, text, text, jsonb, date) to authenticated;

CREATE OR REPLACE FUNCTION public.fundicao_criar_pedido(p_urgencia text, p_observacao text, p_itens jsonb, p_precisa_ate date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if p_precisa_ate is not null and p_precisa_ate < current_date then raise exception 'A data em que a produção precisa do material já passou.'; end if;
  insert into public.material_requests (organization_id, divisao, origem, urgencia, observacao, requested_by, requested_by_name, precisa_ate)
  values (org, 'FUNDICAO', 'FUNDICAO', case when p_urgencia = 'urgente' then 'urgente' else 'normal' end,
    nullif(trim(coalesce(p_observacao, '')), ''), me, nome, p_precisa_ate)
  returning * into req;

  for item in select * from jsonb_array_elements(p_itens) loop
    n := n + 1;
    if trim(coalesce(item ->> 'produto', '')) = '' then raise exception 'Item % sem descrição.', n; end if;
    if coalesce((item ->> 'quantidade')::numeric, 0) <= 0 then raise exception 'Item % sem quantidade.', n; end if;
    insert into public.material_request_items (organization_id, request_id, ordem, produto, quantidade, unidade, observacao, material_id)
    values (org, req.id, n, trim(item ->> 'produto'), (item ->> 'quantidade')::numeric,
      coalesce(nullif(upper(trim(item ->> 'unidade')), ''), 'UN'), nullif(trim(coalesce(item ->> 'observacao', '')), ''), public.material_da_org(nullif(item ->> 'material_id', '')::uuid));
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
$function$;
revoke all on function public.fundicao_criar_pedido(text, text, jsonb, date) from public, anon;
grant execute on function public.fundicao_criar_pedido(text, text, jsonb, date) to authenticated;
