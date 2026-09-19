-- ============================================================================
-- RLS por funcionalidade
-- ============================================================================
-- Cada tabela de negócio passa a checar a FUNCIONALIDADE liberada ao usuário
-- (has_feature), não o módulo inteiro. É o que faz "vê só Férias no RH" valer
-- no banco, e não só na tela. O proprietário passa em todas (has_feature).
--
-- Correções que vêm junto:
-- * gerenciar saldo de férias, inscrições e dados pessoais deixava o próprio
--   colaborador editar os seus (employees_in_scope sempre inclui a pessoa);
-- * Compras e Portaria só checavam a organização.
-- ============================================================================

-- --- RH: Férias e ausências --------------------------------------------------
drop policy if exists rh_absences_read on public.rh_absences;
drop policy if exists rh_absences_request on public.rh_absences;
drop policy if exists rh_absences_decide on public.rh_absences;

create policy rh_absences_read on public.rh_absences for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.ferias')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_absences_request on public.rh_absences for insert to authenticated
with check (organization_id = public.current_organization_id() and (
  public.has_feature('rh.ferias', 'operar')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_absences_decide on public.rh_absences for update to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.ferias', 'aprovar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.ferias', 'aprovar'));

drop policy if exists rh_vacation_read on public.rh_vacation_balances;
drop policy if exists rh_vacation_manage on public.rh_vacation_balances;
create policy rh_vacation_read on public.rh_vacation_balances for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.ferias')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_vacation_manage on public.rh_vacation_balances for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.ferias', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.ferias', 'operar'));

-- --- RH: Ponto e jornada ----------------------------------------------------
drop policy if exists rh_journey_read on public.rh_journey_records;
drop policy if exists rh_journey_manage on public.rh_journey_records;
create policy rh_journey_read on public.rh_journey_records for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.jornada')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_journey_manage on public.rh_journey_records for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.jornada', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.jornada', 'operar'));

-- --- RH: Saúde e segurança (confidencial só em aprovar) ---------------------
drop policy if exists rh_sst_read on public.rh_sst_records;
drop policy if exists rh_sst_manage on public.rh_sst_records;
create policy rh_sst_read on public.rh_sst_records for select to authenticated
using (organization_id = public.current_organization_id() and (
  (public.has_feature('rh.sst') and (clinical_confidential = false or public.has_feature('rh.sst', 'aprovar')))
  or (clinical_confidential = false
      and employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id()))
));
create policy rh_sst_manage on public.rh_sst_records for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.sst', 'operar')
       and (clinical_confidential = false or public.has_feature('rh.sst', 'aprovar')))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.sst', 'operar')
       and (clinical_confidential = false or public.has_feature('rh.sst', 'aprovar')));

-- --- RH: Benefícios ---------------------------------------------------------
drop policy if exists rh_benefit_plans_admin on public.rh_benefit_plans;
create policy rh_benefit_plans_admin on public.rh_benefit_plans for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'operar'));

drop policy if exists rh_enrollments_read on public.rh_benefit_enrollments;
drop policy if exists rh_enrollments_manage on public.rh_benefit_enrollments;
create policy rh_enrollments_read on public.rh_benefit_enrollments for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.beneficios')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_enrollments_manage on public.rh_benefit_enrollments for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'operar'));

drop policy if exists rh_benefit_requests_read on public.rh_benefit_requests;
drop policy if exists rh_benefit_requests_create on public.rh_benefit_requests;
drop policy if exists rh_benefit_requests_decide on public.rh_benefit_requests;
create policy rh_benefit_requests_read on public.rh_benefit_requests for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.beneficios')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_benefit_requests_create on public.rh_benefit_requests for insert to authenticated
with check (organization_id = public.current_organization_id() and (
  public.has_feature('rh.beneficios', 'operar')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_benefit_requests_decide on public.rh_benefit_requests for update to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'aprovar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'aprovar'));

drop policy if exists rh_dependents_manage on public.rh_benefit_dependents;
create policy rh_dependents_manage on public.rh_benefit_dependents for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.beneficios', 'operar'));

-- --- RH: Colaboradores (dados pessoais: CPF, PIS, CTPS) ---------------------
drop policy if exists rh_personal_data_read on public.rh_employee_personal_data;
drop policy if exists rh_personal_data_manage on public.rh_employee_personal_data;
create policy rh_personal_data_read on public.rh_employee_personal_data for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('rh.colaboradores', 'operar')
  or employee_id in (select e.id from public.employees e where e.profile_id = public.current_profile_id())
));
create policy rh_personal_data_manage on public.rh_employee_personal_data for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.colaboradores', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.colaboradores', 'operar'));

-- --- RH: Feriados (leitura segue aberta à organização) ----------------------
drop policy if exists rh_holidays_manage on public.rh_holidays;
create policy rh_holidays_manage on public.rh_holidays for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.feriados', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.feriados', 'operar'));

-- --- RH: Documentos (sensíveis só em aprovar) -------------------------------
drop policy if exists documents_read on public.documents;
drop policy if exists documents_manage on public.documents;
create policy documents_read on public.documents for select to authenticated
using (organization_id = public.current_organization_id() and (
  owner_profile_id = public.current_profile_id()
  or (public.has_feature('rh.documentos')
      and (classification in ('public', 'internal') or public.has_feature('rh.documentos', 'aprovar')))
));
create policy documents_manage on public.documents for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.documentos', 'operar')
       and (classification in ('public', 'internal') or public.has_feature('rh.documentos', 'aprovar')))
with check (organization_id = public.current_organization_id() and public.has_feature('rh.documentos', 'operar')
       and (classification in ('public', 'internal') or public.has_feature('rh.documentos', 'aprovar')));

-- --- Financeiro: títulos por direção (pagar/receber) ------------------------
create or replace function public.finance_direction_feature(dir public.finance_title_direction)
returns text
language sql
immutable
as $$
  select case dir when 'payable' then 'financeiro.pagar' else 'financeiro.receber' end;
$$;

create or replace function public.finance_title_access(target_title uuid, min_level public.access_level)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.finance_titles t
    where t.id = target_title
      and t.organization_id = public.current_organization_id()
      and public.has_feature(public.finance_direction_feature(t.direction), min_level)
  );
$$;

create or replace function public.finance_installment_access(target_installment uuid, min_level public.access_level)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.finance_installments i
    where i.id = target_installment
      and public.finance_title_access(i.title_id, min_level)
  );
$$;

revoke all on function public.finance_title_access(uuid, public.access_level) from public;
revoke all on function public.finance_installment_access(uuid, public.access_level) from public;
grant execute on function public.finance_title_access(uuid, public.access_level) to authenticated;
grant execute on function public.finance_installment_access(uuid, public.access_level) to authenticated;
grant execute on function public.finance_direction_feature(public.finance_title_direction) to authenticated;

drop policy if exists finance_titles_read on public.finance_titles;
drop policy if exists finance_titles_create on public.finance_titles;
drop policy if exists finance_titles_edit on public.finance_titles;
-- Fluxo de caixa, relatórios e conciliação leem os títulos das duas direções.
create policy finance_titles_read on public.finance_titles for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature(public.finance_direction_feature(direction))
  or public.has_feature('financeiro.fluxo')
  or public.has_feature('financeiro.relatorios')
  or public.has_feature('financeiro.bancos')
));
create policy finance_titles_create on public.finance_titles for insert to authenticated
with check (organization_id = public.current_organization_id()
  and public.has_feature(public.finance_direction_feature(direction), 'operar'));
create policy finance_titles_edit on public.finance_titles for update to authenticated
using (organization_id = public.current_organization_id()
  and public.has_feature(public.finance_direction_feature(direction), 'operar'))
with check (organization_id = public.current_organization_id()
  and public.has_feature(public.finance_direction_feature(direction), 'operar'));

drop policy if exists finance_installments_create on public.finance_installments;
drop policy if exists finance_installments_edit on public.finance_installments;
create policy finance_installments_create on public.finance_installments for insert to authenticated
with check (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'));
create policy finance_installments_edit on public.finance_installments for update to authenticated
using (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'))
with check (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'));

drop policy if exists finance_approval_requests_read on public.finance_approval_requests;
drop policy if exists finance_approval_requests_create on public.finance_approval_requests;
drop policy if exists finance_approval_requests_decide on public.finance_approval_requests;
create policy finance_approval_requests_read on public.finance_approval_requests for select to authenticated
using (organization_id = public.current_organization_id() and title_id in (select t.id from public.finance_titles t));
create policy finance_approval_requests_create on public.finance_approval_requests for insert to authenticated
with check (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'operar'));
create policy finance_approval_requests_decide on public.finance_approval_requests for update to authenticated
using (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'aprovar'))
with check (organization_id = public.current_organization_id() and public.finance_title_access(title_id, 'aprovar'));

drop policy if exists finance_settlements_read on public.finance_settlements;
drop policy if exists finance_settlements_create on public.finance_settlements;
drop policy if exists finance_settlements_update on public.finance_settlements;
create policy finance_settlements_read on public.finance_settlements for select to authenticated
using (organization_id = public.current_organization_id() and (
  installment_id in (select i.id from public.finance_installments i)
  or public.has_feature('financeiro.bancos')
));
create policy finance_settlements_create on public.finance_settlements for insert to authenticated
with check (organization_id = public.current_organization_id() and public.finance_installment_access(installment_id, 'aprovar'));
create policy finance_settlements_update on public.finance_settlements for update to authenticated
using (organization_id = public.current_organization_id() and public.finance_installment_access(installment_id, 'aprovar'))
with check (organization_id = public.current_organization_id() and public.finance_installment_access(installment_id, 'aprovar'));

drop policy if exists finance_cost_centers_admin on public.finance_cost_centers;
create policy finance_cost_centers_admin on public.finance_cost_centers for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('financeiro.centros', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('financeiro.centros', 'operar'));

-- --- Compras -----------------------------------------------------------------
drop policy if exists cotacoes_all on public.cotacoes;
create policy cotacoes_read on public.cotacoes for select to authenticated
using (organization_id = public.current_organization_id() and public.has_module('compras'));
create policy cotacoes_create on public.cotacoes for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_feature('compras.cotacoes', 'operar'));
-- Status muda por quem lança, por quem aprova e por quem registra a compra.
create policy cotacoes_update on public.cotacoes for update to authenticated
using (organization_id = public.current_organization_id() and (
  public.has_feature('compras.cotacoes', 'operar')
  or public.has_feature('compras.aprovacoes', 'aprovar')
  or public.has_feature('compras.realizadas', 'operar')))
with check (organization_id = public.current_organization_id() and (
  public.has_feature('compras.cotacoes', 'operar')
  or public.has_feature('compras.aprovacoes', 'aprovar')
  or public.has_feature('compras.realizadas', 'operar')));
create policy cotacoes_delete on public.cotacoes for delete to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('compras.cotacoes', 'operar'));

drop policy if exists cotacao_produtos_all on public.cotacao_produtos;
create policy cotacao_produtos_read on public.cotacao_produtos for select to authenticated
using (cotacao_id in (select c.id from public.cotacoes c));
create policy cotacao_produtos_create on public.cotacao_produtos for insert to authenticated
with check (public.has_feature('compras.cotacoes', 'operar')
  and exists (select 1 from public.cotacoes c where c.id = cotacao_id and c.organization_id = public.current_organization_id()));
create policy cotacao_produtos_update on public.cotacao_produtos for update to authenticated
using ((public.has_feature('compras.cotacoes', 'operar') or public.has_feature('compras.aprovacoes', 'aprovar'))
  and exists (select 1 from public.cotacoes c where c.id = cotacao_id and c.organization_id = public.current_organization_id()))
with check ((public.has_feature('compras.cotacoes', 'operar') or public.has_feature('compras.aprovacoes', 'aprovar'))
  and exists (select 1 from public.cotacoes c where c.id = cotacao_id and c.organization_id = public.current_organization_id()));
create policy cotacao_produtos_delete on public.cotacao_produtos for delete to authenticated
using (public.has_feature('compras.cotacoes', 'operar')
  and exists (select 1 from public.cotacoes c where c.id = cotacao_id and c.organization_id = public.current_organization_id()));

drop policy if exists compras_all on public.compras;
create policy compras_read on public.compras for select to authenticated
using (organization_id = public.current_organization_id() and public.has_module('compras'));
create policy compras_write on public.compras for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('compras.realizadas', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('compras.realizadas', 'operar'));

drop policy if exists notificacoes_compras_all on public.notificacoes_compras;
create policy notificacoes_compras_all on public.notificacoes_compras for all to authenticated
using (organization_id = public.current_organization_id() and public.has_module('compras'))
with check (organization_id = public.current_organization_id() and public.has_module('compras'));

-- --- Portaria: ver / operar / gerenciar (excluir) ----------------------------
do $$
declare
  alvo record;
begin
  for alvo in
    select * from (values
      ('visitantes', 'visitantes_org_policy', 'portaria.visitas'),
      ('visitas',    'visitas_org_policy',    'portaria.visitas'),
      ('terceiros',  'terceiros_org_policy',  'portaria.terceiros'),
      ('encomendas', 'encomendas_org_policy', 'portaria.recebidos'),
      ('frota',      'frota_org_policy',      'portaria.veiculos')
    ) as t(tabela, antiga, feature)
  loop
    execute format('drop policy if exists %I on public.%I', alvo.antiga, alvo.tabela);
    execute format('drop policy if exists %I on public.%I', alvo.tabela || '_read', alvo.tabela);
    execute format('drop policy if exists %I on public.%I', alvo.tabela || '_insert', alvo.tabela);
    execute format('drop policy if exists %I on public.%I', alvo.tabela || '_update', alvo.tabela);
    execute format('drop policy if exists %I on public.%I', alvo.tabela || '_delete', alvo.tabela);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (organization_id = public.current_organization_id() and public.has_feature(%L))$p$,
      alvo.tabela || '_read', alvo.tabela, alvo.feature);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (organization_id = public.current_organization_id() and public.has_feature(%L, 'operar'))$p$,
      alvo.tabela || '_insert', alvo.tabela, alvo.feature);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (organization_id = public.current_organization_id() and public.has_feature(%L, 'operar'))
      with check (organization_id = public.current_organization_id() and public.has_feature(%L, 'operar'))$p$,
      alvo.tabela || '_update', alvo.tabela, alvo.feature, alvo.feature);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (organization_id = public.current_organization_id() and public.has_feature(%L, 'aprovar'))$p$,
      alvo.tabela || '_delete', alvo.tabela, alvo.feature);
  end loop;
end $$;
