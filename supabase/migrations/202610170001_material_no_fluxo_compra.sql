-- A-01 (roadmap) · PLANO-ALMOXARIFADO M2: o material do catálogo corre da solicitação à nota.
--   * material_id opcional nos itens da solicitação, da cotação, da compra e do recebimento;
--     texto livre continua valendo (o item sem material fica marcado "sem material").
--   * Recebimento guarda o código do produto do fornecedor (cProd), o CFOP e a quantidade na
--     unidade do estoque.
--   * De-para por fornecedor (CNPJ + código do fornecedor → material, com o fator de unidade):
--     aprende a cada recebimento confirmado; a próxima nota do mesmo fornecedor chega ligada.
--   * O recebimento NUNCA trava por falta de material (regra 2 do plano).

alter table public.material_request_items add column if not exists material_id uuid references public.materials(id) on delete restrict;
alter table public.cotacao_produtos add column if not exists material_id uuid references public.materials(id) on delete restrict;
alter table public.compras add column if not exists material_id uuid references public.materials(id) on delete restrict;
alter table public.receipt_items
  add column if not exists material_id uuid references public.materials(id) on delete restrict,
  add column if not exists codigo_fornecedor text check (codigo_fornecedor is null or length(codigo_fornecedor) <= 60),
  add column if not exists cfop text check (cfop is null or cfop ~ '^\d{4}$'),
  add column if not exists quantidade_estoque numeric;
create index if not exists idx_material_request_items_material on public.material_request_items (material_id) where material_id is not null;
create index if not exists idx_cotacao_produtos_material on public.cotacao_produtos (material_id) where material_id is not null;
create index if not exists idx_compras_material on public.compras (material_id) where material_id is not null;
create index if not exists idx_receipt_items_material on public.receipt_items (material_id) where material_id is not null;

create table if not exists public.material_codigos_fornecedor (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^\d{14}$'),
  supplier_id uuid references public.suppliers(id) on delete set null,
  codigo_fornecedor text not null check (length(codigo_fornecedor) between 1 and 60),
  descricao_fornecedor text,
  unidade_fornecedor text,
  material_id uuid not null references public.materials(id) on delete cascade,
  -- Quantas unidades do estoque vêm em 1 unidade do fornecedor (ex.: caixa com 12 = 12).
  fator numeric not null default 1 check (fator > 0),
  usos int not null default 1,
  ultimo_uso timestamptz not null default now(),
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, cnpj, codigo_fornecedor)
);
alter table public.material_codigos_fornecedor enable row level security;
drop policy if exists material_codigos_fornecedor_read on public.material_codigos_fornecedor;
create policy material_codigos_fornecedor_read on public.material_codigos_fornecedor for select to authenticated
using (organization_id = public.current_organization_id() and public.materiais_pode_ver());
revoke insert, update, delete on public.material_codigos_fornecedor from anon, authenticated;

-- Material escolhido na tela: tem de ser da organização (e ativo). Vazio = sem material.
create or replace function public.material_da_org(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_id is null then return null; end if;
  if not exists (select 1 from public.materials where id = p_id and organization_id = public.current_organization_id() and ativo) then
    raise exception 'Material não encontrado ou inativo no catálogo.';
  end if;
  return p_id;
end;
$$;
revoke all on function public.material_da_org(uuid) from public, anon;
grant execute on function public.material_da_org(uuid) to authenticated;

-- Corrigir o de-para (o material sugerido estava errado): quem recebe nota ou cadastra material.
create or replace function public.material_depara_definir(p_cnpj text, p_codigo text, p_material uuid, p_fator numeric default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not (public.has_feature('almoxarifado.recebimento', 'operar') or public.has_feature('almoxarifado.materiais', 'operar')) then
    raise exception 'Sem permissão para ligar o código do fornecedor ao material.' using errcode = '42501';
  end if;
  if p_material is null then
    delete from public.material_codigos_fornecedor where organization_id = org and cnpj = regexp_replace(p_cnpj, '\D', '', 'g') and codigo_fornecedor = upper(btrim(p_codigo));
    return;
  end if;
  perform public.material_da_org(p_material);
  insert into public.material_codigos_fornecedor (organization_id, cnpj, codigo_fornecedor, material_id, fator, criado_por)
  values (org, regexp_replace(p_cnpj, '\D', '', 'g'), upper(btrim(p_codigo)), p_material, coalesce(p_fator, 1), public.current_profile_id())
  on conflict (organization_id, cnpj, codigo_fornecedor) do update set material_id = excluded.material_id, fator = excluded.fator, ultimo_uso = now();
end;
$$;
revoke all on function public.material_depara_definir(text, text, uuid, numeric) from public, anon;
grant execute on function public.material_depara_definir(text, text, uuid, numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.almoxarifado_criar_solicitacao(p_divisao text, p_urgencia text, p_observacao text, p_itens jsonb)
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

  insert into public.material_requests (organization_id, divisao, urgencia, observacao, requested_by, requested_by_name)
  values (org, coalesce(nullif(p_divisao, ''), 'USINAGEM'), coalesce(nullif(p_urgencia, ''), 'normal'), nullif(trim(coalesce(p_observacao, '')), ''), me,
    (select full_name from public.profiles where id = me))
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

CREATE OR REPLACE FUNCTION public.fundicao_criar_pedido(p_urgencia text, p_observacao text, p_itens jsonb)
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

  insert into public.material_requests (organization_id, divisao, origem, urgencia, observacao, requested_by, requested_by_name)
  values (org, 'FUNDICAO', 'FUNDICAO', case when p_urgencia = 'urgente' then 'urgente' else 'normal' end,
    nullif(trim(coalesce(p_observacao, '')), ''), me, nome)
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

CREATE OR REPLACE FUNCTION public.compras_direta_registrar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  cot public.cotacoes%rowtype;
  item jsonb;
  fornecedor text := nullif(btrim(coalesce(p ->> 'fornecedor', '')), '');
  autorizado text := nullif(btrim(coalesce(p ->> 'autorizado_por', '')), '');
  quando date := coalesce(nullif(p ->> 'data_compra', '')::date, current_date);
  qtd numeric;
  vu numeric;
  n int := 0;
begin
  if org is null or not (public.has_feature('compras.cotacoes', 'operar') or public.has_feature('compras.realizadas', 'operar')) then
    raise exception 'Sem permissão para registrar compra direta.' using errcode = '42501';
  end if;
  if fornecedor is null then raise exception 'Informe o fornecedor.'; end if;
  if autorizado is null then raise exception 'Informe quem autorizou a compra direta.'; end if;
  if jsonb_array_length(coalesce(p -> 'itens', '[]'::jsonb)) = 0 then raise exception 'Inclua ao menos um item.'; end if;

  perform set_config('pecsil.compra_direta', 'on', true);
  insert into public.cotacoes (organization_id, fornecedor, divisao, status, user_id, aprovado_por, data_decisao, origem, autorizado_por,
    frete_tipo, frete_valor, seguro_valor, outras_despesas, prazo_entrega, observacao)
  values (org, left(fornecedor, 200), case when p ->> 'divisao' = 'FUNDICAO' then 'FUNDICAO' else 'USINAGEM' end, 'COMPRADO', '1',
    left(autorizado, 120), now(), 'direta', left(autorizado, 120),
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
    if nullif(btrim(coalesce(item ->> 'produto', '')), '') is null or qtd <= 0 or vu < 0 then
      raise exception 'Item %: informe o produto, a quantidade e o valor.', n;
    end if;
    insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status, material_id)
    values (cot.id, left(btrim(item ->> 'produto'), 300), vu, qtd, coalesce(nullif(upper(btrim(item ->> 'unidade')), ''), 'UN'),
      coalesce((item ->> 'icms')::numeric, 0), coalesce((item ->> 'ipi')::numeric, 0), coalesce(item ->> 'prazo', ''), nullif(item ->> 'obs', ''), 'APROVADO', public.material_da_org(nullif(item ->> 'material_id', '')::uuid));
    -- A compra registrada gera a previsão a pagar e põe a OC em "A caminho" (gatilho atual).
    insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, data_compra, obs, material_id)
    values (org, cot.id, cot.fornecedor, left(btrim(item ->> 'produto'), 300), qtd, coalesce(nullif(upper(btrim(item ->> 'unidade')), ''), 'UN'),
      vu, round(qtd * vu, 2), quando, 'Compra direta', public.material_da_org(nullif(item ->> 'material_id', '')::uuid));
  end loop;

  perform public.notify_feature(org, 'compras.aprovacoes', 'aprovar', 'compras', 'info',
    format('Compra direta · OC nº %s · %s', cot.id, cot.fornecedor),
    format('Registrada no Compras, autorizada por %s.', autorizado), '/?module=compras&secao=diretas', me);
  return jsonb_build_object('id', cot.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.almoxarifado_confirmar_recebimento(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  cot public.cotacoes%rowtype;
  req public.material_requests%rowtype;
  rec public.receipts%rowtype;
  valor numeric(18,2) := round(coalesce((p ->> 'valor_total')::numeric, 0), 2);
  nf text := nullif(trim(coalesce(p ->> 'nf_numero', '')), '');
  chave text := nullif(regexp_replace(coalesce(p ->> 'nf_chave', ''), '\D', '', 'g'), '');
  fornecedor text;
  emissao date := nullif(p ->> 'emissao', '')::date;
  recebido date := coalesce(nullif(p ->> 'recebido_em', '')::date, current_date);
  divergente boolean := coalesce((p ->> 'divergencia')::boolean, false);
  encerra boolean := coalesce((p ->> 'encerra_pedido')::boolean, true);
  direta boolean := coalesce((p ->> 'compra_direta')::boolean, false) and nullif(p ->> 'cotacao_id', '') is null;
  autorizado text := nullif(left(btrim(coalesce(p ->> 'autorizado_por', '')), 120), '');
  previsao public.finance_titles%rowtype;
  previsao_vence date;
  conta uuid;
  titulo uuid;
  entrada uuid;
  dup jsonb;
  item jsonb;
  n int := 0;
  soma_dups numeric(18,2);
  motivos text[] := '{}';
  divisao text;
  primeiro_venc date;
  qtd numeric;
  total_item numeric;
  mat uuid;
  cod text;
  fator numeric;
  depara public.material_codigos_fornecedor%rowtype;
  cnpj_nota text := nullif(regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), '');
begin
  if org is null or not public.has_feature('almoxarifado.recebimento', 'operar') then
    raise exception 'Sem permissão para lançar recebimento.' using errcode = '42501';
  end if;
  if nf is null then raise exception 'Informe o número da nota fiscal.'; end if;
  if valor <= 0 then raise exception 'Informe o valor total da nota.'; end if;
  -- 44 dígitos (NF-e, produto) ou 50 (NFS-e nacional, serviço). NFS-e municipal vem sem chave.
  if chave is not null and chave !~ '^(\d{44}|\d{50})$' then raise exception 'A chave de acesso tem 44 dígitos (NF-e) ou 50 (NFS-e nacional).'; end if;
  if divergente and length(trim(coalesce(p ->> 'divergencia_motivo', ''))) < 3 then
    raise exception 'Descreva a divergência (o que veio diferente do pedido).';
  end if;
  if direta and autorizado is null then raise exception 'Informe quem autorizou a compra direta.'; end if;

  if nullif(p ->> 'cotacao_id', '') is not null then
    select * into cot from public.cotacoes where id = (p ->> 'cotacao_id')::bigint and organization_id = org for update;
    if cot.id is null then raise exception 'Compra não encontrada.'; end if;
    if exists (select 1 from public.receipts where cotacao_id = cot.id and encerra_pedido) then
      raise exception 'Esta compra já foi recebida por completo.';
    end if;
    select * into req from public.material_requests where id = cot.material_request_id;
  end if;
  fornecedor := coalesce(cot.fornecedor, nullif(trim(coalesce(p ->> 'fornecedor', '')), ''));
  if fornecedor is null then raise exception 'Informe o fornecedor.'; end if;
  divisao := coalesce(nullif(p ->> 'divisao', ''), cot.divisao, req.divisao);

  -- Nota repetida: pela chave, ou pelo mesmo fornecedor e número já em Contas a pagar.
  if chave is not null and exists (select 1 from public.receipts where organization_id = org and nf_chave = chave) then
    raise exception 'Esta nota já foi lançada (mesma chave de acesso).';
  end if;
  if exists (select 1 from public.finance_titles where organization_id = org and direction = 'payable'
             and lower(counterparty_name) = lower(fornecedor) and document_number = nf and coalesce(source_module, '') <> 'legado') then
    raise exception 'Já existe conta a pagar da NF % de %.', nf, fornecedor;
  end if;

  -- Compra direta pela nota: a OC nasce aprovada e comprada, com o número da sequência das cotações.
  if direta then
    perform set_config('pecsil.compra_direta', 'on', true);
    insert into public.cotacoes (organization_id, fornecedor, divisao, status, user_id, aprovado_por, data_decisao, origem, autorizado_por, observacao)
    values (org, left(fornecedor, 200),
      case when divisao = 'FUNDICAO' or (divisao is null and coalesce((p -> 'centro' ->> 'fundicao')::boolean, false)) then 'FUNDICAO' else 'USINAGEM' end,
      'COMPRADO', '1', autorizado, now(), 'direta', autorizado, format('Compra direta registrada pelo recebimento da NF %s.', nf))
    returning * into cot;
    perform set_config('pecsil.compra_direta', 'off', true);
  end if;

  insert into public.receipts (organization_id, cotacao_id, material_request_id, supplier_id, fornecedor, cnpj, nf_numero, nf_serie, nf_chave,
    emissao, recebido_em, valor_total, base_icms, icms, ipi, divisao, com_xml, nfe_xml, encerra_pedido, divergencia, divergencia_motivo,
    observacao, received_by, received_by_name)
  values (org, cot.id, req.id, cot.supplier_id, fornecedor, nullif(regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), ''), nf,
    nullif(trim(coalesce(p ->> 'nf_serie', '')), ''), chave, emissao, recebido, valor,
    coalesce((p ->> 'base_icms')::numeric, 0), coalesce((p ->> 'icms')::numeric, 0), coalesce((p ->> 'ipi')::numeric, 0),
    divisao, nullif(p ->> 'xml', '') is not null, nullif(p ->> 'xml', ''), case when direta then true else encerra end, divergente,
    nullif(trim(coalesce(p ->> 'divergencia_motivo', '')), ''), nullif(trim(coalesce(p ->> 'observacao', '')), ''), me, meu_nome)
  returning * into rec;

  -- Cada item pode vir ligado a um material (escolhido na tela ou sugerido pelo de-para). Sem
  -- material, entra como sempre e fica na lista "sem material" (o recebimento nunca trava por isso).
  -- Com CNPJ, código do fornecedor e material, o de-para aprende: a próxima nota já chega ligada.
  for item in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    n := n + 1;
    mat := public.material_da_org(nullif(item ->> 'material_id', '')::uuid);
    cod := nullif(upper(btrim(coalesce(item ->> 'codigo', ''))), '');
    fator := coalesce(nullif(item ->> 'fator', '')::numeric, 1);
    if fator <= 0 then fator := 1; end if;
    if mat is null and cod is not null and cnpj_nota is not null then
      select * into depara from public.material_codigos_fornecedor
       where organization_id = org and cnpj = cnpj_nota and codigo_fornecedor = cod;
      if depara.id is not null then mat := depara.material_id; fator := depara.fator; end if;
    end if;
    insert into public.receipt_items (organization_id, receipt_id, ordem, descricao, quantidade, unidade, valor_total, material_id, codigo_fornecedor, cfop, quantidade_estoque)
    values (org, rec.id, n, coalesce(nullif(trim(item ->> 'descricao'), ''), 'Item ' || n), coalesce((item ->> 'quantidade')::numeric, 0),
      nullif(upper(trim(coalesce(item ->> 'unidade', ''))), ''), coalesce((item ->> 'valor_total')::numeric, 0),
      mat, cod, nullif(regexp_replace(coalesce(item ->> 'cfop', ''), '\D', '', 'g'), ''),
      case when mat is not null then round(coalesce((item ->> 'quantidade')::numeric, 0) * fator, 4) end);
    if mat is not null and cod is not null and cnpj_nota is not null then
      insert into public.material_codigos_fornecedor (organization_id, cnpj, supplier_id, codigo_fornecedor, descricao_fornecedor, unidade_fornecedor, material_id, fator, criado_por)
      values (org, cnpj_nota, cot.supplier_id, cod, left(coalesce(item ->> 'descricao', ''), 300), nullif(upper(trim(coalesce(item ->> 'unidade', ''))), ''), mat, fator, me)
      on conflict (organization_id, cnpj, codigo_fornecedor) do update
        set material_id = excluded.material_id, fator = excluded.fator, descricao_fornecedor = excluded.descricao_fornecedor,
            unidade_fornecedor = excluded.unidade_fornecedor, supplier_id = coalesce(excluded.supplier_id, material_codigos_fornecedor.supplier_id),
            usos = material_codigos_fornecedor.usos + 1, ultimo_uso = now();
    end if;
  end loop;

  -- Itens da OC da compra direta: os da nota (sem itens, um só, "conforme NF"). As linhas em
  -- `compras` não geram previsão (a conta real nasce aqui mesmo).
  if direta then
    perform set_config('pecsil.compra_direta', 'on', true);
    update public.cotacoes set receipt_id = rec.id where id = cot.id;
    perform set_config('pecsil.compra_direta', 'off', true);
    perform set_config('pecsil.compra_direta_recebida', 'on', true);
    for item in select to_jsonb(ri) from public.receipt_items ri where ri.receipt_id = rec.id order by ri.ordem loop
      qtd := case when coalesce((item ->> 'quantidade')::numeric, 0) > 0 then (item ->> 'quantidade')::numeric else 1 end;
      total_item := coalesce((item ->> 'valor_total')::numeric, 0);
      insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status, material_id)
      values (cot.id, left(item ->> 'descricao', 300), round(total_item / qtd, 4), qtd, coalesce(item ->> 'unidade', 'UN'), 0, 0, '', null, 'APROVADO', nullif(item ->> 'material_id', '')::uuid);
      insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, nf, data_compra, obs, material_id)
      values (org, cot.id, fornecedor, left(item ->> 'descricao', 300), qtd, coalesce(item ->> 'unidade', 'UN'), round(total_item / qtd, 4),
        total_item, nf, coalesce(emissao, recebido), 'Compra direta (pela nota)', nullif(item ->> 'material_id', '')::uuid);
    end loop;
    -- ICMS e IPI da nota como % sobre os itens: a OC fecha com o valor da nota (pode diferir em centavos).
    update public.cotacao_produtos p
       set icms = round(rec.icms / t.soma * 100, 2), ipi = round(rec.ipi / t.soma * 100, 2)
      from (select sum(valor_total) as soma from public.receipt_items where receipt_id = rec.id) t
     where p.cotacao_id = cot.id and t.soma > 0;
    if not exists (select 1 from public.cotacao_produtos where cotacao_id = cot.id) then
      insert into public.cotacao_produtos (cotacao_id, produto, valor_unit, quantidade, unidade, icms, ipi, prazo, obs, status)
      values (cot.id, format('Conforme NF %s', nf), valor, 1, 'UN', 0, 0, '', null, 'APROVADO');
      insert into public.compras (organization_id, cotacao_id, fornecedor, produto, quantidade, unidade, valor_unit, total, nf, data_compra, obs)
      values (org, cot.id, fornecedor, format('Conforme NF %s', nf), 1, 'UN', valor, valor, nf, coalesce(emissao, recebido), 'Compra direta (pela nota)');
    end if;
    perform set_config('pecsil.compra_direta_recebida', 'off', true);
  end if;

  -- Previsão da compra (se houver): dá a conta do plano e o vencimento de referência.
  if cot.id is not null and not direta then
    select * into previsao from public.finance_titles
     where organization_id = org and source_module = 'compras' and source_entity_id = cot.ref_id and is_forecast
     order by created_at limit 1 for update;
    select min(due_date) into previsao_vence from public.finance_installments where title_id = previsao.id;
  end if;
  conta := coalesce(previsao.chart_account_id, public.finance_suggest_account(org, cot.supplier_id, fornecedor));

  -- Duplicatas da nota; sem duplicata, uma parcela no vencimento previsto (ou 30 dias).
  for dup in select * from jsonb_array_elements(coalesce(p -> 'duplicatas', '[]'::jsonb)) loop
    if nullif(dup ->> 'vencimento', '') is not null and coalesce((dup ->> 'valor')::numeric, 0) > 0 then
      insert into public.receipt_installments (organization_id, receipt_id, numero, vencimento, valor)
      values (org, rec.id, nullif(dup ->> 'numero', ''), (dup ->> 'vencimento')::date, round((dup ->> 'valor')::numeric, 2));
    end if;
  end loop;
  select coalesce(sum(ri.valor), 0) into soma_dups from public.receipt_installments ri where ri.receipt_id = rec.id;
  if soma_dups = 0 then
    insert into public.receipt_installments (organization_id, receipt_id, numero, vencimento, valor)
    values (org, rec.id, '1', coalesce(previsao_vence, coalesce(emissao, recebido) + 30), valor);
  elsif abs(soma_dups - valor) > 0.05 then
    motivos := motivos || format('Duplicatas somam R$ %s e a nota R$ %s', public.brl(soma_dups), public.brl(valor));
  end if;

  if cot.id is null then motivos := motivos || 'Recebimento sem pedido de compra: conferir com o Compras'::text; end if;
  if divergente then motivos := motivos || ('Divergência no recebimento: ' || trim(p ->> 'divergencia_motivo')); end if;
  if conta is null then motivos := motivos || 'Conta do plano a definir'::text; end if;

  -- Conta a pagar real.
  insert into public.finance_titles (
    organization_id, direction, counterparty_name, supplier_id, document_number, document_type, description, notes,
    issue_date, competence_date, original_amount, chart_account_id, cost_center_id, status, approved_at,
    source_module, source_entity_id, needs_review, review_reason
  ) values (
    org, 'payable', fornecedor, cot.supplier_id, nf, 'NF',
    case when direta or cot.origem = 'direta' then format('Compra direta · OC nº %s · NF %s', cot.id, nf)
         when cot.id is not null then format('Compra · OC nº %s · NF %s', cot.id, nf)
         else format('NF %s · recebimento avulso', nf) end,
    nullif(trim(coalesce(p ->> 'observacao', '')), ''),
    coalesce(emissao, recebido), coalesce(emissao, recebido), valor, conta, cot.cost_center_id, 'approved', now(),
    'almoxarifado', rec.id, cardinality(motivos) > 0, nullif(array_to_string(motivos, '; '), '')
  ) returning id into titulo;

  n := 0;
  for dup in select to_jsonb(d) from public.receipt_installments d where d.receipt_id = rec.id order by d.vencimento, d.numero loop
    n := n + 1;
    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (org, titulo, n, (dup ->> 'vencimento')::date, (dup ->> 'valor')::numeric, 0,
      case when (dup ->> 'vencimento')::date < current_date then 'overdue' else 'pending' end::public.finance_installment_status);
  end loop;
  select min(ri.vencimento) into primeiro_venc from public.receipt_installments ri where ri.receipt_id = rec.id;
  -- Parcelas que não fecham com a nota: o título vale a soma delas.
  if soma_dups > 0 and abs(soma_dups - valor) > 0.05 then
    update public.finance_titles set original_amount = soma_dups where id = titulo;
  end if;
  if conta is not null then
    insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
    select org, titulo, conta, original_amount from public.finance_titles where id = titulo;
  end if;

  -- A previsão sai (pedido fechado ou nota cobre tudo) ou é abatida.
  if previsao.id is not null then
    if encerra or previsao.original_amount - valor <= 0 then
      delete from public.finance_titles where id = previsao.id;
    else
      update public.finance_titles set original_amount = original_amount - valor where id = previsao.id;
      update public.finance_installments set amount = amount - valor where title_id = previsao.id and installment_number = 1;
      update public.finance_title_allocations set amount = amount - valor where title_id = previsao.id
        and (select count(*) from public.finance_title_allocations where title_id = previsao.id) = 1;
    end if;
  end if;

  -- Painel do ICMS (centro e tipo vêm do formulário do recebimento).
  insert into public.fiscal_icms_entries (organization_id, competencia, emitida, recebida, fornecedor, fantasia, supplier_id, cnpj, nfe, serie, chave,
    valor, vlr_cobrado, base_icms, icms, ipi, tipo, fundicao, usinagem, administrativo, xml_ok, lancado, autorizado, obs, origem, receipt_id,
    created_by, created_by_name)
  values (org, date_trunc('month', recebido)::date, emissao, recebido, fornecedor, nullif(trim(coalesce(p ->> 'fantasia', '')), ''), cot.supplier_id,
    rec.cnpj, nf, rec.nf_serie, chave, valor, valor, rec.base_icms, rec.icms, rec.ipi, coalesce(nullif(p ->> 'tipo', ''), 'Material'),
    coalesce((p -> 'centro' ->> 'fundicao')::boolean, coalesce(divisao, '') = 'FUNDICAO'),
    coalesce((p -> 'centro' ->> 'usinagem')::boolean, coalesce(divisao, '') = 'USINAGEM'),
    coalesce((p -> 'centro' ->> 'administrativo')::boolean, false),
    rec.com_xml, true, false,
    coalesce(rec.divergencia_motivo, case when direta then format('Compra direta · OC nº %s', cot.id) end),
    'almoxarifado', rec.id, me, meu_nome)
  on conflict do nothing
  returning id into entrada;

  update public.receipts set finance_title_id = titulo, icms_entry_id = entrada where id = rec.id;

  if req.id is not null then
    update public.material_requests set status = case when encerra then 'recebida' else 'parcial' end, updated_at = now() where id = req.id;
  end if;

  perform public.notify_feature(org, 'financeiro.pagar', 'aprovar', 'financeiro',
    case when cardinality(motivos) > 0 then 'attention' else 'approval' end,
    format('Nota lançada · %s', fornecedor),
    format('NF %s · R$ %s · vence %s%s', nf, public.brl(valor), to_char(primeiro_venc, 'DD/MM/YYYY'),
      case when cardinality(motivos) > 0 then ' · ' || array_to_string(motivos, '; ') else '' end),
    '/?module=financeiro&secao=Contas%20a%20pagar', me);
  if direta then
    -- A OC da compra direta nasce pronta: o Compras (Kaylane) e quem aprova (Ricardo) ficam sabendo.
    perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras', 'info',
      format('Compra direta · OC nº %s · NF %s de %s', cot.id, nf, fornecedor),
      format('O Almoxarifado recebeu a nota e a OC nº %s foi gerada com os dados dela (autorizada por %s).', cot.id, autorizado),
      '/?module=compras&secao=diretas', me);
    perform public.notify_feature(org, 'compras.aprovacoes', 'aprovar', 'compras', 'info',
      format('Compra direta · OC nº %s · %s', cot.id, fornecedor),
      format('NF %s · R$ %s, autorizada por %s.', nf, public.brl(valor), autorizado), '/?module=compras&secao=diretas', me);
  elsif divergente or cot.id is null then
    perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras', 'attention',
      format('%s · NF %s de %s', case when divergente then 'Divergência no recebimento' else 'Nota sem pedido' end, nf, fornecedor),
      coalesce(rec.divergencia_motivo, 'O Almoxarifado recebeu material sem cotação no sistema.'),
      '/?module=compras&secao=compras', me);
  end if;

  perform public.emit_module_event(org, 'almoxarifado', 'almoxarifado.recebimento.confirmado', 'recebimento', rec.id::text,
    format('Recebido · NF %s de %s · R$ %s%s', nf, fornecedor, public.brl(valor), case when direta then format(' · OC nº %s (compra direta)', cot.id) else '' end),
    jsonb_build_object('numero', rec.numero, 'cotacao_id', cot.id, 'nf', nf, 'valor', valor, 'divergencia', divergente, 'titulo', titulo, 'compra_direta', direta));

  return jsonb_build_object('id', rec.id, 'numero', rec.numero, 'titulo', titulo, 'icms', entrada, 'revisar', array_to_string(motivos, '; '),
    'oc', case when direta then cot.id end);
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Ligação do histórico: as compras e os itens cotados de antes ganham uma SUGESTÃO de material
-- (por regra, sem IA): primeiro o código do material escrito no texto (2-01-00893), senão o nome
-- mais parecido do catálogo (semelhança de texto, com a nota à vista). Uma pessoa do Almoxarifado
-- ou do Compras confirma, troca ou pula cada texto; ligar vale para todas as linhas com o mesmo texto.
-- ---------------------------------------------------------------------------------------------
create index if not exists idx_materials_descricao_trgm on public.materials using gin (descricao_busca extensions.gin_trgm_ops);

create table if not exists public.material_historico_decisoes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  texto text not null,
  decisao text not null check (decisao in ('ligado', 'pulado')),
  material_id uuid references public.materials(id) on delete set null,
  linhas int not null default 0,
  decidido_por uuid references public.profiles(id) on delete set null,
  decidido_em timestamptz not null default now(),
  primary key (organization_id, texto)
);
alter table public.material_historico_decisoes enable row level security;
drop policy if exists material_historico_decisoes_read on public.material_historico_decisoes;
create policy material_historico_decisoes_read on public.material_historico_decisoes for select to authenticated
using (organization_id = public.current_organization_id() and public.materiais_pode_ver());
revoke insert, update, delete on public.material_historico_decisoes from anon, authenticated;

create or replace function public.material_historico_pode_ligar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('almoxarifado.materiais', 'operar') or public.has_feature('compras.cotacoes', 'operar');
$$;
grant execute on function public.material_historico_pode_ligar() to authenticated;

create or replace function public.material_texto_normal(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(translate(upper(btrim(coalesce(p, ''))), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'), '\s+', ' ', 'g');
$$;

-- Textos ainda sem material (compras, itens cotados, pedidos e recebimentos), do mais frequente ao
-- menos, com a sugestão. Os já decididos (ligados ou pulados) saem da lista.
create or replace function public.material_historico_pendente(p_limite int default 30, p_offset int default 0)
returns table (texto text, ocorrencias int, exemplo text, sugestao_id uuid, sugestao_codigo text, sugestao_descricao text, sugestao_unidade text, nota numeric, por text, total int)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not public.material_historico_pode_ligar() then
    raise exception 'Ligar o histórico é do Almoxarifado ou do Compras.' using errcode = '42501';
  end if;
  return query
  with linhas as (
    select produto as t from public.compras where organization_id = org and material_id is null
    union all select cp.produto from public.cotacao_produtos cp join public.cotacoes c on c.id = cp.cotacao_id where c.organization_id = org and cp.material_id is null and c.deleted_at is null
    union all select produto from public.material_request_items where organization_id = org and material_id is null
    union all select descricao from public.receipt_items where organization_id = org and material_id is null
  ), agrupado as (
    select public.material_texto_normal(t) as norm, count(*)::int as n, min(t) as ex
    from linhas where coalesce(btrim(t), '') <> '' group by 1
  ), pendente as (
    select a.*, count(*) over ()::int as tot from agrupado a
    where not exists (select 1 from public.material_historico_decisoes d where d.organization_id = org and d.texto = a.norm)
    order by a.n desc, a.norm
    limit least(greatest(coalesce(p_limite, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.norm, p.n, p.ex, s.id, s.codigo, s.descricao, s.unidade, s.nota, s.por, p.tot
  from pendente p
  left join lateral (
    (select m.id, m.codigo, m.descricao, m.unidade, 1.0::numeric as nota, 'codigo'::text as por
       from public.materials m
      where m.organization_id = org and m.ativo
        and m.codigo = (regexp_match(p.norm, '(\d-\d{2}-\d{5})'))[1]
      limit 1)
    union all
    (select m.id, m.codigo, m.descricao, m.unidade, round(similarity(m.descricao_busca, p.norm)::numeric, 2), 'nome'
       from public.materials m
      where m.organization_id = org and m.ativo and m.descricao_busca % p.norm
      order by similarity(m.descricao_busca, p.norm) desc
      limit 1)
    limit 1
  ) s on true
  order by p.n desc, p.norm;
end;
$$;
revoke all on function public.material_historico_pendente(int, int) from public, anon;
grant execute on function public.material_historico_pendente(int, int) to authenticated;

-- Ligar (ou pular) um texto: liga TODAS as linhas sem material com esse texto.
create or replace function public.material_historico_decidir(p_texto text, p_material uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  norm text := public.material_texto_normal(p_texto);
  n int := 0;
  k int;
begin
  if org is null or not public.material_historico_pode_ligar() then
    raise exception 'Ligar o histórico é do Almoxarifado ou do Compras.' using errcode = '42501';
  end if;
  if norm = '' then raise exception 'Texto vazio.'; end if;
  if p_material is not null then
    perform public.material_da_org(p_material);
    update public.compras set material_id = p_material where organization_id = org and material_id is null and public.material_texto_normal(produto) = norm;
    get diagnostics k = row_count; n := n + k;
    update public.cotacao_produtos cp set material_id = p_material from public.cotacoes c
     where c.id = cp.cotacao_id and c.organization_id = org and cp.material_id is null and public.material_texto_normal(cp.produto) = norm;
    get diagnostics k = row_count; n := n + k;
    update public.material_request_items set material_id = p_material where organization_id = org and material_id is null and public.material_texto_normal(produto) = norm;
    get diagnostics k = row_count; n := n + k;
    update public.receipt_items set material_id = p_material where organization_id = org and material_id is null and public.material_texto_normal(descricao) = norm;
    get diagnostics k = row_count; n := n + k;
  end if;
  insert into public.material_historico_decisoes (organization_id, texto, decisao, material_id, linhas, decidido_por)
  values (org, norm, case when p_material is null then 'pulado' else 'ligado' end, p_material, n, public.current_profile_id())
  on conflict (organization_id, texto) do update set decisao = excluded.decisao, material_id = excluded.material_id, linhas = excluded.linhas, decidido_por = excluded.decidido_por, decidido_em = now();
  perform public.emit_module_event(org, 'almoxarifado', 'almoxarifado.historico.ligado', 'material', coalesce(p_material::text, norm),
    case when p_material is null then format('Histórico pulado · %s', left(norm, 80)) else format('Histórico ligado ao material · %s (%s linhas)', left(norm, 80), n) end,
    jsonb_build_object('texto', norm, 'material', p_material, 'linhas', n));
  return n;
end;
$$;
revoke all on function public.material_historico_decidir(text, uuid) from public, anon;
grant execute on function public.material_historico_decidir(text, uuid) to authenticated;
