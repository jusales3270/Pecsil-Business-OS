-- Almoxarifado: recebimento do material com a nota fiscal.
--
-- O almoxarife confere o material, anexa o XML da NF-e (ou digita a nota) e
-- confirma. Numa transação só, o banco:
--   1. grava o recebimento, os itens da nota e as duplicatas;
--   2. cria a CONTA A PAGAR real (uma parcela por duplicata), já aprovada — o gestor
--      aprovou a compra — com a conta do plano da previsão ou sugerida pelo histórico;
--   3. abate a PREVISÃO da compra (ou a apaga, quando o pedido fecha);
--   4. lança a nota no Painel do ICMS (módulo Fiscal);
--   5. atualiza o pedido de material e avisa quem paga (e o Compras, se houve divergência).
--
-- Nota sem pedido (chegou sem cotação) entra como "recebimento avulso", com "revisar".

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero bigint generated always as identity unique,
  cotacao_id bigint references public.cotacoes(id) on delete set null,
  material_request_id uuid references public.material_requests(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  fornecedor text not null,
  cnpj text,
  nf_numero text not null,
  nf_serie text,
  nf_chave text check (nf_chave is null or nf_chave ~ '^\d{44}$'),
  emissao date,
  recebido_em date not null default current_date,
  valor_total numeric(18,2) not null check (valor_total > 0),
  base_icms numeric(18,2) not null default 0,
  icms numeric(18,2) not null default 0,
  ipi numeric(18,2) not null default 0,
  divisao text,
  com_xml boolean not null default false,
  nfe_xml text,
  encerra_pedido boolean not null default true,
  divergencia boolean not null default false,
  divergencia_motivo text,
  observacao text,
  finance_title_id uuid references public.finance_titles(id) on delete set null,
  icms_entry_id uuid references public.fiscal_icms_entries(id) on delete set null,
  received_by uuid references public.profiles(id) on delete set null,
  received_by_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_receipts_chave on public.receipts (organization_id, nf_chave) where nf_chave is not null;
create index if not exists idx_receipts_org_data on public.receipts (organization_id, recebido_em desc);
create index if not exists idx_receipts_cotacao on public.receipts (cotacao_id) where cotacao_id is not null;

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  ordem int not null default 1,
  descricao text not null,
  quantidade numeric(14,4) not null default 0,
  unidade text,
  valor_total numeric(18,2) not null default 0
);
create index if not exists idx_receipt_items_receipt on public.receipt_items (receipt_id, ordem);

create table if not exists public.receipt_installments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  numero text,
  vencimento date not null,
  valor numeric(18,2) not null check (valor > 0)
);
create index if not exists idx_receipt_installments_receipt on public.receipt_installments (receipt_id, vencimento);

alter table public.fiscal_icms_entries
  drop constraint if exists fiscal_icms_entries_receipt_fk,
  add constraint fiscal_icms_entries_receipt_fk foreign key (receipt_id) references public.receipts(id) on delete set null;

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.receipt_installments enable row level security;

create or replace function public.can_read_receipts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('almoxarifado.recebimento') or public.has_feature('almoxarifado.solicitacoes')
      or public.has_feature('financeiro.pagar') or public.has_feature('fiscal.icms');
$$;

drop policy if exists receipts_read on public.receipts;
create policy receipts_read on public.receipts for select using (
  organization_id = (select public.current_organization_id()) and (select public.can_read_receipts())
);
drop policy if exists receipt_items_read on public.receipt_items;
create policy receipt_items_read on public.receipt_items for select using (
  organization_id = (select public.current_organization_id()) and (select public.can_read_receipts())
);
drop policy if exists receipt_installments_read on public.receipt_installments;
create policy receipt_installments_read on public.receipt_installments for select using (
  organization_id = (select public.current_organization_id()) and (select public.can_read_receipts())
);

-- --- Material a caminho ---------------------------------------------------------------
-- Compras com aviso de compra feito por esta plataforma (têm previsão) que ainda não
-- foram recebidas por completo. As compras antigas do app anterior não aparecem.
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

-- --- Confirmar o recebimento -----------------------------------------------------------
-- p: { cotacao_id?, fornecedor, cnpj?, nf_numero, nf_serie?, nf_chave?, emissao?, recebido_em?,
--      valor_total, base_icms?, icms?, ipi?, xml?, divisao?, tipo?, encerra_pedido?,
--      divergencia?, divergencia_motivo?, observacao?,
--      centro?: { fundicao, usinagem, administrativo },
--      itens?: [{ descricao, quantidade, unidade, valor_total }],
--      duplicatas?: [{ numero, vencimento, valor }] }
create or replace function public.almoxarifado_confirmar_recebimento(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if org is null or not public.has_feature('almoxarifado.recebimento', 'operar') then
    raise exception 'Sem permissão para lançar recebimento.' using errcode = '42501';
  end if;
  if nf is null then raise exception 'Informe o número da nota fiscal.'; end if;
  if valor <= 0 then raise exception 'Informe o valor total da nota.'; end if;
  if chave is not null and chave !~ '^\d{44}$' then raise exception 'A chave de acesso tem 44 dígitos.'; end if;
  if divergente and length(trim(coalesce(p ->> 'divergencia_motivo', ''))) < 3 then
    raise exception 'Descreva a divergência (o que veio diferente do pedido).';
  end if;

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

  insert into public.receipts (organization_id, cotacao_id, material_request_id, supplier_id, fornecedor, cnpj, nf_numero, nf_serie, nf_chave,
    emissao, recebido_em, valor_total, base_icms, icms, ipi, divisao, com_xml, nfe_xml, encerra_pedido, divergencia, divergencia_motivo,
    observacao, received_by, received_by_name)
  values (org, cot.id, req.id, cot.supplier_id, fornecedor, nullif(regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), ''), nf,
    nullif(trim(coalesce(p ->> 'nf_serie', '')), ''), chave, emissao, recebido, valor,
    coalesce((p ->> 'base_icms')::numeric, 0), coalesce((p ->> 'icms')::numeric, 0), coalesce((p ->> 'ipi')::numeric, 0),
    divisao, nullif(p ->> 'xml', '') is not null, nullif(p ->> 'xml', ''), encerra, divergente,
    nullif(trim(coalesce(p ->> 'divergencia_motivo', '')), ''), nullif(trim(coalesce(p ->> 'observacao', '')), ''), me, meu_nome)
  returning * into rec;

  for item in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    n := n + 1;
    insert into public.receipt_items (organization_id, receipt_id, ordem, descricao, quantidade, unidade, valor_total)
    values (org, rec.id, n, coalesce(nullif(trim(item ->> 'descricao'), ''), 'Item ' || n), coalesce((item ->> 'quantidade')::numeric, 0),
      nullif(upper(trim(coalesce(item ->> 'unidade', ''))), ''), coalesce((item ->> 'valor_total')::numeric, 0));
  end loop;

  -- Previsão da compra (se houver): dá a conta do plano e o vencimento de referência.
  if cot.id is not null then
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
    case when cot.id is not null then format('Compra · cotação #%s · NF %s', cot.id, nf) else format('NF %s · recebimento avulso', nf) end,
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

  -- Painel do ICMS.
  insert into public.fiscal_icms_entries (organization_id, competencia, emitida, recebida, fornecedor, fantasia, supplier_id, cnpj, nfe, serie, chave,
    valor, vlr_cobrado, base_icms, icms, ipi, tipo, fundicao, usinagem, administrativo, xml_ok, lancado, autorizado, obs, origem, receipt_id,
    created_by, created_by_name)
  values (org, date_trunc('month', recebido)::date, emissao, recebido, fornecedor, nullif(trim(coalesce(p ->> 'fantasia', '')), ''), cot.supplier_id,
    rec.cnpj, nf, rec.nf_serie, chave, valor, valor, rec.base_icms, rec.icms, rec.ipi, coalesce(nullif(p ->> 'tipo', ''), 'Material'),
    coalesce((p -> 'centro' ->> 'fundicao')::boolean, divisao = 'FUNDICAO'),
    coalesce((p -> 'centro' ->> 'usinagem')::boolean, divisao = 'USINAGEM'),
    coalesce((p -> 'centro' ->> 'administrativo')::boolean, false),
    rec.com_xml, true, false, rec.divergencia_motivo, 'almoxarifado', rec.id, me, meu_nome)
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
  if divergente or cot.id is null then
    perform public.notify_feature(org, 'compras.cotacoes', 'operar', 'compras', 'attention',
      format('%s · NF %s de %s', case when divergente then 'Divergência no recebimento' else 'Nota sem pedido' end, nf, fornecedor),
      coalesce(rec.divergencia_motivo, 'O Almoxarifado recebeu material sem cotação no sistema.'),
      '/?module=compras&secao=compras', me);
  end if;

  perform public.emit_module_event(org, 'almoxarifado', 'almoxarifado.recebimento.confirmado', 'recebimento', rec.id::text,
    format('Recebido · NF %s de %s · R$ %s', nf, fornecedor, public.brl(valor)),
    jsonb_build_object('numero', rec.numero, 'cotacao_id', cot.id, 'nf', nf, 'valor', valor, 'divergencia', divergente, 'titulo', titulo));

  return jsonb_build_object('id', rec.id, 'numero', rec.numero, 'titulo', titulo, 'icms', entrada, 'revisar', array_to_string(motivos, '; '));
end;
$$;
revoke all on function public.almoxarifado_confirmar_recebimento(jsonb) from public, anon;
grant execute on function public.almoxarifado_confirmar_recebimento(jsonb) to authenticated;
