-- ============================================================================
-- Pecsil Business OS — RH: documentos pessoais do colaborador (LGPD)
--
-- CPF, PIS e CTPS ficam FORA de `employees`: quem enxerga o cadastro mestre
-- (nome, cargo, setor) não enxerga documentos. Leitura só para quem edita o RH
-- ou para o próprio colaborador; escrita só para quem edita o RH.
-- ============================================================================

create table if not exists public.rh_employee_personal_data (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  organization_id uuid not null default public.current_organization_id()
    references public.organizations(id) on delete cascade,
  cpf text not null check (cpf ~ '^\d{11}$'),
  pis text check (pis ~ '^\d{11}$'),
  ctps_number text,
  ctps_series text,
  ctps_uf text check (ctps_uf ~ '^[A-Z]{2}$'),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, cpf)
);

comment on table public.rh_employee_personal_data is
  'Documentos pessoais (LGPD). Somente RH com permissão de edição ou o próprio colaborador.';
comment on column public.rh_employee_personal_data.cpf is 'Somente dígitos (11).';
comment on column public.rh_employee_personal_data.pis is 'PIS/PASEP/NIS, somente dígitos (11).';
comment on column public.rh_employee_personal_data.source is 'Origem do registro (ex.: importação da folha).';

create index if not exists idx_rh_personal_data_org on public.rh_employee_personal_data(organization_id);

drop trigger if exists rh_employee_personal_data_updated_at on public.rh_employee_personal_data;
create trigger rh_employee_personal_data_updated_at
  before update on public.rh_employee_personal_data
  for each row execute function public.set_updated_at();

alter table public.rh_employee_personal_data enable row level security;

-- Documentos não são públicos nem para quem só VISUALIZA o RH.
revoke all on public.rh_employee_personal_data from anon;

-- ATENÇÃO: `has_permission` NÃO respeita escopo de módulo (um gestor do
-- Financeiro também "tem" rh.edit). O escopo é aplicado por
-- `has_scoped_permission` / `employees_in_scope` (202608250002).

-- Leitura: RH com edição NO ESCOPO do colaborador, ou o próprio colaborador
-- (employees_in_scope já inclui o próprio registro).
drop policy if exists rh_personal_data_read on public.rh_employee_personal_data;
create policy rh_personal_data_read on public.rh_employee_personal_data for select to authenticated
using (
  organization_id = public.current_organization_id()
  and employee_id in (select public.employees_in_scope('rh', 'edit'))
);

-- Escrita: só RH com edição no escopo — o próprio colaborador não altera os
-- seus documentos (employees_in_scope o incluiria, por isso o filtro explícito).
drop policy if exists rh_personal_data_manage on public.rh_employee_personal_data;
create policy rh_personal_data_manage on public.rh_employee_personal_data for all to authenticated
using (
  organization_id = public.current_organization_id()
  and employee_id in (
    select e.id from public.employees e
    where e.organization_id = public.current_organization_id()
      and public.has_scoped_permission('rh', 'edit', e.unit_id, e.department_id, e.team_id, null)
  )
)
with check (
  organization_id = public.current_organization_id()
  and employee_id in (
    select e.id from public.employees e
    where e.organization_id = public.current_organization_id()
      and public.has_scoped_permission('rh', 'edit', e.unit_id, e.department_id, e.team_id, null)
  )
);
