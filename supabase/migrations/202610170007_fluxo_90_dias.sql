-- F-07 (roadmap) · Fluxo de caixa dos próximos 90 dias.
-- Entrega os dados de partida da projeção; os cenários são calculados por regra na tela
-- (lib/finance/fluxo-90.ts), sem IA. Quem tem o Fluxo de caixa (financeiro.fluxo) ou os Relatórios
-- vê a projeção inteira, a pagar e a receber, sem precisar das permissões de cada lado.
--   * contas: saldo pelo extrato (saldo de abertura + lançamentos importados) e a data do último;
--   * parcelas em aberto com vencimento de 90 dias atrás até 120 dias à frente (a folga cobre o
--     atraso do cenário conservador), com quem, histórico, previsão e em aprovação;
--   * fora: o que venceu há mais de 90 dias, só somado (não entra em nenhum cenário: a tela avisa).
-- Um JSON só, para não esbarrar no limite de 1.000 linhas do Supabase.

create or replace function public.finance_fluxo_90()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if org is null or not (public.has_feature('financeiro.fluxo') or public.has_feature('financeiro.relatorios')) then
    raise exception 'O fluxo de caixa é de quem tem o Fluxo de caixa no Financeiro.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoje', hoje,
    'contas', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'nome', b.bank_name, 'agencia', b.branch, 'conta', b.account_number,
        'saldo', b.opening_balance + coalesce(x.creditos, 0) - coalesce(x.debitos, 0), 'ultimo', x.ultimo) order by b.bank_name)
      from public.finance_bank_accounts b
      left join lateral (
        select sum(e.amount) filter (where e.direction = 'credit') creditos, sum(e.amount) filter (where e.direction = 'debit') debitos, max(e.booking_date) ultimo
        from public.finance_bank_entries e where e.bank_account_id = b.id
      ) x on true
      where b.organization_id = org and b.active
    ), '[]'::jsonb),
    'parcelas', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'direcao', case when t.direction = 'receivable' then 'entra' else 'sai' end,
        'vencimento', i.due_date, 'valor', i.amount - i.settled_amount, 'previsao', t.is_forecast, 'emAprovacao', t.status = 'pending_approval',
        'quem', coalesce(nullif(t.counterparty_group, ''), t.counterparty_name), 'descricao', t.description, 'documento', t.document_number))
      from public.finance_installments i
      join public.finance_titles t on t.id = i.title_id
      where t.organization_id = org and t.status not in ('cancelled', 'settled', 'draft') and not t.is_historical and t.archived_at is null
        and i.status <> 'cancelled' and i.settled_amount < i.amount
        and i.due_date between hoje - 90 and hoje + 120
    ), '[]'::jsonb),
    'fora', (
      select jsonb_build_object(
        'aReceber', coalesce(sum(i.amount - i.settled_amount) filter (where t.direction = 'receivable' and not t.is_forecast), 0),
        'aReceberN', count(*) filter (where t.direction = 'receivable' and not t.is_forecast),
        'aPagar', coalesce(sum(i.amount - i.settled_amount) filter (where t.direction = 'payable' and not t.is_forecast), 0),
        'aPagarN', count(*) filter (where t.direction = 'payable' and not t.is_forecast),
        'previsoes', coalesce(sum(i.amount - i.settled_amount) filter (where t.is_forecast), 0),
        'previsoesN', count(*) filter (where t.is_forecast))
      from public.finance_installments i
      join public.finance_titles t on t.id = i.title_id
      where t.organization_id = org and t.status not in ('cancelled', 'settled', 'draft') and not t.is_historical and t.archived_at is null
        and i.status <> 'cancelled' and i.settled_amount < i.amount and i.due_date < hoje - 90
    )
  );
end;
$$;
revoke all on function public.finance_fluxo_90() from public, anon;
grant execute on function public.finance_fluxo_90() to authenticated;
