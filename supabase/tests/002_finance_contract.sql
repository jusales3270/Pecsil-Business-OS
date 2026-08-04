-- Validação estrutural do contrato Financeiro v1 após as migrations.
do $$
declare
  missing_tables text[];
  rls_disabled text[];
begin
  select array_agg(required.name order by required.name)
  into missing_tables
  from (values
    ('finance_chart_accounts'), ('finance_cost_centers'), ('finance_bank_accounts'),
    ('finance_titles'), ('finance_installments'), ('finance_approval_rules'),
    ('finance_approval_requests'), ('finance_settlements'), ('finance_bank_entries'),
    ('finance_reconciliations')
  ) as required(name)
  where to_regclass('public.' || required.name) is null;

  if missing_tables is not null then
    raise exception 'Tabelas financeiras ausentes: %', array_to_string(missing_tables, ', ');
  end if;

  select array_agg(c.relname order by c.relname)
  into rls_disabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'finance_chart_accounts','finance_cost_centers','finance_bank_accounts',
      'finance_titles','finance_installments','finance_approval_rules',
      'finance_approval_requests','finance_settlements','finance_bank_entries',
      'finance_reconciliations'
    ])
    and not c.relrowsecurity;

  if rls_disabled is not null then
    raise exception 'RLS financeiro desabilitado: %', array_to_string(rls_disabled, ', ');
  end if;

  if to_regprocedure('public.finance_validate_settlement()') is null then
    raise exception 'Validação de baixa financeira ausente';
  end if;
  if to_regprocedure('public.finance_refresh_installment()') is null then
    raise exception 'Recálculo de parcela financeira ausente';
  end if;
  if to_regprocedure('public.audit_finance_mutation()') is null then
    raise exception 'Auditoria financeira ausente';
  end if;

  raise notice 'Contrato Financeiro Pecsil validado: 10 tabelas, RLS, baixas parciais e auditoria presentes.';
end $$;

