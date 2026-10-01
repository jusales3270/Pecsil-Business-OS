-- Financeiro › Contas a pagar: "Histórico a revisar" e arquivo.
--
-- Depois das cargas do sistema antigo o Contas a pagar tinha 16 mil títulos de 2013 a
-- 2030. Para o ano-calendário de 2026 o dono quer só:
--   • os PARCELAMENTOS/FINANCIAMENTOS (máquinas, empréstimos…) — com início, parcelas
--     pagas e a vencer — e os lançamentos antigos ainda "em aberto", para revisar um a
--     um: Aprovar (sobe para as contas certas), Excluir (sai do Financeiro) ou Editar;
--   • o resto do passado (pago antes de 2026) ARQUIVADO: fora das telas e totais, mas
--     guardado no banco e recuperável.
--
-- Série = mesmo fornecedor (ou grupo) e mesmo documento-base, sem a numeração da
-- parcela ("PARCELA 3 DE 54", "(PARC. 1/1)", "PC.03/05", "16/36").

alter table public.finance_titles
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text,
  add column if not exists review_series text,
  add column if not exists review_label text,
  add column if not exists review_state text check (review_state is null or review_state in ('pendente', 'aprovado'));

create index if not exists idx_finance_titles_ativos on public.finance_titles (organization_id, direction, status) where archived_at is null;
create index if not exists idx_finance_titles_review on public.finance_titles (organization_id, review_series) where review_series is not null;

-- Texto do documento + histórico sem a numeração de parcela: a "chave" da série.
create or replace function public.finance_series_key(p_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(upper(coalesce(p_text, '')),
    '\(?\s*P\s*A?\s*R\s*C\s*E?\s*L?\s*A?\.?\s*\d+\s*(DE|/)\s*\d+\s*\)?', ' ', 'g'),
    '(\mPC\.?\s*\d+\s*/\s*\d+|\m\d{1,3}\s*/\s*\d{1,3}\M)', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- --- Preparar a revisão e o arquivo (uma vez; rodar de novo só pega o que for novo) ---
create or replace function public.finance_prepare_review(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  resultado jsonb;
begin
  create temp table _rev on commit drop as
  with venc as (select title_id, min(due_date) venc from public.finance_installments group by 1),
  pago as (select i.title_id, max(s.settlement_date) pago_em from public.finance_settlements s
           join public.finance_installments i on i.id = s.installment_id where s.reversed_at is null group by 1),
  t as (
    select t.id, t.organization_id org, coalesce(t.counterparty_group, t.counterparty_name) forn, t.status, t.is_historical, v.venc, p.pago_em,
      upper(coalesce(t.document_number, '') || ' ' || coalesce(t.description, '')) txt
    from public.finance_titles t join venc v on v.title_id = t.id left join pago p on p.title_id = t.id
    where t.direction = 'payable' and t.archived_at is null and t.review_series is null
  ), k as (
    select *,
      -- Só é parcela de série quem tem numeração ou é financiamento; o mesmo texto sem
      -- numeração (retirada mensal, salário) não entra na série.
      (txt ~ '(P\s*A?\s*R\s*C\s*E?\s*L?\s*A?\.?\s*\d+\s*(DE|/)\s*\d+|\mPC\.?\s*\d+\s*/\s*\d+|\m\d{1,3}\s*/\s*\d{1,3}\M)'
        or txt ~ '(FINANC|EMPR[EÉ]STIMO|FINAME|CONS[OÓ]RCIO|LEASING|\mCDC\M|BNDES|PARCELAMENTO|CAPITAL DE GIRO|JUROS CAR[EÊ]NCIA|JRS CARE)'
        or forn ~* '^(banco|financeira)|leasing|caixa econ') serie,
      public.finance_series_key(txt) chave,
      -- Total de parcelas do plano ("DE 54", "/36"): separa planos diferentes com o mesmo texto.
      coalesce((regexp_match(txt, 'P\s*A?\s*R\s*C\s*E?\s*L?\s*A?\.?\s*\d+\s*(?:DE|/)\s*(\d+)'))[1],
               (regexp_match(txt, '\mPC\.?\s*\d+\s*/\s*(\d+)'))[1],
               (regexp_match(txt, '\m\d{1,3}\s*/\s*(\d{1,3})\M'))[1], '')::text plano,
      status not in ('settled', 'cancelled') and venc < '2026-01-01' parada
    from t
  ), g as (
    select org, forn, chave, serie, plano, bool_or(parada) tem_parada,
      bool_or(venc < '2026-01-01') and bool_or(venc >= '2026-01-01') cruza
    from k group by 1, 2, 3, 4, 5
  )
  select k.id, k.forn, k.chave, k.venc, k.status, k.is_historical, k.pago_em,
    case when g.serie and (g.tem_parada or g.cruza) then true
         when not g.serie and k.parada then true
         else false end revisar,
    left(md5(k.org::text || '|' || k.forn || '|' || k.chave || '|' || k.serie::text || '|' || k.plano), 16) serie_id
  from k join g using (org, forn, chave, serie, plano);

  select jsonb_build_object(
    'cartoes', (select count(distinct serie_id) from _rev where revisar),
    'titulos_revisao', (select count(*) from _rev where revisar),
    'titulos_arquivo', (select count(*) from _rev where not revisar and venc < '2026-01-01'
                          and ((status = 'settled' and pago_em < '2026-01-01') or (is_historical and status <> 'settled'))),
    'aplicado', p_apply) into resultado;

  if p_apply then
    perform set_config('pecsil.carga_em_lote', '1', true);
    update public.finance_titles t
       set review_series = r.serie_id, review_label = left(nullif(r.chave, ''), 160), review_state = 'pendente'
      from _rev r where r.id = t.id and r.revisar;
    update public.finance_titles t
       set archived_at = now(), archive_reason = case when r.status = 'settled' then 'Pago antes de 2026' else 'Lançamento antigo sem baixa' end
      from _rev r where r.id = t.id and not r.revisar and r.venc < '2026-01-01'
        -- Pago em 2026 (mesmo vencido antes) é caixa de 2026: fica.
        and ((r.status = 'settled' and r.pago_em < '2026-01-01') or (r.is_historical and r.status <> 'settled'));
    insert into public.audit_logs (organization_id, module_code, event_type, entity_type, risk_level, metadata)
    select o.id, 'financeiro', 'finance_titles.review_prepare', 'finance_titles', 'high', resultado from public.organizations o;
  end if;
  return resultado;
end;
$$;
revoke all on function public.finance_prepare_review(boolean) from public, anon, authenticated;

-- --- Lista para a tela -------------------------------------------------------------------
create or replace function public.finance_review_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if not public.has_feature('financeiro.pagar') then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(g order by (g ->> 'ativo')::boolean desc, (g ->> 'valorAberto')::numeric desc, g ->> 'fornecedor')
    from (
      select jsonb_build_object(
        'serie', t.review_series,
        'fornecedor', max(coalesce(t.counterparty_group, t.counterparty_name)),
        'documento', max(t.review_label),
        'conta', max(coalesce(c.code || ' ', '') || c.name),
        'contaId', (array_agg(t.chart_account_id::text order by t.issue_date) filter (where t.chart_account_id is not null))[1],
        'inicio', min(t.issue_date),
        'parcelas', count(*),
        'pagas', count(*) filter (where t.status = 'settled'),
        'valorPago', coalesce(sum(t.original_amount) filter (where t.status = 'settled'), 0),
        'abertas', count(*) filter (where t.status not in ('settled', 'cancelled')),
        'valorAberto', coalesce(sum(i.amount - i.settled_amount) filter (where t.status not in ('settled', 'cancelled')), 0),
        'primeiroVenc', min(i.due_date),
        'ultimoVenc', max(i.due_date),
        'proximoVenc', min(i.due_date) filter (where t.status not in ('settled', 'cancelled') and i.due_date >= current_date),
        'ativo', bool_or(i.due_date >= '2026-01-01'),
        'itens', jsonb_agg(jsonb_build_object(
          'id', t.id, 'lancamento', t.issue_date, 'vencimento', i.due_date, 'valor', t.original_amount,
          'pago', t.status = 'settled', 'pagoEm', (select max(s.settlement_date) from public.finance_settlements s where s.installment_id = i.id and s.reversed_at is null),
          'texto', coalesce(t.document_number, '') || case when t.document_number is not null and t.description is not null then ' · ' else '' end || coalesce(t.description, ''),
          'previsao', t.is_forecast) order by i.due_date, t.issue_date)
      ) g
      from public.finance_titles t
      join public.finance_installments i on i.title_id = t.id and i.installment_number = 1
      left join public.finance_chart_accounts c on c.id = t.chart_account_id
      where t.organization_id = org and t.direction = 'payable' and t.review_state = 'pendente'
      group by t.review_series
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.finance_review_groups() from public, anon;
grant execute on function public.finance_review_groups() to authenticated;

-- --- Aprovar: a série sobe para as contas certas ------------------------------------------
create or replace function public.finance_review_approve(p_series text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  n int;
  rotulo text;
begin
  if not public.has_feature('financeiro.pagar', 'aprovar') then
    raise exception 'Sem permissão para aprovar.' using errcode = '42501';
  end if;
  select max(coalesce(counterparty_group, counterparty_name)) || ' · ' || coalesce(max(review_label), '') into rotulo
    from public.finance_titles where organization_id = org and review_series = p_series and review_state = 'pendente';
  perform set_config('pecsil.carga_em_lote', '1', true);
  update public.finance_titles
     set review_state = 'aprovado', is_historical = false, archived_at = null, archive_reason = null,
         needs_review = false, review_reason = null, updated_at = now()
   where organization_id = org and review_series = p_series and review_state = 'pendente';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nada a aprovar nesta série (já foi revisada?).'; end if;
  perform public.emit_module_event(org, 'financeiro', 'financeiro.revisao.aprovada', 'serie', p_series,
    format('Histórico aprovado · %s · %s lançamentos', rotulo, n), jsonb_build_object('lancamentos', n));
  return jsonb_build_object('lancamentos', n);
end;
$$;
revoke all on function public.finance_review_approve(text) from public, anon;
grant execute on function public.finance_review_approve(text) to authenticated;

-- --- Excluir: a série sai do Financeiro, com as baixas ------------------------------------
create or replace function public.finance_review_delete(p_series text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  ids uuid[];
  rotulo text;
begin
  if not public.has_feature('financeiro.pagar', 'aprovar') then
    raise exception 'Sem permissão para excluir.' using errcode = '42501';
  end if;
  select array_agg(id), max(coalesce(counterparty_group, counterparty_name)) || ' · ' || coalesce(max(review_label), '')
    into ids, rotulo
    from public.finance_titles where organization_id = org and review_series = p_series and review_state = 'pendente';
  if ids is null then raise exception 'Nada a excluir nesta série (já foi revisada?).'; end if;
  if exists (select 1 from public.finance_reconciliations r join public.finance_settlements s on s.id = r.settlement_id
             join public.finance_installments i on i.id = s.installment_id where i.title_id = any(ids)) then
    raise exception 'Há baixa conciliada com o banco nesta série. Desfaça a conciliação antes de excluir.';
  end if;
  perform set_config('pecsil.carga_em_lote', '1', true);
  delete from public.finance_settlements s using public.finance_installments i where i.id = s.installment_id and i.title_id = any(ids);
  delete from public.finance_titles where id = any(ids);
  perform public.emit_module_event(org, 'financeiro', 'financeiro.revisao.excluida', 'serie', p_series,
    format('Histórico excluído · %s · %s lançamentos', rotulo, cardinality(ids)), jsonb_build_object('lancamentos', cardinality(ids)));
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, risk_level, metadata)
  values (org, auth.uid(), public.current_profile_id(), 'financeiro', 'finance_titles.review_delete', 'finance_titles', 'high',
    jsonb_build_object('serie', p_series, 'rotulo', rotulo, 'lancamentos', cardinality(ids)));
  return jsonb_build_object('lancamentos', cardinality(ids));
end;
$$;
revoke all on function public.finance_review_delete(text) from public, anon;
grant execute on function public.finance_review_delete(text) to authenticated;

-- --- Editar: dados da série e de cada parcela; opcionalmente aprova junto -----------------
-- p: { fornecedor?, descricao?, contaId?, aprovar?, itens?: [{ id, vencimento?, valor?, pago?, pagoEm? }] }
create or replace function public.finance_review_update(p_series text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  item jsonb;
  tit public.finance_titles%rowtype;
  parc public.finance_installments%rowtype;
  conta uuid := nullif(p ->> 'contaId', '')::uuid;
  novo_valor numeric(18,2);
  alterados int := 0;
begin
  if not public.has_feature('financeiro.pagar', 'operar') then
    raise exception 'Sem permissão para editar.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.finance_titles where organization_id = org and review_series = p_series and review_state = 'pendente') then
    raise exception 'Série não encontrada ou já revisada.';
  end if;
  if conta is not null and not exists (select 1 from public.finance_chart_accounts where id = conta and organization_id = org and allows_posting and active) then
    raise exception 'Conta do plano inválida (precisa aceitar lançamento).';
  end if;
  perform set_config('pecsil.carga_em_lote', '1', true);

  update public.finance_titles
     set counterparty_name = coalesce(nullif(trim(p ->> 'fornecedor'), ''), counterparty_name),
         counterparty_group = case when nullif(trim(p ->> 'fornecedor'), '') is not null then null else counterparty_group end,
         description = coalesce(nullif(trim(p ->> 'descricao'), ''), description),
         chart_account_id = coalesce(conta, chart_account_id),
         updated_at = now()
   where organization_id = org and review_series = p_series;
  if conta is not null then
    delete from public.finance_title_allocations a using public.finance_titles t
     where a.title_id = t.id and t.organization_id = org and t.review_series = p_series;
    insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
    select org, t.id, conta, t.original_amount from public.finance_titles t where t.organization_id = org and t.review_series = p_series;
  end if;

  for item in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    select * into tit from public.finance_titles where id = (item ->> 'id')::uuid and organization_id = org and review_series = p_series;
    if tit.id is null then continue; end if;
    select * into parc from public.finance_installments where title_id = tit.id order by installment_number limit 1;
    novo_valor := round(coalesce((item ->> 'valor')::numeric, tit.original_amount), 2);
    if novo_valor <= 0 then raise exception 'Valor inválido numa parcela.'; end if;

    -- Desmarcar "paga": a baixa sai antes de mexer no valor.
    if (item ->> 'pago') = 'false' and tit.status = 'settled' then
      delete from public.finance_settlements where installment_id = parc.id;
      select * into parc from public.finance_installments where id = parc.id;
    end if;
    if parc.settled_amount = 0 then
      update public.finance_titles set original_amount = novo_valor where id = tit.id and original_amount <> novo_valor;
      update public.finance_installments set amount = novo_valor,
        due_date = coalesce(nullif(item ->> 'vencimento', '')::date, due_date) where id = parc.id;
      update public.finance_title_allocations set amount = novo_valor where title_id = tit.id
        and (select count(*) from public.finance_title_allocations where title_id = tit.id) = 1;
    end if;
    -- Marcar "paga": baixa do saldo na data informada.
    if (item ->> 'pago') = 'true' and tit.status <> 'settled' then
      select * into parc from public.finance_installments where id = parc.id;
      insert into public.finance_settlements (organization_id, installment_id, settlement_date, amount, notes)
      values (org, parc.id, coalesce(nullif(item ->> 'pagoEm', '')::date, parc.due_date), parc.amount - parc.settled_amount,
        'Baixa registrada na revisão do histórico');
    end if;
    alterados := alterados + 1;
  end loop;

  perform public.emit_module_event(org, 'financeiro', 'financeiro.revisao.editada', 'serie', p_series,
    format('Histórico editado · %s · %s parcelas ajustadas', coalesce(nullif(trim(p ->> 'fornecedor'), ''), (select max(counterparty_name) from public.finance_titles where review_series = p_series)), alterados),
    jsonb_build_object('parcelas', alterados, 'conta', conta));

  if coalesce((p ->> 'aprovar')::boolean, false) then
    return public.finance_review_approve(p_series) || jsonb_build_object('editadas', alterados);
  end if;
  return jsonb_build_object('editadas', alterados);
end;
$$;
revoke all on function public.finance_review_update(text, jsonb) from public, anon;
grant execute on function public.finance_review_update(text, jsonb) to authenticated;

-- --- Arquivado sai do fluxo de caixa e do gasto por conta ---------------------------------
create or replace function public.finance_cash_by_month(p_year int)
returns table (month int, direction public.finance_title_direction, realized numeric, open_amount numeric, forecast_amount numeric)
language sql
stable
set search_path = public
as $$
  with realizado as (
    select extract(month from s.settlement_date)::int as month, t.direction, sum(s.amount + s.interest + s.penalty - s.discount) as value
    from public.finance_settlements s
    join public.finance_installments i on i.id = s.installment_id
    join public.finance_titles t on t.id = i.title_id
    where s.reversed_at is null and t.archived_at is null and extract(year from s.settlement_date) = p_year
    group by 1, 2
  ), aberto as (
    select extract(month from i.due_date)::int as month, t.direction,
      sum(i.amount - i.settled_amount) filter (where not t.is_forecast) as real_value,
      sum(i.amount - i.settled_amount) filter (where t.is_forecast) as forecast_value
    from public.finance_installments i
    join public.finance_titles t on t.id = i.title_id
    where t.status not in ('cancelled', 'settled') and not t.is_historical and t.archived_at is null
      and i.status <> 'cancelled' and i.settled_amount < i.amount and extract(year from i.due_date) = p_year
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

create or replace function public.finance_expense_by_account(p_year int, p_basis text default 'vencimento')
returns table (month int, code text, name text, management_type public.finance_management_type, total numeric, titles bigint)
language sql
stable
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
    where t.direction = 'payable' and not t.is_forecast and t.status <> 'cancelled' and t.archived_at is null
      and not (t.is_historical and t.status <> 'settled')
  )
  , linhas as (
    select a.title_id, a.chart_account_id, a.amount from public.finance_title_allocations a
    union all
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
