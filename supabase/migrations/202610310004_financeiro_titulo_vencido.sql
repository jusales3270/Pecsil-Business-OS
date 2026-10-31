-- Ideia do vídeo da secretária de IA (31/10/2026), base da cobrança: a parcela a receber que venceu vira evento, para uma
-- guia da SARA poder reagir. Não cobra ninguém: régua, dias e quem aprova são da Ana (C-16).
-- Só olha os últimos 7 dias, para o histórico antigo do sistema legado não virar uma enxurrada de eventos na 1ª rodada.
-- Previsão (orçamento ganho) não é título a cobrar. Roda junto do Bom dia, de 10 em 10 minutos, e não repete a parcela.
create or replace function public.financeiro_vencidos_emitir()
returns integer language plpgsql security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  p record;
  n integer := 0;
begin
  for p in
    select i.id, i.organization_id, i.due_date, i.amount - i.settled_amount as falta, t.counterparty_name, t.document_number, t.customer_id
    from public.finance_installments i join public.finance_titles t on t.id = i.title_id
    where t.direction = 'receivable' and not t.is_forecast and t.status not in ('cancelled', 'settled', 'draft', 'pending_approval')
      and i.status in ('pending', 'partially_settled', 'overdue') and i.amount > i.settled_amount
      and i.due_date between hoje - 7 and hoje - 1
      and not exists (select 1 from public.module_events e where e.organization_id = i.organization_id and e.event_type = 'financeiro.titulo.vencido' and e.entity_id = i.id::text)
  loop
    perform public.emit_module_event(p.organization_id, 'financeiro', 'financeiro.titulo.vencido', 'parcela', p.id::text,
      format('A receber vencido · %s · R$ %s', p.counterparty_name, public.brl(p.falta)),
      jsonb_build_object('vencimento', p.due_date, 'valor', p.falta, 'documento', p.document_number, 'cliente', p.customer_id));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.financeiro_vencidos_emitir() from public, anon, authenticated;
grant execute on function public.financeiro_vencidos_emitir() to service_role;
