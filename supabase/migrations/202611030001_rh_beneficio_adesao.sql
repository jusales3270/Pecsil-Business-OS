-- RH: a movimentação de benefício aprovada vira adesão (03/11/2026).
--
--   * Até aqui, aprovar uma solicitação só mudava a situação dela: nada entrava em rh_benefit_enrollments, que é
--     de onde saem os participantes, o custo do painel e os benefícios da ficha. A Rosana aprovou e "nada gravou".
--   * Agora, ao aprovar (gatilho, no banco, para valer em qualquer tela):
--       adesão     → adesão ativa do colaborador no benefício, com o valor mensal e a vigência da solicitação;
--       alteração  → a adesão ativa passa a ter o valor novo (sem adesão, cria uma);
--       cancelamento → a adesão fica inativa, com o fim na vigência;
--       inclusão de dependente → não mexe na adesão.
--   * A adesão guarda de que solicitação veio (request_id) e o valor (monthly_value).
--   * As solicitações já aprovadas entram agora, na ordem em que foram aprovadas.

alter table public.rh_benefit_enrollments add column if not exists monthly_value numeric(18,2);
alter table public.rh_benefit_enrollments add column if not exists request_id uuid
  references public.rh_benefit_requests(id) on delete set null;
alter table public.rh_benefit_enrollments drop constraint if exists rh_benefit_enrollments_monthly_value_ck;
alter table public.rh_benefit_enrollments add constraint rh_benefit_enrollments_monthly_value_ck
  check (monthly_value is null or monthly_value >= 0);
comment on column public.rh_benefit_enrollments.monthly_value is 'Valor mensal do benefício para o colaborador (R$), da solicitação aprovada.';
comment on column public.rh_benefit_enrollments.request_id is 'Solicitação aprovada que criou ou mudou esta adesão por último.';

create or replace function public.rh_benefit_aplicar_solicitacao(r public.rh_benefit_requests)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inicio date := coalesce(r.effective_date, current_date);
begin
  if r.action in ('enroll', 'change') then
    insert into public.rh_benefit_enrollments (organization_id, plan_id, employee_id, enrolled_at, ended_at, active, monthly_value, request_id)
    values (r.organization_id, r.plan_id, r.employee_id, inicio, null, true, r.monthly_value, r.id)
    on conflict (plan_id, employee_id) do update set
      -- Adesão nova (ou que estava encerrada) começa na vigência; alteração mantém o início e troca o valor.
      enrolled_at = case when r.action = 'enroll' or not public.rh_benefit_enrollments.active then excluded.enrolled_at
                         else public.rh_benefit_enrollments.enrolled_at end,
      ended_at = null,
      active = true,
      monthly_value = coalesce(excluded.monthly_value, public.rh_benefit_enrollments.monthly_value),
      request_id = excluded.request_id;
  elsif r.action = 'cancel' then
    update public.rh_benefit_enrollments
       set active = false, ended_at = inicio, request_id = r.id
     where plan_id = r.plan_id and employee_id = r.employee_id and organization_id = r.organization_id;
  end if;
end;
$$;
revoke all on function public.rh_benefit_aplicar_solicitacao(public.rh_benefit_requests) from public, anon, authenticated;

create or replace function public.rh_benefit_request_aprovada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.rh_benefit_aplicar_solicitacao(new);
  end if;
  return new;
end;
$$;
revoke all on function public.rh_benefit_request_aprovada() from public, anon, authenticated;

drop trigger if exists rh_benefit_requests_aplicar on public.rh_benefit_requests;
create trigger rh_benefit_requests_aplicar after update of status on public.rh_benefit_requests
for each row execute function public.rh_benefit_request_aprovada();

-- As já aprovadas, na ordem da aprovação (a última decide o valor de quem tem duas).
do $$
declare r public.rh_benefit_requests;
begin
  for r in select * from public.rh_benefit_requests where status = 'approved' order by decided_at nulls first, created_at loop
    perform public.rh_benefit_aplicar_solicitacao(r);
  end loop;
end;
$$;
