-- Financeiro: "histórico a conferir".
--
-- O relatório completo do sistema antigo traz títulos de 2013 a 2025 que ainda
-- aparecem em aberto lá (ex.: parcelas de 2019 que quase certamente foram pagas e
-- nunca baixadas). Entram marcados como histórico: ficam fora do "A pagar", do
-- painel e do fluxo de caixa, numa aba própria, até a equipe do financeiro
-- conferir cada um — registrar o pagamento, cancelar ou devolver para o em aberto.

alter table public.finance_titles
  add column if not exists is_historical boolean not null default false;

comment on column public.finance_titles.is_historical is
  'Título antigo trazido em aberto do sistema antigo, à espera de conferência. Fora dos totais até alguém decidir.';

create index if not exists idx_finance_titles_historical
  on public.finance_titles (organization_id, direction) where is_historical;

-- Resolvido (pago ou cancelado) deixa de ser histórico a conferir.
create or replace function public.finance_title_clear_historical()
returns trigger
language plpgsql
as $$
begin
  if new.is_historical and new.status in ('settled', 'cancelled') then
    new.is_historical := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_title_clear_historical on public.finance_titles;
create trigger trg_finance_title_clear_historical
  before update of status on public.finance_titles
  for each row execute function public.finance_title_clear_historical();

-- --- Carga: aceita "historical" em cada título ------------------------------------
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
      source_module, is_forecast, is_historical, needs_review, review_reason, legacy_key, approved_at
    ) values (
      p_org, p_direction, item ->> 'party', nullif(item ->> 'group', ''), nullif(item ->> 'document', ''), nullif(item ->> 'document_type', ''),
      item ->> 'history', nullif(item ->> 'notes', ''), (item ->> 'issue_date')::date, (item ->> 'issue_date')::date,
      amount, main_account, 'approved',
      'legado', coalesce((item ->> 'forecast')::boolean, false), coalesce((item ->> 'historical')::boolean, false), nullif(item ->> 'review_reason', '') is not null,
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
    -- atualiza parcela e título). O que passou do valor do título é juros/tarifa;
    -- o que faltou é desconto — lá o título consta pago, então quita aqui também.
    if item ->> 'paid_date' is not null then
      paid := coalesce((item ->> 'paid_amount')::numeric, amount);
      insert into public.finance_settlements (organization_id, installment_id, settlement_date, amount, interest, discount, payment_method, notes)
      values (p_org, new_installment, (item ->> 'paid_date')::date, least(paid, amount), greatest(paid - amount, 0), greatest(amount - paid, 0),
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

-- --- Fluxo de caixa: histórico em aberto fica fora do "em aberto" -----------------
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
    where t.status not in ('cancelled', 'settled') and not t.is_historical and i.status <> 'cancelled' and i.settled_amount < i.amount
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

-- --- Gasto por conta: histórico ainda não conferido fica fora --------------------
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
      and not (t.is_historical and t.status <> 'settled')
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
