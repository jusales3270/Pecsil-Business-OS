-- ============================================================================
-- Pecsil Business OS — RH: calendário de feriados
--
-- Base para cálculos de férias, jornada e prazos (dias úteis). Cada feriado é
-- da organização; `day_off` indica se a Pecsil não trabalha na data.
--
-- Acesso: qualquer pessoa autenticada da organização LÊ (calendário não é dado
-- sensível e serve a outros módulos, como Produção). Só RH com edição no escopo
-- (has_scoped_permission) cria, altera ou remove.
-- ============================================================================

create table if not exists public.rh_holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_organization_id()
    references public.organizations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  scope text not null check (scope in ('nacional', 'estadual', 'municipal', 'facultativo')),
  location text,
  day_off boolean not null default true,
  source text,
  source_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, holiday_date)
);

comment on table public.rh_holidays is 'Calendário de feriados da organização (base para dias úteis, férias e jornada).';
comment on column public.rh_holidays.scope is 'nacional | estadual | municipal | facultativo (ponto facultativo observado pela empresa).';
comment on column public.rh_holidays.day_off is 'true = a empresa não trabalha na data (entra no cálculo de dias úteis).';
comment on column public.rh_holidays.source_label is 'Texto como veio da origem (ex.: calendário do Secullum), antes da normalização.';

create index if not exists idx_rh_holidays_org_date on public.rh_holidays(organization_id, holiday_date);

drop trigger if exists rh_holidays_updated_at on public.rh_holidays;
create trigger rh_holidays_updated_at
  before update on public.rh_holidays
  for each row execute function public.set_updated_at();

alter table public.rh_holidays enable row level security;
revoke all on public.rh_holidays from anon;

drop policy if exists rh_holidays_read on public.rh_holidays;
create policy rh_holidays_read on public.rh_holidays for select to authenticated
using (organization_id = public.current_organization_id());

-- `has_scoped_permission` sem alvo só é verdadeira para escopo de empresa ou de
-- módulo RH — um gestor de outro módulo não altera o calendário.
drop policy if exists rh_holidays_manage on public.rh_holidays;
create policy rh_holidays_manage on public.rh_holidays for all to authenticated
using (organization_id = public.current_organization_id() and public.has_scoped_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_scoped_permission('rh', 'edit'));

-- --- Dias úteis --------------------------------------------------------------
-- Conta dias de segunda a sexta no intervalo fechado, descontando feriados com
-- day_off da organização do usuário. Base para férias, prazos e jornada.
create or replace function public.rh_business_days(start_date date, end_date date)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
  from generate_series(start_date, end_date, interval '1 day') as d(day)
  where extract(isodow from d.day) < 6
    and not exists (
      select 1 from public.rh_holidays h
      where h.organization_id = public.current_organization_id()
        and h.holiday_date = d.day::date
        and h.day_off
    );
$$;

comment on function public.rh_business_days(date, date) is
  'Dias úteis (seg–sex, sem feriados day_off da organização) no intervalo fechado.';

-- --- Calendário 2026 (Secullum RH · emitido em 17/09/2026) --------------------
insert into public.rh_holidays (organization_id, holiday_date, name, scope, location, source, source_label)
select o.id, v.holiday_date, v.name, v.scope, v.location, 'secullum-2026', v.source_label
from public.organizations o
cross join (values
  (date '2026-01-01', 'Confraternização Universal',                      'nacional',    null,     'Confraternização Universal'),
  (date '2026-02-02', 'Aniversário de Itu',                              'municipal',   'Itu/SP', 'Aniversario cidade de Itu'),
  (date '2026-04-03', 'Sexta-feira Santa',                               'nacional',    null,     'Sexta Feira Santa'),
  (date '2026-04-21', 'Tiradentes',                                      'nacional',    null,     'Tiradentes'),
  (date '2026-05-01', 'Dia do Trabalho',                                 'nacional',    null,     'Conf. Universal'),
  (date '2026-06-04', 'Corpus Christi',                                  'facultativo', null,     'Corphus Christi'),
  (date '2026-07-09', 'Revolução Constitucionalista',                    'estadual',    'SP',     'Consitutcionalista'),
  (date '2026-09-07', 'Independência do Brasil',                         'nacional',    null,     'Independencia do Brasil'),
  (date '2026-10-12', 'Nossa Senhora Aparecida',                         'nacional',    null,     'Nossa Senhora Aparecida'),
  (date '2026-11-02', 'Finados',                                         'nacional',    null,     'Finados'),
  (date '2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra',    'nacional',    null,     'Consciência Negra'),
  (date '2026-12-25', 'Natal',                                           'nacional',    null,     'Natal')
) as v(holiday_date, name, scope, location, source_label)
on conflict (organization_id, holiday_date) do nothing;
