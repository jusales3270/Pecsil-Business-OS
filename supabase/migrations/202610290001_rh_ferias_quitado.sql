-- RH: período de férias quitado sem registro no histórico (proprietário, 29/10/2026).
--
-- A importação do histórico (25/09/2026) copiou a planilha "HISTÓRICO FUNCIONÁRIOS ATUAIS" como estava.
-- Alguns períodos antigos ficaram com saldo porque a planilha não tem o gozo completo (registro perdido):
-- apareciam como "Vencido" em Férias a vencer sem estarem. O período passa a poder ser marcado como
-- quitado, com o motivo e quem confirmou: deixa de contar como saldo e como vencido, e o dado original
-- (dias gozados, abono) fica como veio. rh_ferias_mapa (mapa por setor, SARA do RH, Bom dia, vigia)
-- passa a ignorar os quitados.

alter table public.rh_vacation_balances
  add column if not exists quitado_em timestamptz,
  add column if not exists quitado_motivo text,
  add column if not exists quitado_por_nome text;
alter table public.rh_vacation_balances drop constraint if exists rh_vacation_balances_quitado_ck;
alter table public.rh_vacation_balances add constraint rh_vacation_balances_quitado_ck
  check (quitado_em is null or (length(btrim(coalesce(quitado_motivo, ''))) >= 5 and length(btrim(coalesce(quitado_por_nome, ''))) >= 2));
comment on column public.rh_vacation_balances.quitado_em is 'Período quitado sem registro de gozo no histórico: não conta como saldo nem como vencido (motivo e quem confirmou ao lado).';

create or replace function public.rh_ferias_mapa()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  fim date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) + interval '12 months' - interval '1 day')::date;
begin
  if org is null or not public.has_feature('rh.ferias') then
    raise exception 'O mapa de férias é de quem tem Férias e ausências no RH.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoje', hoje, 'inicio', ini, 'fim', fim,
    'setores', coalesce((
      select jsonb_agg(jsonb_build_object('id', coalesce(d.id::text, 'sem'), 'nome', coalesce(d.name, 'Sem setor'), 'ativos', x.n) order by coalesce(d.name, 'Sem setor'))
      from (select e.department_id, count(*) n from public.employees e where e.organization_id = org and e.active group by 1) x
      left join public.departments d on d.id = x.department_id
    ), '[]'::jsonb),
    'ferias', coalesce((
      select jsonb_agg(jsonb_build_object('employee', e.id, 'nome', e.full_name, 'setor', coalesce(e.department_id::text, 'sem'),
        'inicio', a.start_date, 'fim', a.end_date, 'status', a.status) order by a.start_date)
      from public.rh_absences a
      join public.employees e on e.id = a.employee_id and e.active
      where a.organization_id = org and a.absence_type = 'vacation' and a.status::text in ('approved', 'registered')
        and a.end_date >= ini and a.start_date <= fim
    ), '[]'::jsonb),
    'concessivos', coalesce((
      select jsonb_agg(jsonb_build_object('employee', e.id, 'nome', e.full_name, 'setor', coalesce(e.department_id::text, 'sem'),
        'vence', b.expires_at, 'saldo', b.entitled_days - b.taken_days - b.scheduled_days - b.pecuniary_days,
        'aquisitivoInicio', b.acquisition_start, 'aquisitivoFim', b.acquisition_end) order by b.expires_at)
      from public.rh_vacation_balances b
      join public.employees e on e.id = b.employee_id and e.active
      where b.organization_id = org and b.expires_at is not null and b.expires_at <= fim
        and b.entitled_days - b.taken_days - b.scheduled_days - b.pecuniary_days > 0
        and b.quitado_em is null
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.rh_ferias_mapa() from public, anon;
grant execute on function public.rh_ferias_mapa() to authenticated;
