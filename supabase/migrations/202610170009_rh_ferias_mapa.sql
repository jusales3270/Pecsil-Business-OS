-- R-03 (roadmap), parte 2 · Mapa de férias por setor (RH › Férias e ausências › Mapa por setor).
-- Substitui o "Calendário consolidado", que tinha o período fixo no código (julho a setembro de 2026).
-- Entrega, para quem tem Férias e ausências (rh.ferias), num JSON só:
--   * setores com o número de colaboradores ativos;
--   * férias aprovadas ou registradas que tocam a janela (do 1º dia do mês atual até 12 meses à frente);
--   * saldos de férias com o prazo de concessão vencido ou vencendo na janela (direito menos gozado,
--     programado e abono > 0), para planejar antes de virar férias em dobro (CLT, art. 137).
-- A conta do mapa é feita na tela, por regra (lib/rh/ferias-mapa.ts).

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
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.rh_ferias_mapa() from public, anon;
grant execute on function public.rh_ferias_mapa() to authenticated;
