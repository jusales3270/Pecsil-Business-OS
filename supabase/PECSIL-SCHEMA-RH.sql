-- ============================================================================
-- PecSil Business OS — SCHEMA DO RH (aplicar sobre a Fundação já existente)
--
-- Use este arquivo quando a Fundação e o Financeiro JÁ estão no servidor
-- (é o caso da PecSil). Cria 8 tabelas rh_*, enums, auditoria e RLS.
--
-- Studio → SQL Editor → New query → cole tudo → Run.
-- Roda como transação única: se falhar, nada é gravado.
-- Os grants para authenticated/service_role são herdados automaticamente das
-- default privileges já configuradas — não precisa repeti-los.
-- ============================================================================


-- --- 202608150001_rh_enums.sql ---

-- ============================================================================
-- Pecsil Business OS — Tipos enumerados do RH
--
-- Separado do schema principal para que os valores estejam disponíveis em uma
-- transação posterior — mesma razão de finance_permissions estar isolado.
--
-- Domínios derivados diretamente do módulo RH (app/components/hr-module.tsx):
-- jornada, ausências/férias, benefícios e SST. Folha de pagamento fica fora
-- desta versão, por decisão do Blueprint.
-- ============================================================================

-- Ausências e férias
create type public.rh_absence_type as enum (
  'vacation', 'time_bank', 'medical_certificate', 'leave'
);
create type public.rh_absence_status as enum (
  'pending', 'under_review', 'approved', 'rejected', 'registered'
);

-- Jornada / ponto
create type public.rh_journey_status as enum (
  'regular', 'pending', 'under_review', 'adjusted', 'absence'
);

-- Benefícios
create type public.rh_benefit_category as enum (
  'food', 'health', 'mobility', 'protection'
);
create type public.rh_benefit_plan_status as enum ('active', 'under_review', 'suspended');
create type public.rh_benefit_request_action as enum (
  'enroll', 'change', 'cancel', 'add_dependent'
);
create type public.rh_benefit_request_status as enum (
  'pending', 'under_review', 'approved', 'rejected'
);

-- SST — saúde e segurança do trabalho
create type public.rh_sst_category as enum (
  'exam', 'training', 'ppe', 'incident'
);
create type public.rh_sst_status as enum (
  'compliant', 'due_soon', 'overdue', 'scheduled', 'under_review'
);
create type public.rh_sst_risk as enum ('critical', 'attention', 'regular');

-- --- 202608150002_rh_v1.sql ---

-- ============================================================================
-- Pecsil Business OS — Persistência do RH v1
--
-- Consome a Fundação: colaboradores são os `employees` já existentes; unidade,
-- departamento, equipe e cargo vêm da estrutura organizacional. Este módulo
-- NÃO duplica esses cadastros — apenas referencia.
--
-- Domínios: jornada, ausências/férias, benefícios (planos, adesões,
-- solicitações, dependentes) e SST (exames, treinamentos, EPIs, ocorrências).
-- Folha de pagamento fica deliberadamente fora desta versão.
--
-- Segue o padrão do Financeiro (202608040002): RLS por organização + módulo +
-- permissão, auditoria automática nas mutações sensíveis, triggers de
-- updated_at, e can_access_module('rh') em toda leitura.
-- ============================================================================

-- ============================================================================
-- 1. JORNADA / PONTO
-- ============================================================================

create table public.rh_journey_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  work_date date not null,
  schedule_label text,
  punches jsonb not null default '[]'::jsonb,
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  balance_minutes integer not null default 0,
  status public.rh_journey_status not null default 'regular',
  issue text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ============================================================================
-- 2. AUSÊNCIAS E FÉRIAS
-- ============================================================================

create table public.rh_absences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  absence_type public.rh_absence_type not null,
  start_date date not null,
  end_date date not null,
  days integer not null check (days > 0),
  status public.rh_absence_status not null default 'pending',
  reason text,
  has_conflict boolean not null default false,
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (
    (status in ('pending', 'under_review', 'registered') and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null)
  )
);

-- Saldo de férias por colaborador, por período aquisitivo.
create table public.rh_vacation_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  acquisition_start date not null,
  acquisition_end date not null,
  entitled_days integer not null default 30 check (entitled_days >= 0),
  taken_days integer not null default 0 check (taken_days >= 0),
  scheduled_days integer not null default 0 check (scheduled_days >= 0),
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, acquisition_start),
  check (acquisition_end > acquisition_start)
);

-- ============================================================================
-- 3. BENEFÍCIOS
-- ============================================================================

create table public.rh_benefit_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category public.rh_benefit_category not null,
  provider text,
  monthly_cost numeric(18,2) not null default 0 check (monthly_cost >= 0),
  employee_contribution text,
  eligibility_rule text,
  status public.rh_benefit_plan_status not null default 'active',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- Adesão de um colaborador a um plano.
create table public.rh_benefit_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.rh_benefit_plans(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  enrolled_at date not null default current_date,
  ended_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, employee_id),
  check (ended_at is null or ended_at >= enrolled_at)
);

-- Dependente vinculado a uma adesão (plano de saúde, por exemplo).
create table public.rh_benefit_dependents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.rh_benefit_enrollments(id) on delete cascade,
  full_name text not null,
  relationship text not null,
  birth_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fluxo de solicitação (adesão, alteração, cancelamento, inclusão de dependente).
create table public.rh_benefit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.rh_benefit_plans(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete cascade,
  action public.rh_benefit_request_action not null,
  status public.rh_benefit_request_status not null default 'pending',
  reason text,
  effective_date date,
  requested_by_profile_id uuid references public.profiles(id) on delete set null,
  decided_by_profile_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending', 'under_review') and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null)
  )
);

-- ============================================================================
-- 4. SST — SAÚDE E SEGURANÇA DO TRABALHO
-- ============================================================================

create table public.rh_sst_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  category public.rh_sst_category not null,
  title text not null,
  due_date date,
  completed_at date,
  status public.rh_sst_status not null default 'scheduled',
  risk public.rh_sst_risk not null default 'regular',
  document_id uuid references public.documents(id) on delete set null,
  note text,
  -- Conteúdo clínico é sensível: fica isolado e coberto por classificação.
  clinical_confidential boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 5. ÍNDICES
-- ============================================================================

create index idx_rh_journey_scope
  on public.rh_journey_records(organization_id, department_id, work_date desc);
create index idx_rh_journey_employee
  on public.rh_journey_records(employee_id, work_date desc);
create index idx_rh_absences_scope
  on public.rh_absences(organization_id, status, start_date desc);
create index idx_rh_absences_employee
  on public.rh_absences(employee_id, start_date desc);
create index idx_rh_vacation_employee
  on public.rh_vacation_balances(employee_id, acquisition_start desc);
create index idx_rh_benefit_enrollments_plan
  on public.rh_benefit_enrollments(plan_id, active);
create index idx_rh_benefit_enrollments_employee
  on public.rh_benefit_enrollments(employee_id, active);
create index idx_rh_benefit_requests_pending
  on public.rh_benefit_requests(organization_id, status, requested_at);
create index idx_rh_sst_scope
  on public.rh_sst_records(organization_id, category, status, due_date);
create index idx_rh_sst_employee
  on public.rh_sst_records(employee_id, due_date);

-- ============================================================================
-- 6. TRIGGERS updated_at
-- ============================================================================

create trigger rh_journey_records_updated_at before update on public.rh_journey_records
for each row execute function public.set_updated_at();
create trigger rh_absences_updated_at before update on public.rh_absences
for each row execute function public.set_updated_at();
create trigger rh_vacation_balances_updated_at before update on public.rh_vacation_balances
for each row execute function public.set_updated_at();
create trigger rh_benefit_plans_updated_at before update on public.rh_benefit_plans
for each row execute function public.set_updated_at();
create trigger rh_benefit_enrollments_updated_at before update on public.rh_benefit_enrollments
for each row execute function public.set_updated_at();
create trigger rh_benefit_dependents_updated_at before update on public.rh_benefit_dependents
for each row execute function public.set_updated_at();
create trigger rh_benefit_requests_updated_at before update on public.rh_benefit_requests
for each row execute function public.set_updated_at();
create trigger rh_sst_records_updated_at before update on public.rh_sst_records
for each row execute function public.set_updated_at();

-- ============================================================================
-- 7. AUDITORIA AUTOMÁTICA
-- Reaproveita o padrão do Financeiro: toda mutação sensível vira audit_log.
-- ============================================================================

create or replace function public.audit_rh_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  entity_uuid uuid;
  target_org uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_uuid := nullif(row_data ->> 'id', '')::uuid;
  target_org := nullif(row_data ->> 'organization_id', '')::uuid;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_profile_id, module_code,
    event_type, entity_type, entity_id, risk_level, metadata
  ) values (
    target_org, auth.uid(), public.current_profile_id(), 'rh',
    tg_table_name || '.' || lower(tg_op), tg_table_name, entity_uuid,
    -- Aprovações e SST são as trilhas mais sensíveis do RH.
    case when tg_table_name in ('rh_absences', 'rh_benefit_requests', 'rh_sst_records')
      then 'high' else 'normal' end,
    jsonb_build_object('operation', tg_op)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_rh_mutation() from public;

create trigger rh_absences_audit after insert or update or delete on public.rh_absences
for each row execute function public.audit_rh_mutation();
create trigger rh_benefit_requests_audit after insert or update or delete on public.rh_benefit_requests
for each row execute function public.audit_rh_mutation();
create trigger rh_benefit_enrollments_audit after insert or update or delete on public.rh_benefit_enrollments
for each row execute function public.audit_rh_mutation();
create trigger rh_sst_records_audit after insert or update or delete on public.rh_sst_records
for each row execute function public.audit_rh_mutation();

-- ============================================================================
-- 8. RLS
-- Toda leitura exige: mesma organização + módulo rh integrado e habilitado +
-- permissão rh.view. Escrita exige a permissão específica da ação.
--
-- Exceção de autosserviço: o colaborador vê os PRÓPRIOS registros de jornada,
-- ausência, férias, benefícios e SST não-clínico, mesmo sem rh.view — como o
-- "Meu RH" da interface. O vínculo é employees.profile_id = current_profile_id.
-- ============================================================================

alter table public.rh_journey_records enable row level security;
alter table public.rh_absences enable row level security;
alter table public.rh_vacation_balances enable row level security;
alter table public.rh_benefit_plans enable row level security;
alter table public.rh_benefit_enrollments enable row level security;
alter table public.rh_benefit_dependents enable row level security;
alter table public.rh_benefit_requests enable row level security;
alter table public.rh_sst_records enable row level security;

-- Predicado reutilizável: o registro é do próprio colaborador logado?
-- (inline em cada policy, já que policies não chamam sub-selects nomeados)

-- --- Jornada ----------------------------------------------------------------
create policy rh_journey_read on public.rh_journey_records for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_journey_manage on public.rh_journey_records for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Ausências --------------------------------------------------------------
create policy rh_absences_read on public.rh_absences for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
-- Colaborador cria a própria solicitação; gestor cria para a equipe.
create policy rh_absences_request on public.rh_absences for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and (
    public.has_permission('rh', 'create')
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
-- Decisão (aprovar/reprovar) exige a permissão de aprovação.
create policy rh_absences_decide on public.rh_absences for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'));

-- --- Saldo de férias --------------------------------------------------------
create policy rh_vacation_read on public.rh_vacation_balances for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_vacation_manage on public.rh_vacation_balances for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Planos de benefício (catálogo — leitura ampla para autosserviço) -------
-- O catálogo é "o que a empresa oferece", não dado pessoal. Qualquer membro da
-- organização vê, para poder consultar e solicitar adesão no "Meu RH" — mesmo
-- padrão do catálogo de módulos. O que é pessoal (adesões, dependentes) tem
-- policy própria com o vínculo do colaborador.
create policy rh_benefit_plans_read on public.rh_benefit_plans for select to authenticated
using (organization_id = public.current_organization_id());
create policy rh_benefit_plans_admin on public.rh_benefit_plans for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'admin'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'admin'));

-- --- Adesões ----------------------------------------------------------------
create policy rh_enrollments_read on public.rh_benefit_enrollments for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_enrollments_manage on public.rh_benefit_enrollments for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Dependentes (herdam o acesso da adesão) --------------------------------
create policy rh_dependents_read on public.rh_benefit_dependents for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or enrollment_id in (
      select en.id from public.rh_benefit_enrollments en
      join public.employees e on e.id = en.employee_id
      where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_dependents_manage on public.rh_benefit_dependents for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'edit'));

-- --- Solicitações de benefício ----------------------------------------------
create policy rh_benefit_requests_read on public.rh_benefit_requests for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view'))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_benefit_requests_create on public.rh_benefit_requests for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and (
    public.has_permission('rh', 'create')
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
create policy rh_benefit_requests_decide on public.rh_benefit_requests for update to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'));

-- --- SST --------------------------------------------------------------------
-- Registro não-clínico: colaborador vê o próprio. Conteúdo clínico
-- (clinical_confidential = true) só aparece para quem tem rh.admin.
create policy rh_sst_read on public.rh_sst_records for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh') and public.has_permission('rh', 'view')
      and (clinical_confidential = false or public.has_permission('rh', 'admin')))
    or (
      clinical_confidential = false
      and employee_id in (
        select e.id from public.employees e where e.profile_id = public.current_profile_id()
      )
    )
  )
);
-- Tratar SST (registrar/atualizar exame, treinamento, EPI) exige aprovação.
create policy rh_sst_manage on public.rh_sst_records for all to authenticated
using (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'))
with check (organization_id = public.current_organization_id() and public.has_permission('rh', 'approve'));

-- ============================================================================
-- 9. COMENTÁRIOS
-- ============================================================================

comment on table public.rh_journey_records is 'Marcações de ponto e saldo diário por colaborador; base para banco de horas.';
comment on table public.rh_absences is 'Solicitações e registros de férias, banco de horas, atestados e licenças, com fluxo de aprovação.';
comment on table public.rh_vacation_balances is 'Saldo de férias por período aquisitivo; direito, gozado e programado.';
comment on table public.rh_benefit_plans is 'Catálogo de benefícios oferecidos pela organização.';
comment on table public.rh_benefit_requests is 'Fluxo de adesão, alteração e cancelamento de benefícios, auditado.';
comment on table public.rh_sst_records is 'Exames, treinamentos, EPIs e ocorrências de SST. Conteúdo clínico fica isolado por clinical_confidential e exige rh.admin.';
comment on function public.audit_rh_mutation() is 'Registra em audit_logs toda mutação de ausências, solicitações de benefício, adesões e SST.';

do $$ begin raise notice 'Schema do RH aplicado: 8 tabelas rh_*, RLS e auditoria presentes.'; end $$;
