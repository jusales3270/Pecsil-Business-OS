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
