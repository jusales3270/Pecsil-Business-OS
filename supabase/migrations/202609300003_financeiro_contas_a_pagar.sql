-- ============================================================================
-- Financeiro › Contas a pagar: carga do sistema antigo, baixa com data e valor,
-- exclusão de título pago e números para fluxo de caixa e gasto por conta
-- ============================================================================
-- O relatório "Contas à Pagar/Pagas" de 2026 traz 5.640 títulos, dos quais
-- 4.439 já pagos (com data e valor). Para recebê-lo:
--
--   finance_import_titles   carga em lote das duas direções: título, parcela,
--                           rateio e, para o que já foi pago, a baixa em
--                           finance_settlements (juros quando pagou a maior).
--   carga em lote           não gera um evento nem uma linha de auditoria por
--                           registro: a função grava um resumo de cada.
--   finance_settle_title    baixa com data, valor e juros (é a baixa que alimenta
--                           o fluxo de caixa realizado).
--   finance_delete_title    exclui o título com as baixas dele, para quem aprova.
--   finance_cash_by_month   realizado e previsto por mês, para o fluxo de caixa.
--   finance_expense_by_account  gasto por conta do plano (pelo rateio).
-- ============================================================================

-- --- Carga em lote: sem ruído na auditoria e na trilha ---------------------------
create or replace function public.audit_finance_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  entity_uuid uuid;
  target_org uuid;
begin
  -- A carga do sistema antigo grava UMA linha de auditoria com o resumo (ver
  -- finance_import_titles), não uma por título, parcela e baixa.
  if current_setting('pecsil.carga_em_lote', true) = '1' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_uuid := nullif(row_data ->> 'id', '')::uuid;
  target_org := nullif(row_data ->> 'organization_id', '')::uuid;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_profile_id, module_code,
    event_type, entity_type, entity_id, risk_level, metadata
  ) values (
    target_org, auth.uid(), public.current_profile_id(), 'financeiro',
    tg_table_name || '.' || lower(tg_op), tg_table_name, entity_uuid,
    case when tg_table_name in ('finance_settlements', 'finance_reconciliations')
      then 'high' else 'normal' end,
    jsonb_build_object('operation', tg_op)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.events_cadastros_fornecedor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pecsil.carga_em_lote', true) = '1' then
    return new;
  end if;
  perform public.emit_module_event(new.organization_id, 'cadastros', 'cadastros.fornecedor.criado', 'fornecedor', new.id::text,
    format('Fornecedor cadastrado · %s', new.name), jsonb_build_object('tax_id', new.tax_id));
  return new;
end;
$$;

-- --- Carga de títulos do sistema antigo (pagar e receber) ------------------------
-- p_titles: lista de objetos
--   { legacy_key, group, party, document, document_type, history, notes,
--     issue_date, due_date, amount, forecast, review_reason,
--     paid_date, paid_amount,            -- só no que já foi pago
--     allocations: [{ code, amount }] }
-- Título com legacy_key já gravado é pulado; conta inexistente aborta o lote.
-- p_summary: grava o evento e a auditoria de resumo (no último lote da carga).
create or replace function public.finance_import_titles(p_org uuid, p_direction public.finance_title_direction, p_titles jsonb, p_summary boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  part jsonb;
  new_title uuid;
  new_installment uuid;
  main_account uuid;
  account uuid;
  amount numeric(18,2);
  paid numeric(18,2);
  inserted int := 0;
  skipped int := 0;
  settled int := 0;
  total numeric(18,2) := 0;
  label text := case p_direction when 'payable' then 'Contas a pagar' else 'Contas a receber' end;
  loaded record;
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'Organização não encontrada.';
  end if;
  perform set_config('pecsil.carga_em_lote', '1', true);

  for item in select * from jsonb_array_elements(p_titles) loop
    if exists (select 1 from public.finance_titles where organization_id = p_org and legacy_key = item ->> 'legacy_key') then
      skipped := skipped + 1;
      continue;
    end if;
    amount := (item ->> 'amount')::numeric;

    -- Conta principal: a de maior valor do rateio.
    main_account := null;
    select c.id into main_account
    from jsonb_array_elements(coalesce(item -> 'allocations', '[]'::jsonb)) a
    join public.finance_chart_accounts c on c.organization_id = p_org and c.code = a ->> 'code'
    order by (a ->> 'amount')::numeric desc
    limit 1;
    if main_account is null then
      raise exception 'Título % sem conta do plano válida.', item ->> 'legacy_key';
    end if;

    insert into public.finance_titles (
      organization_id, direction, counterparty_name, counterparty_group, document_number, document_type,
      description, notes, issue_date, competence_date, original_amount, chart_account_id, status,
      source_module, is_forecast, needs_review, review_reason, legacy_key, approved_at
    ) values (
      p_org, p_direction, item ->> 'party', nullif(item ->> 'group', ''), nullif(item ->> 'document', ''), nullif(item ->> 'document_type', ''),
      item ->> 'history', nullif(item ->> 'notes', ''), (item ->> 'issue_date')::date, (item ->> 'issue_date')::date,
      amount, main_account, 'approved',
      'legado', coalesce((item ->> 'forecast')::boolean, false), nullif(item ->> 'review_reason', '') is not null,
      nullif(item ->> 'review_reason', ''), item ->> 'legacy_key', now()
    ) returning id into new_title;

    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (p_org, new_title, 1, (item ->> 'due_date')::date, amount, 0,
      case when (item ->> 'due_date')::date < current_date then 'overdue' else 'pending' end::public.finance_installment_status)
    returning id into new_installment;

    for part in select * from jsonb_array_elements(coalesce(item -> 'allocations', '[]'::jsonb)) loop
      select id into account from public.finance_chart_accounts where organization_id = p_org and code = part ->> 'code';
      if account is null then
        raise exception 'Conta % não existe no plano (título %).', part ->> 'code', item ->> 'legacy_key';
      end if;
      insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
      values (p_org, new_title, account, (part ->> 'amount')::numeric);
    end loop;

    -- Já pago no sistema antigo: a baixa quita a parcela (o gatilho da baixa
    -- atualiza parcela e título). O que passou do valor do título é juros/tarifa.
    if item ->> 'paid_date' is not null then
      paid := coalesce((item ->> 'paid_amount')::numeric, amount);
      insert into public.finance_settlements (organization_id, installment_id, settlement_date, amount, interest, payment_method, notes)
      values (p_org, new_installment, (item ->> 'paid_date')::date, least(paid, amount), greatest(paid - amount, 0),
        nullif(item ->> 'document_type', ''), 'Baixa trazida do sistema antigo');
      settled := settled + 1;
    end if;

    inserted := inserted + 1;
    total := total + amount;
  end loop;

  if p_summary then
    select count(*) as titles, coalesce(sum(original_amount), 0) as amount, count(*) filter (where status = 'settled') as settled
      into loaded
    from public.finance_titles
    where organization_id = p_org and direction = p_direction and source_module = 'legado';
    perform public.emit_module_event(p_org, 'financeiro', 'financeiro.carga.concluida', 'carga',
      case p_direction when 'payable' then 'contas-a-pagar' else 'contas-a-receber' end,
      format('%s do sistema antigo carregadas · %s títulos · R$ %s', label, loaded.titles, public.brl(loaded.amount)),
      jsonb_build_object('direction', p_direction, 'titles', loaded.titles, 'settled', loaded.settled, 'amount', loaded.amount));
    insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
    values (p_org, auth.uid(), public.current_profile_id(), 'financeiro', 'finance_titles.import', 'finance_titles', null, 'high',
      jsonb_build_object('direction', p_direction, 'titles', loaded.titles, 'settled', loaded.settled, 'amount', loaded.amount, 'source', 'sistema antigo'));
  end if;
  return jsonb_build_object('inserted', inserted, 'skipped', skipped, 'settled', settled, 'amount', total);
end;
$$;
revoke all on function public.finance_import_titles(uuid, public.finance_title_direction, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.finance_import_titles(uuid, public.finance_title_direction, jsonb, boolean) to service_role;

-- --- Baixa com data, valor e juros ------------------------------------------------
-- Registrar pagamento/recebimento é de quem aprova na direção do título. O valor
-- vai até o saldo da parcela; o que passar dele entra como juros.
create or replace function public.finance_settle_title(p_title uuid, p_date date, p_amount numeric, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  title public.finance_titles%rowtype;
  installment record;
  remaining numeric(18,2) := round(p_amount, 2);
  open_amount numeric(18,2);
  applied numeric(18,2);
  pending int;
begin
  select * into title from public.finance_titles where id = p_title and organization_id = org;
  if title.id is null then
    raise exception 'Título não encontrado.';
  end if;
  if not public.has_feature(public.finance_direction_feature(title.direction), 'aprovar') then
    raise exception 'Sem permissão para registrar a baixa.' using errcode = '42501';
  end if;
  if title.status = 'cancelled' then
    raise exception 'Título cancelado não recebe baixa.';
  end if;
  if p_date is null or p_date > current_date + 1 then
    raise exception 'Informe a data da baixa (até hoje).';
  end if;
  if remaining is null or remaining <= 0 then
    raise exception 'Informe um valor maior que zero.';
  end if;

  select count(*) into pending from public.finance_installments
  where title_id = p_title and status <> 'cancelled' and settled_amount < amount;
  if pending = 0 then
    raise exception 'Este título já está quitado.';
  end if;

  for installment in
    select id, amount - settled_amount as saldo,
           row_number() over (order by due_date, installment_number) as ordem, count(*) over () as quantas
    from public.finance_installments
    where title_id = p_title and status <> 'cancelled' and settled_amount < amount
    order by due_date, installment_number
  loop
    exit when remaining <= 0;
    open_amount := installment.saldo;
    applied := least(remaining, open_amount);
    insert into public.finance_settlements (organization_id, installment_id, settlement_date, amount, interest, payment_method, notes, created_by_profile_id)
    values (org, installment.id, p_date, applied,
      -- O excedente (juros, multa, tarifa) vai inteiro na última parcela em aberto.
      case when installment.ordem = installment.quantas then greatest(remaining - open_amount, 0) else 0 end,
      title.document_type, nullif(btrim(coalesce(p_notes, '')), ''), public.current_profile_id());
    remaining := remaining - applied;
    if installment.ordem = installment.quantas then remaining := 0; end if;
  end loop;

  return (select jsonb_build_object('status', status) from public.finance_titles where id = p_title);
end;
$$;
revoke all on function public.finance_settle_title(uuid, date, numeric, text) from public;
grant execute on function public.finance_settle_title(uuid, date, numeric, text) to authenticated;

-- --- Excluir título, inclusive o que já tem baixa --------------------------------
-- A exclusão comum (policy de delete) para no primeiro título com baixa. Esta
-- apaga as baixas junto e deixa na trilha o que foi apagado.
create or replace function public.finance_delete_title(p_title uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  title public.finance_titles%rowtype;
begin
  select * into title from public.finance_titles where id = p_title and organization_id = org;
  if title.id is null then
    raise exception 'Título não encontrado.';
  end if;
  if not public.has_feature(public.finance_direction_feature(title.direction), 'aprovar') then
    raise exception 'Sem permissão para excluir o título.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.finance_reconciliations r
    join public.finance_settlements s on s.id = r.settlement_id
    join public.finance_installments i on i.id = s.installment_id
    where i.title_id = p_title
  ) then
    raise exception 'Este título tem baixa conciliada com o banco. Desfaça a conciliação antes de excluir.';
  end if;
  delete from public.finance_settlements s using public.finance_installments i
  where i.id = s.installment_id and i.title_id = p_title;
  delete from public.finance_titles where id = p_title;
end;
$$;
revoke all on function public.finance_delete_title(uuid) from public;
grant execute on function public.finance_delete_title(uuid) to authenticated;

-- --- Números prontos para a tela (o banco soma; a tela não baixa 6 mil títulos) ---
-- Roda com a permissão de quem chama: as policies dos títulos decidem o que entra.

-- Por mês do ano: realizado (baixas, pela data) e em aberto (pelo vencimento),
-- separando o que é previsão.
create or replace function public.finance_cash_by_month(p_year int)
returns table (month int, direction public.finance_title_direction, realized numeric, open_amount numeric, forecast_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with realizado as (
    select extract(month from s.settlement_date)::int as month, t.direction, sum(s.amount + s.interest + s.penalty - s.discount) as value
    from public.finance_settlements s
    join public.finance_installments i on i.id = s.installment_id
    join public.finance_titles t on t.id = i.title_id
    where s.reversed_at is null and extract(year from s.settlement_date) = p_year
    group by 1, 2
  ), aberto as (
    select extract(month from i.due_date)::int as month, t.direction,
      sum(i.amount - i.settled_amount) filter (where not t.is_forecast) as real_value,
      sum(i.amount - i.settled_amount) filter (where t.is_forecast) as forecast_value
    from public.finance_installments i
    join public.finance_titles t on t.id = i.title_id
    where t.status not in ('cancelled', 'settled') and i.status <> 'cancelled' and i.settled_amount < i.amount
      and extract(year from i.due_date) = p_year
    group by 1, 2
  ), eixo as (
    select m as month, d as direction from generate_series(1, 12) m cross join unnest(enum_range(null::public.finance_title_direction)) d
  )
  select e.month, e.direction, coalesce(r.value, 0), coalesce(a.real_value, 0), coalesce(a.forecast_value, 0)
  from eixo e
  left join realizado r on r.month = e.month and r.direction = e.direction
  left join aberto a on a.month = e.month and a.direction = e.direction
  order by e.month, e.direction;
$$;
grant execute on function public.finance_cash_by_month(int) to authenticated;

-- Gasto por conta do plano, pelo rateio dos títulos a pagar (sem previsão e sem
-- cancelado). p_basis: 'vencimento' | 'lancamento' | 'pagamento' (só o que foi pago).
create or replace function public.finance_expense_by_account(p_year int, p_basis text default 'vencimento')
returns table (month int, code text, name text, management_type public.finance_management_type, total numeric, titles bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select t.id,
      case p_basis
        when 'lancamento' then t.issue_date
        when 'pagamento' then (select max(s.settlement_date) from public.finance_settlements s join public.finance_installments i on i.id = s.installment_id where i.title_id = t.id and s.reversed_at is null)
        else (select min(i.due_date) from public.finance_installments i where i.title_id = t.id)
      end as ref_date
    from public.finance_titles t
    where t.direction = 'payable' and not t.is_forecast and t.status <> 'cancelled'
  )
  , linhas as (
    select a.title_id, a.chart_account_id, a.amount from public.finance_title_allocations a
    union all
    -- Título sem rateio gravado vale inteiro na conta dele.
    select t.id, t.chart_account_id, t.original_amount
    from public.finance_titles t
    where t.chart_account_id is not null
      and not exists (select 1 from public.finance_title_allocations a where a.title_id = t.id)
  )
  select extract(month from b.ref_date)::int, c.code, c.name, c.management_type, sum(a.amount), count(distinct b.id)
  from base b
  join linhas a on a.title_id = b.id
  join public.finance_chart_accounts c on c.id = a.chart_account_id
  where b.ref_date is not null and extract(year from b.ref_date) = p_year
  group by 1, 2, 3, 4
  order by 2, 1;
$$;
grant execute on function public.finance_expense_by_account(int, text) to authenticated;
