-- Conciliação bancária: carga do extrato, vínculo com baixas e contas criadas a partir do extrato.
--
-- As tabelas de contas bancárias, lançamentos do extrato e conciliações existem
-- desde a v1 (202608040002) e estavam vazias. Esta migração acrescenta o que
-- faltava para usá-las:
--  - classificação do lançamento (categoria, beneficiário, CNPJ);
--  - carga em lote pelo script (service_role), sem duplicar;
--  - conciliar, desfazer e ignorar pela tela (permissão financeiro.bancos);
--  - criar a conta a pagar/receber já baixada a partir de um lançamento sem conta;
--  - dar baixa numa parcela aberta com o valor do extrato.
-- O CPF nunca é gravado: o texto chega limpo (lib/finance/extrato-classificar.ts).

alter table public.finance_bank_entries
  add column if not exists category text,
  add column if not exists counterparty_name text,
  add column if not exists counterparty_tax_id text;

create index if not exists idx_finance_bank_entries_date
  on public.finance_bank_entries (organization_id, bank_account_id, booking_date desc);

-- --- Carga do extrato (script) ---------------------------------------------------
-- p_entries: lançamentos já classificados; p_links: vínculos com baixas
-- ({ external_id, nivel, confianca, settlements: [{ id, amount }] }). Reexecutável:
-- o lançamento que já existe (mesmo external_id na conta) é pulado, e a baixa que
-- já está conciliada não é ligada de novo.
create or replace function public.finance_import_bank_entries(p_org uuid, p_account jsonb, p_entries jsonb, p_links jsonb default '[]'::jsonb, p_summary jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acct uuid;
  item jsonb;
  link jsonb;
  part jsonb;
  entry_id uuid;
  entry_amount numeric(18,2);
  part_amount numeric(18,2);
  total_linked numeric(18,2);
  inserted int := 0;
  skipped int := 0;
  linked int := 0;
  loaded record;
begin
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'Organização não encontrada.';
  end if;
  perform set_config('pecsil.carga_em_lote', '1', true);

  insert into public.finance_bank_accounts (organization_id, bank_code, bank_name, branch, account_number, account_digit, account_type, opening_balance)
  values (p_org, p_account ->> 'bank_code', p_account ->> 'bank_name', p_account ->> 'branch', p_account ->> 'account_number',
    nullif(p_account ->> 'account_digit', ''), coalesce(p_account ->> 'account_type', 'checking'), coalesce((p_account ->> 'opening_balance')::numeric, 0))
  on conflict (organization_id, bank_code, branch, account_number) do update set bank_name = excluded.bank_name
  returning id into acct;

  for item in select * from jsonb_array_elements(p_entries) loop
    entry_id := null;
    insert into public.finance_bank_entries (
      organization_id, bank_account_id, booking_date, direction, amount, description, document_number, external_id,
      raw_payload, reconciliation_status, category, counterparty_name, counterparty_tax_id
    ) values (
      p_org, acct, (item ->> 'booking_date')::date, (item ->> 'direction')::public.finance_bank_entry_direction,
      (item ->> 'amount')::numeric, item ->> 'description', nullif(item ->> 'document_number', ''), item ->> 'external_id',
      coalesce(item -> 'raw_payload', '{}'::jsonb), coalesce(item ->> 'status', 'pending')::public.finance_reconciliation_status,
      nullif(item ->> 'category', ''), nullif(item ->> 'counterparty_name', ''), nullif(item ->> 'counterparty_tax_id', '')
    )
    on conflict (bank_account_id, external_id) where external_id is not null do nothing
    returning id into entry_id;
    if entry_id is null then skipped := skipped + 1; else inserted := inserted + 1; end if;
  end loop;

  for link in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    entry_id := null;
    select id, amount into entry_id, entry_amount
    from public.finance_bank_entries where bank_account_id = acct and external_id = link ->> 'external_id';
    if entry_id is null or exists (select 1 from public.finance_reconciliations where bank_entry_id = entry_id) then
      continue;
    end if;
    total_linked := 0;
    for part in select * from jsonb_array_elements(coalesce(link -> 'settlements', '[]'::jsonb)) loop
      part_amount := (part ->> 'amount')::numeric;
      if part_amount is null or part_amount <= 0 then continue; end if;
      if not exists (select 1 from public.finance_settlements s where s.id = (part ->> 'id')::uuid and s.organization_id = p_org and s.reversed_at is null) then continue; end if;
      if exists (select 1 from public.finance_reconciliations r where r.settlement_id = (part ->> 'id')::uuid) then continue; end if;
      insert into public.finance_reconciliations (organization_id, bank_entry_id, settlement_id, matched_amount, status, notes)
      values (p_org, entry_id, (part ->> 'id')::uuid, part_amount, 'matched',
        format('Carga do extrato · nível %s · confiança %s', link ->> 'nivel', link ->> 'confianca'));
      update public.finance_settlements set bank_account_id = acct where id = (part ->> 'id')::uuid and bank_account_id is null;
      total_linked := total_linked + part_amount;
    end loop;
    if total_linked > 0 then
      update public.finance_bank_entries
      set reconciliation_status = (case when abs(total_linked - entry_amount) < 0.005 then 'matched' else 'partial' end)::public.finance_reconciliation_status
      where id = entry_id;
      linked := linked + 1;
    end if;
  end loop;

  if p_summary is not null then
    select count(*) as entries, count(*) filter (where reconciliation_status = 'matched') as matched,
           count(*) filter (where reconciliation_status = 'pending') as pending
      into loaded
    from public.finance_bank_entries where bank_account_id = acct;
    perform public.emit_module_event(p_org, 'financeiro', 'financeiro.extrato.importado', 'extrato', acct::text,
      format('Extrato importado · %s lançamentos de %s a %s · %s conciliados, %s a revisar',
        loaded.entries, to_char((p_summary ->> 'inicio')::date, 'DD/MM/YYYY'), to_char((p_summary ->> 'fim')::date, 'DD/MM/YYYY'), loaded.matched, loaded.pending),
      p_summary || jsonb_build_object('account', acct, 'entries', loaded.entries, 'matched', loaded.matched, 'pending', loaded.pending));
    insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
    values (p_org, auth.uid(), public.current_profile_id(), 'financeiro', 'finance_bank_entries.import', 'finance_bank_accounts', acct, 'high',
      p_summary || jsonb_build_object('entries', loaded.entries, 'matched', loaded.matched, 'pending', loaded.pending));
  end if;

  return jsonb_build_object('account', acct, 'inserted', inserted, 'skipped', skipped, 'linked', linked);
end;
$$;
revoke all on function public.finance_import_bank_entries(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finance_import_bank_entries(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;

-- --- Conciliar um lançamento com baixas existentes --------------------------------
-- Saída casa com baixa de conta a pagar; entrada, com baixa de conta a receber.
-- O que sai do caixa na baixa é pago + juros + multa. A soma das baixas não pode
-- passar do valor do lançamento; se ficar abaixo, o lançamento fica "parcial".
create or replace function public.finance_reconcile_entry(p_entry uuid, p_settlements uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  entry public.finance_bank_entries%rowtype;
  s record;
  total numeric(18,2) := 0;
  cash numeric(18,2);
  wanted public.finance_title_direction;
  new_status public.finance_reconciliation_status;
begin
  if not public.has_feature('financeiro.bancos', 'operar') then
    raise exception 'Sem permissão para conciliar.' using errcode = '42501';
  end if;
  select * into entry from public.finance_bank_entries where id = p_entry and organization_id = org;
  if entry.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if entry.reconciliation_status = 'matched' then raise exception 'Este lançamento já está conciliado.'; end if;
  if p_settlements is null or cardinality(p_settlements) = 0 then raise exception 'Escolha ao menos uma baixa.'; end if;
  wanted := case entry.direction when 'debit' then 'payable' else 'receivable' end;

  for s in
    select st.id, st.amount, st.interest, st.penalty, st.bank_account_id, t.direction
    from public.finance_settlements st
    join public.finance_installments i on i.id = st.installment_id
    join public.finance_titles t on t.id = i.title_id
    where st.id = any (p_settlements) and st.organization_id = org and st.reversed_at is null
    for update of st
  loop
    if s.direction <> wanted then raise exception 'A baixa e o lançamento não são do mesmo sentido (pagar/receber).'; end if;
    if s.bank_account_id is not null and s.bank_account_id <> entry.bank_account_id then raise exception 'A baixa já está ligada a outra conta bancária.'; end if;
    if exists (select 1 from public.finance_reconciliations r where r.settlement_id = s.id) then raise exception 'Uma das baixas já está conciliada com outro lançamento.'; end if;
    cash := s.amount + s.interest + s.penalty;
    insert into public.finance_reconciliations (organization_id, bank_entry_id, settlement_id, matched_amount, status, reconciled_by_profile_id, notes)
    values (org, entry.id, s.id, cash, 'matched', public.current_profile_id(), 'Conciliado na tela');
    update public.finance_settlements set bank_account_id = entry.bank_account_id where id = s.id and bank_account_id is null;
    total := total + cash;
  end loop;

  if total = 0 then raise exception 'Nenhuma baixa válida entre as escolhidas.'; end if;
  select coalesce(sum(matched_amount), 0) into total from public.finance_reconciliations where bank_entry_id = entry.id;
  if total > entry.amount + 0.005 then
    raise exception 'As baixas somam % e o lançamento é de %.', public.brl(total), public.brl(entry.amount);
  end if;
  new_status := (case when abs(total - entry.amount) < 0.005 then 'matched' else 'partial' end)::public.finance_reconciliation_status;
  update public.finance_bank_entries set reconciliation_status = new_status where id = entry.id;

  perform public.emit_module_event(org, 'financeiro', 'financeiro.conciliacao.feita', 'lancamento', entry.id::text,
    format('Conciliação feita · %s de %s · R$ %s', to_char(entry.booking_date, 'DD/MM/YYYY'), left(entry.description, 60), public.brl(entry.amount)),
    jsonb_build_object('entry', entry.id, 'settlements', p_settlements, 'status', new_status));
  return jsonb_build_object('status', new_status, 'matched', total);
end;
$$;
revoke all on function public.finance_reconcile_entry(uuid, uuid[]) from public;
grant execute on function public.finance_reconcile_entry(uuid, uuid[]) to authenticated;

-- --- Desfazer a conciliação -------------------------------------------------------
-- Tira os vínculos e devolve o lançamento a "pendente". A baixa volta a ficar sem
-- conta bancária se não tiver outro vínculo. Contas criadas a partir do extrato
-- continuam existindo (para excluí-las, use a exclusão do título).
create or replace function public.finance_unreconcile_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  entry public.finance_bank_entries%rowtype;
  settlement_ids uuid[];
begin
  if not public.has_feature('financeiro.bancos', 'operar') then
    raise exception 'Sem permissão para desfazer a conciliação.' using errcode = '42501';
  end if;
  select * into entry from public.finance_bank_entries where id = p_entry and organization_id = org;
  if entry.id is null then raise exception 'Lançamento não encontrado.'; end if;
  select coalesce(array_agg(settlement_id), '{}') into settlement_ids from public.finance_reconciliations where bank_entry_id = entry.id;
  if cardinality(settlement_ids) = 0 then raise exception 'Este lançamento não tem conciliação.'; end if;

  delete from public.finance_reconciliations where bank_entry_id = entry.id;
  update public.finance_settlements set bank_account_id = null
  where id = any (settlement_ids) and bank_account_id = entry.bank_account_id
    and not exists (select 1 from public.finance_reconciliations r where r.settlement_id = finance_settlements.id);
  update public.finance_bank_entries set reconciliation_status = 'pending' where id = entry.id;

  perform public.emit_module_event(org, 'financeiro', 'financeiro.conciliacao.desfeita', 'lancamento', entry.id::text,
    format('Conciliação desfeita · %s de %s · R$ %s', to_char(entry.booking_date, 'DD/MM/YYYY'), left(entry.description, 60), public.brl(entry.amount)),
    jsonb_build_object('entry', entry.id, 'settlements', settlement_ids));
end;
$$;
revoke all on function public.finance_unreconcile_entry(uuid) from public;
grant execute on function public.finance_unreconcile_entry(uuid) to authenticated;

-- --- Ignorar / voltar a pendente --------------------------------------------------
create or replace function public.finance_ignore_entry(p_entry uuid, p_ignore boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  entry public.finance_bank_entries%rowtype;
begin
  if not public.has_feature('financeiro.bancos', 'operar') then
    raise exception 'Sem permissão para classificar lançamentos.' using errcode = '42501';
  end if;
  select * into entry from public.finance_bank_entries where id = p_entry and organization_id = org;
  if entry.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if exists (select 1 from public.finance_reconciliations where bank_entry_id = entry.id) then
    raise exception 'Desfaça a conciliação antes de ignorar este lançamento.';
  end if;
  update public.finance_bank_entries set reconciliation_status = (case when p_ignore then 'ignored' else 'pending' end)::public.finance_reconciliation_status where id = entry.id;
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (org, auth.uid(), public.current_profile_id(), 'financeiro', case when p_ignore then 'finance_bank_entries.ignore' else 'finance_bank_entries.unignore' end,
    'finance_bank_entries', entry.id, 'normal', jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;
revoke all on function public.finance_ignore_entry(uuid, boolean, text) from public;
grant execute on function public.finance_ignore_entry(uuid, boolean, text) to authenticated;

-- --- Criar a conta a partir do extrato --------------------------------------------
-- Para o lançamento que não tem conta no Financeiro (tarifa, tributo, parcela de
-- financiamento, folha, pagamento sem título): cria o título aprovado, a parcela,
-- o rateio na conta do plano escolhida, a baixa na data do extrato e a conciliação.
-- Saída vira conta a pagar; entrada, conta a receber. Quem faz precisa poder
-- aprovar na direção (a baixa é de quem aprova) e operar bancos.
create or replace function public.finance_entries_create_titles(p_entries uuid[], p_chart_account uuid, p_description text default null, p_cost_center uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  entry public.finance_bank_entries%rowtype;
  account public.finance_chart_accounts%rowtype;
  dir public.finance_title_direction;
  new_title uuid;
  new_installment uuid;
  new_settlement uuid;
  created int := 0;
  skipped int := 0;
  method text;
  party text;
begin
  if not public.has_feature('financeiro.bancos', 'operar') then
    raise exception 'Sem permissão para criar contas a partir do extrato.' using errcode = '42501';
  end if;
  if p_entries is null or cardinality(p_entries) = 0 then raise exception 'Escolha ao menos um lançamento.'; end if;
  if cardinality(p_entries) > 500 then raise exception 'Escolha até 500 lançamentos por vez.'; end if;
  select * into account from public.finance_chart_accounts where id = p_chart_account and organization_id = org and active;
  if account.id is null or not account.allows_posting then raise exception 'Escolha uma conta do plano que aceite lançamentos.'; end if;

  for entry in select * from public.finance_bank_entries where id = any (p_entries) and organization_id = org order by booking_date, created_at, id for update loop
    if entry.reconciliation_status in ('matched', 'partial') or exists (select 1 from public.finance_reconciliations where bank_entry_id = entry.id) then
      skipped := skipped + 1;
      continue;
    end if;
    dir := case entry.direction when 'debit' then 'payable' else 'receivable' end;
    if not public.has_feature(public.finance_direction_feature(dir), 'aprovar') then
      raise exception 'Sem permissão para registrar baixa em contas a %.', case dir when 'payable' then 'pagar' else 'receber' end using errcode = '42501';
    end if;
    method := case when entry.category = 'saque' then 'DIN' when entry.category = 'tarifa_bancaria' then 'TAR'
      when entry.category = 'financiamento' then 'DEB' when entry.category = 'tributo' then 'GUI' else 'TRA' end;
    party := coalesce(entry.counterparty_name,
      case entry.category when 'folha' then 'FOLHA DE PAGAMENTO' when 'tributo' then 'TRIBUTOS E ENCARGOS' when 'financiamento' then 'ITAÚ'
        when 'tarifa_bancaria' then 'ITAÚ' when 'saque' then 'SAQUE EM CHEQUE' when 'recebimento_cliente' then 'CLIENTE' else 'LANÇAMENTO DO EXTRATO' end);

    insert into public.finance_titles (
      organization_id, direction, counterparty_name, counterparty_tax_id, description, issue_date, competence_date, original_amount,
      chart_account_id, cost_center_id, status, source_module, source_entity_id, legacy_key, approved_at, created_by_profile_id, document_type
    ) values (
      org, dir, party, entry.counterparty_tax_id, coalesce(nullif(btrim(coalesce(p_description, '')), ''), entry.description),
      entry.booking_date, entry.booking_date, entry.amount, account.id, p_cost_center, 'approved', 'banco', entry.id, 'banco|' || entry.id::text, now(),
      public.current_profile_id(), method
    ) returning id into new_title;

    insert into public.finance_installments (organization_id, title_id, installment_number, due_date, amount, settled_amount, status)
    values (org, new_title, 1, entry.booking_date, entry.amount, 0, 'pending')
    returning id into new_installment;

    insert into public.finance_title_allocations (organization_id, title_id, chart_account_id, amount)
    values (org, new_title, account.id, entry.amount);

    insert into public.finance_settlements (organization_id, installment_id, bank_account_id, settlement_date, amount, payment_method, notes, created_by_profile_id)
    values (org, new_installment, entry.bank_account_id, entry.booking_date, entry.amount, method, 'Criada a partir do extrato bancário', public.current_profile_id())
    returning id into new_settlement;

    insert into public.finance_reconciliations (organization_id, bank_entry_id, settlement_id, matched_amount, status, reconciled_by_profile_id, notes)
    values (org, entry.id, new_settlement, entry.amount, 'matched', public.current_profile_id(), 'Conta criada a partir do extrato');
    update public.finance_bank_entries set reconciliation_status = 'matched' where id = entry.id;
    created := created + 1;
  end loop;

  return jsonb_build_object('created', created, 'skipped', skipped);
end;
$$;
revoke all on function public.finance_entries_create_titles(uuid[], uuid, text, uuid) from public;
grant execute on function public.finance_entries_create_titles(uuid[], uuid, text, uuid) to authenticated;

-- --- Dar baixa numa parcela aberta com o valor do extrato ------------------------
-- Para o pagamento (ou recebimento) que já existe como parcela em aberto: a baixa
-- usa a data do extrato e o valor do lançamento; o que passar do saldo da parcela
-- entra como juros e o que faltar deixa a parcela parcialmente quitada.
create or replace function public.finance_entry_settle_installment(p_entry uuid, p_installment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  entry public.finance_bank_entries%rowtype;
  inst record;
  new_settlement uuid;
  balance numeric(18,2);
  applied numeric(18,2);
  wanted public.finance_title_direction;
begin
  if not public.has_feature('financeiro.bancos', 'operar') then
    raise exception 'Sem permissão para conciliar.' using errcode = '42501';
  end if;
  select * into entry from public.finance_bank_entries where id = p_entry and organization_id = org for update;
  if entry.id is null then raise exception 'Lançamento não encontrado.'; end if;
  if entry.reconciliation_status in ('matched', 'partial') or exists (select 1 from public.finance_reconciliations where bank_entry_id = entry.id) then
    raise exception 'Este lançamento já está conciliado.';
  end if;
  wanted := case entry.direction when 'debit' then 'payable' else 'receivable' end;

  select i.id, i.amount, i.settled_amount, i.status, t.direction, t.status as title_status
    into inst
  from public.finance_installments i join public.finance_titles t on t.id = i.title_id
  where i.id = p_installment and i.organization_id = org for update of i;
  if inst.id is null then raise exception 'Parcela não encontrada.'; end if;
  if inst.direction <> wanted then raise exception 'A parcela e o lançamento não são do mesmo sentido (pagar/receber).'; end if;
  if not public.has_feature(public.finance_direction_feature(inst.direction), 'aprovar') then
    raise exception 'Sem permissão para registrar a baixa.' using errcode = '42501';
  end if;
  if inst.status in ('cancelled', 'settled') or inst.title_status = 'cancelled' then raise exception 'Esta parcela não está em aberto.'; end if;

  balance := inst.amount - inst.settled_amount;
  applied := least(entry.amount, balance);
  insert into public.finance_settlements (organization_id, installment_id, bank_account_id, settlement_date, amount, interest, payment_method, notes, created_by_profile_id)
  values (org, inst.id, entry.bank_account_id, entry.booking_date, applied, greatest(entry.amount - balance, 0), 'TRA', 'Baixa feita a partir do extrato bancário', public.current_profile_id())
  returning id into new_settlement;
  insert into public.finance_reconciliations (organization_id, bank_entry_id, settlement_id, matched_amount, status, reconciled_by_profile_id, notes)
  values (org, entry.id, new_settlement, entry.amount, 'matched', public.current_profile_id(), 'Baixa feita a partir do extrato');
  update public.finance_bank_entries set reconciliation_status = 'matched' where id = entry.id;
  return jsonb_build_object('settlement', new_settlement, 'applied', applied, 'interest', greatest(entry.amount - balance, 0));
end;
$$;
revoke all on function public.finance_entry_settle_installment(uuid, uuid) from public;
grant execute on function public.finance_entry_settle_installment(uuid, uuid) to authenticated;

-- --- Resumo por conta (saldo e pendências) ---------------------------------------
-- O painel não pode ler as linhas do extrato (são milhares; a leitura direta corta
-- em 1.000): o banco soma. Roda com a permissão de quem chama, então a RLS vale.
create or replace function public.finance_bank_overview()
returns table (bank_account_id uuid, entries bigint, credits numeric, debits numeric, pending bigint, partial bigint, matched bigint, ignored bigint, first_date date, last_date date)
language sql
stable
security invoker
set search_path = public
as $$
  select e.bank_account_id,
    count(*),
    coalesce(sum(e.amount) filter (where e.direction = 'credit'), 0),
    coalesce(sum(e.amount) filter (where e.direction = 'debit'), 0),
    count(*) filter (where e.reconciliation_status = 'pending'),
    count(*) filter (where e.reconciliation_status = 'partial'),
    count(*) filter (where e.reconciliation_status = 'matched'),
    count(*) filter (where e.reconciliation_status = 'ignored'),
    min(e.booking_date),
    max(e.booking_date)
  from public.finance_bank_entries e
  where e.organization_id = public.current_organization_id()
  group by e.bank_account_id;
$$;
revoke all on function public.finance_bank_overview() from public;
grant execute on function public.finance_bank_overview() to authenticated;
