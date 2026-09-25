-- ============================================================================
-- RH — histórico de férias e afastamentos, com o dado clínico isolado
-- ============================================================================
-- O histórico da PecSil (planilha por colaborador) traz o que a estrutura
-- original não previa:
--
--   * ausência de horas ou de meio período ("2h50", "Período tarde");
--   * férias fracionadas e abono pecuniário, que só fecham o saldo se cada gozo
--     apontar para o período aquisitivo de onde saiu;
--   * diagnóstico e CID — dado de saúde, sensível pela LGPD (art. 11).
--
-- `rh_absences.reason` é lido por quem tem `rh.ferias` em ver. Por isso o dado
-- clínico mora em `rh_absence_clinical`, com função de acesso própria
-- (`rh.clinico`), que o proprietário concede pessoa a pessoa. O colaborador lê
-- a própria ausência, mas não o clínico dela pela plataforma.
-- ============================================================================

-- --- Ausência em horas ou meio período --------------------------------------
alter table public.rh_absences
  add column if not exists hours numeric(5,2) check (hours is null or (hours > 0 and hours <= 24)),
  add column if not exists day_part text check (day_part is null or day_part in ('manha', 'tarde')),
  add column if not exists vacation_balance_id uuid references public.rh_vacation_balances(id) on delete set null,
  add column if not exists source text,
  add column if not exists source_key text;

-- Dias inteiros, ou zero quando a ausência é de horas ou de meio período.
alter table public.rh_absences drop constraint if exists rh_absences_days_check;
alter table public.rh_absences add constraint rh_absences_days_check check (
  days > 0 or (days = 0 and (hours is not null or day_part is not null))
);

-- Importação reexecutável: a mesma linha da planilha não entra duas vezes.
-- Restrição comum (não índice parcial) para o upsert poder usá-la; nulo não
-- conflita com nulo, então as solicitações feitas na tela não são afetadas.
drop index if exists public.uq_rh_absences_source_key;
alter table public.rh_absences drop constraint if exists rh_absences_source_key_key;
alter table public.rh_absences add constraint rh_absences_source_key_key unique (organization_id, source_key);
create index if not exists idx_rh_absences_balance on public.rh_absences(vacation_balance_id)
  where vacation_balance_id is not null;
create index if not exists idx_rh_absences_fila on public.rh_absences(organization_id, status, start_date desc);

-- --- Abono pecuniário e origem do período -----------------------------------
alter table public.rh_vacation_balances
  add column if not exists pecuniary_days integer not null default 0
    check (pecuniary_days between 0 and 10),
  add column if not exists source text;

-- --- Dado clínico da ausência -----------------------------------------------
create table if not exists public.rh_absence_clinical (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  absence_id uuid not null unique references public.rh_absences(id) on delete cascade,
  cid_codes text[] not null default '{}',
  diagnosis text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists rh_absence_clinical_updated_at on public.rh_absence_clinical;
create trigger rh_absence_clinical_updated_at before update on public.rh_absence_clinical
for each row execute function public.set_updated_at();

-- Toda escrita no dado clínico fica na trilha de auditoria (só a operação,
-- nunca o conteúdo), com risco alto.
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
    -- Aprovações, SST e dado clínico são as trilhas mais sensíveis do RH.
    case when tg_table_name in ('rh_absences', 'rh_benefit_requests', 'rh_sst_records', 'rh_absence_clinical')
      then 'high' else 'normal' end,
    jsonb_build_object('operation', tg_op)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists rh_absence_clinical_audit on public.rh_absence_clinical;
create trigger rh_absence_clinical_audit after insert or update or delete on public.rh_absence_clinical
for each row execute function public.audit_rh_mutation();

alter table public.rh_absence_clinical enable row level security;
drop policy if exists rh_absence_clinical_read on public.rh_absence_clinical;
create policy rh_absence_clinical_read on public.rh_absence_clinical for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.clinico'));
drop policy if exists rh_absence_clinical_write on public.rh_absence_clinical;
create policy rh_absence_clinical_write on public.rh_absence_clinical for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.clinico', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.clinico', 'operar'));

comment on table public.rh_absence_clinical is
  'Diagnóstico, CID e observação clínica de uma ausência. Dado sensível (LGPD art. 11): só com rh.clinico. Nunca enviar a serviço externo.';

-- --- Função de acesso -------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('rh.clinico',            'rh',         'Dados clínicos',       '{ver,operar}',         65)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;
