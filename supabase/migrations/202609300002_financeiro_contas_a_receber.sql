-- ============================================================================
-- Financeiro › Contas a receber: previsão, grupo do cliente, rateio e carga
-- ============================================================================
-- O contas a receber do sistema antigo (relatório de 30/09/2026) mistura três
-- coisas na mesma lista: nota emitida a receber, PREVISÃO (orçamento ainda sem
-- nota e duplicata já antecipada) e notas recusadas mantidas com R$ 0,01.
-- Aqui o título ganha o que faltava para receber essa lista sem mentir no
-- total:
--
--   is_forecast          previsão fica fora do "A receber" e do fluxo realizado
--   counterparty_group   apelido do grupo (FILIAL VIDROS = Ambev, O-I / SP …)
--   document_type        BOL · DEP · TRA · DIN
--   notes                observação do lançamento
--   needs_review/reason  lançamento que a equipe precisa conferir
--   legacy_key           chave do título no relatório (a carga não duplica)
--
-- finance_title_allocations guarda o rateio do título em mais de uma conta do
-- plano (ex.: uma NF com moldes + revenda); finance_titles.chart_account_id
-- fica com a conta de maior valor.
--
-- A carga entra por finance_import_receivables (só service_role), numa
-- transação, sem um evento por título: um único evento resume a carga.
-- ============================================================================

alter table public.finance_titles
  add column if not exists is_forecast boolean not null default false,
  add column if not exists counterparty_group text,
  add column if not exists document_type text,
  add column if not exists notes text,
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text,
  add column if not exists legacy_key text;

create unique index if not exists idx_finance_titles_legacy_key
  on public.finance_titles(organization_id, legacy_key) where legacy_key is not null;
create index if not exists idx_finance_titles_forecast
  on public.finance_titles(organization_id, direction, is_forecast);

-- --- Rateio por conta do plano -------------------------------------------------
create table if not exists public.finance_title_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title_id uuid not null references public.finance_titles(id) on delete cascade,
  chart_account_id uuid not null references public.finance_chart_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (title_id, chart_account_id)
);
create index if not exists idx_finance_title_allocations_account on public.finance_title_allocations(chart_account_id);

alter table public.finance_title_allocations enable row level security;

drop policy if exists finance_title_allocations_read on public.finance_title_allocations;
drop policy if exists finance_title_allocations_create on public.finance_title_allocations;
drop policy if exists finance_title_allocations_edit on public.finance_title_allocations;
drop policy if exists finance_title_allocations_remove on public.finance_title_allocations;
-- Quem enxerga o título enxerga o rateio dele (a policy de títulos filtra o subselect).
create policy finance_title_allocations_read on public.finance_title_allocations for select to authenticated
using (organization_id = public.current_organization_id() and title_id in (select id from public.finance_titles));
create policy finance_title_allocations_create on public.finance_title_allocations for insert to authenticated
with check (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'));
create policy finance_title_allocations_edit on public.finance_title_allocations for update to authenticated
using (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'))
with check (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'));
create policy finance_title_allocations_remove on public.finance_title_allocations for delete to authenticated
using (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'));

grant select, insert, update, delete on public.finance_title_allocations to authenticated;
grant all on public.finance_title_allocations to service_role;

-- --- Excluir conta do plano: o rateio também conta como uso --------------------
create or replace function public.finance_delete_account(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  usos int;
begin
  if not public.has_feature('financeiro.plano', 'operar') then
    raise exception 'Sem permissão para alterar o plano de contas.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.finance_chart_accounts where id = p_account and organization_id = org) then
    raise exception 'Conta não encontrada.';
  end if;
  if exists (select 1 from public.finance_chart_accounts where parent_id = p_account) then
    raise exception 'Esta conta tem subcontas. Mova ou exclua as subcontas antes.';
  end if;
  select count(distinct t.id) into usos
  from public.finance_titles t
  where t.chart_account_id = p_account
     or exists (select 1 from public.finance_title_allocations a where a.title_id = t.id and a.chart_account_id = p_account);
  if usos > 0 then
    raise exception 'Esta conta já foi usada em % título(s). Em vez de excluir, inative.', usos;
  end if;
  delete from public.finance_chart_accounts where id = p_account;
end;
$$;

-- --- Trilha: carga em lote não gera um evento por título -----------------------
create or replace function public.events_financeiro_titulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := case new.direction when 'payable' then 'a pagar' else 'a receber' end;
begin
  if current_setting('pecsil.carga_em_lote', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.criado', 'titulo', new.id::text,
      format('Título %s criado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount,
        'source_module', new.source_module, 'source_entity_id', new.source_entity_id));
  elsif new.status is distinct from old.status and new.status = 'settled' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.baixado', 'titulo', new.id::text,
      format('Título %s quitado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  elsif new.status is distinct from old.status and new.status = 'approved' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.aprovado', 'titulo', new.id::text,
      format('Título %s aprovado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  elsif new.status is distinct from old.status and new.status = 'cancelled' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.cancelado', 'titulo', new.id::text,
      format('Título %s cancelado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  end if;
  return new;
end;
$$;

-- --- Carga do contas a receber do sistema antigo -------------------------------
-- p_titles: lista de objetos
--   { legacy_key, group, client, document, document_type, history, notes,
--     issue_date, due_date, amount, forecast, review_reason,
--     allocations: [{ code, amount }] }
-- Título com legacy_key já gravado é pulado; conta inexistente aborta tudo.
create or replace function public.finance_import_receivables(p_org uuid, p_titles jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  part jsonb;
  new_title uuid;
  main_account uuid;
  account uuid;
  inserted int := 0;
  skipped int := 0;
  total numeric(18,2) := 0;
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
      p_org, 'receivable', item ->> 'client', nullif(item ->> 'group', ''), nullif(item ->> 'document', ''), nullif(item ->> 'document_type', ''),
      item ->> 'history', nullif(item ->> 'notes', ''), (item ->> 'issue_date')::date, (item ->> 'issue_date')::date,
      (item ->> 'amount')::numeric, main_account, 'approved',
      'legado', coalesce((item ->> 'forecast')::boolean, false), nullif(item ->> 'review_reason', '') is not null,
      nullif(item ->> 'review_reason', ''), item ->> 'legacy_key', now()
    ) returning id into new_title;

    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (p_org, new_title, 1, (item ->> 'due_date')::date, (item ->> 'amount')::numeric, 0,
      case when (item ->> 'due_date')::date < current_date then 'overdue' else 'pending' end::public.finance_installment_status);

    for part in select * from jsonb_array_elements(coalesce(item -> 'allocations', '[]'::jsonb)) loop
      select id into account from public.finance_chart_accounts where organization_id = p_org and code = part ->> 'code';
      if account is null then
        raise exception 'Conta % não existe no plano (título %).', part ->> 'code', item ->> 'legacy_key';
      end if;
      insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
      values (p_org, new_title, account, (part ->> 'amount')::numeric);
    end loop;

    inserted := inserted + 1;
    total := total + (item ->> 'amount')::numeric;
  end loop;

  if inserted > 0 then
    perform public.emit_module_event(p_org, 'financeiro', 'financeiro.carga.concluida', 'carga', 'contas-a-receber',
      format('Contas a receber do sistema antigo carregadas · %s títulos · R$ %s', inserted, public.brl(total)),
      jsonb_build_object('inserted', inserted, 'skipped', skipped, 'amount', total));
  end if;
  return jsonb_build_object('inserted', inserted, 'skipped', skipped, 'amount', total);
end;
$$;
revoke all on function public.finance_import_receivables(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finance_import_receivables(uuid, jsonb) to service_role;
