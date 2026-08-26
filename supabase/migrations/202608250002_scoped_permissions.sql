-- ============================================================================
-- Pecsil Business OS — Escopo aplicado de verdade
--
-- O Blueprint define a autorização como
--   Usuário + Papel + Módulo + Ação + Escopo
-- mas até aqui o escopo era decorativo: `has_permission()` ignora
-- `user_roles.scope_id` de propósito, e `can_access_entity()` era chamada por
-- apenas 2 das 79 policies. Na prática um Gestor "do departamento X" enxergava
-- o RH e o Financeiro inteiros da organização.
--
-- Há ainda um defeito mais sutil: como permissão e escopo eram avaliados por
-- funções independentes, eles se CRUZAVAM. Um usuário com "gestor @ produção"
-- e "colaborador @ empresa" combinava a permissão de gestor com o escopo de
-- empresa. Permissão e escopo precisam sair do MESMO vínculo.
--
-- Solução: uma função que percorre user_roles → role_permissions →
-- access_scopes em UM ÚNICO join, garantindo a tupla atômica.
--
-- Propriedade que torna a adoção barata: `has_scoped_permission(m, a)` chamada
-- SEM alvo só é verdadeira para escopos 'company' e 'module'. Ou seja, é um
-- substituto seguro de `has_permission(m, a)` nas tabelas que não têm coluna de
-- escopo, e passa a restringir de fato nas que têm.
--
-- `has_permission` e `can_access_entity` continuam existindo: a rota
-- /api/admin/users as chama por RPC.
-- ============================================================================

-- --- 1. Concessões ativas (permissão e escopo do mesmo vínculo) -------------
create or replace function public.permission_grants(
  requested_module text,
  requested_action public.permission_action
)
returns table (scope_type public.scope_type, entity_id uuid, module_code text)
language sql
stable
security definer
set search_path = public
as $$
  select s.scope_type, s.entity_id, s.module_code
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.access_scopes s on s.id = ur.scope_id
  where ur.profile_id = public.current_profile_id()
    and s.organization_id = public.current_organization_id()
    and rp.module_code = requested_module
    and rp.action = requested_action
    and rp.granted = true
    and ur.valid_from <= now()
    and (ur.valid_until is null or ur.valid_until > now());
$$;

-- --- 2. O predicado atômico -------------------------------------------------
create or replace function public.has_scoped_permission(
  requested_module   text,
  requested_action   public.permission_action,
  target_unit        uuid default null,
  target_department  uuid default null,
  target_team        uuid default null,
  target_profile     uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with alvo as (
    -- Sobe a hierarquia: um alvo de equipe também pertence a um departamento e
    -- a uma unidade, então um escopo de unidade alcança a equipe.
    select
      coalesce(
        target_unit,
        (select d.unit_id from public.departments d where d.id = target_department),
        (select d.unit_id from public.teams t
           join public.departments d on d.id = t.department_id where t.id = target_team)
      ) as unit_id,
      coalesce(
        target_department,
        (select t.department_id from public.teams t where t.id = target_team)
      ) as department_id,
      target_team as team_id
  )
  select exists (
    select 1
    from public.permission_grants(requested_module, requested_action) g, alvo a
    where case g.scope_type
      when 'company'    then g.entity_id = public.current_organization_id()
      -- `entity_id is not null` neutraliza escopos malformados legados: eles
      -- deixam de casar com qualquer coisa em vez de casar imprevisivelmente.
      when 'unit'       then g.entity_id is not null and g.entity_id = a.unit_id
      when 'department' then g.entity_id is not null and g.entity_id = a.department_id
      when 'team'       then g.entity_id is not null and g.entity_id = a.team_id
      -- Escopo de MÓDULO: é assim que a PecSil organiza o acesso — a pessoa é
      -- "Gestor do Financeiro", "Diretor do RH". Restringe os módulos de
      -- negócio (rh, financeiro, compras, ...) mas NÃO os serviços
      -- compartilhados da Fundação (core.*, platform.*): sem eles o usuário
      -- perderia pessoas, busca e notificações, que todo mundo precisa.
      when 'module'     then g.module_code = requested_module
                             or requested_module like 'core.%'
                             or requested_module like 'platform.%'
      when 'self'       then target_profile is not null
                             and target_profile = public.current_profile_id()
    end
  );
$$;

-- --- 3. Resolvedores de conjunto -------------------------------------------
-- Para tabelas ancoradas só por employee_id / cost_center_id. Devolvem um
-- conjunto (avaliado uma vez por consulta) em vez de uma chamada por linha.
create or replace function public.employees_in_scope(
  requested_module text,
  requested_action public.permission_action default 'view'
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where e.organization_id = public.current_organization_id()
    and (
      e.profile_id = public.current_profile_id()
      or public.has_scoped_permission(
           requested_module, requested_action,
           e.unit_id, e.department_id, e.team_id, e.profile_id)
    );
$$;

create or replace function public.cost_centers_in_scope(
  requested_action public.permission_action default 'view'
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.finance_cost_centers c
  where c.organization_id = public.current_organization_id()
    and public.has_scoped_permission(
          'financeiro', requested_action, c.unit_id, c.department_id, null, null);
$$;

revoke all on function public.permission_grants(text, public.permission_action) from public;
revoke all on function public.has_scoped_permission(text, public.permission_action, uuid, uuid, uuid, uuid) from public;
revoke all on function public.employees_in_scope(text, public.permission_action) from public;
revoke all on function public.cost_centers_in_scope(public.permission_action) from public;
grant execute on function public.permission_grants(text, public.permission_action) to authenticated;
grant execute on function public.has_scoped_permission(text, public.permission_action, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.employees_in_scope(text, public.permission_action) to authenticated;
grant execute on function public.cost_centers_in_scope(public.permission_action) to authenticated;

comment on function public.has_permission(text, public.permission_action) is
  'Legado: ignora o escopo. Preferir has_scoped_permission. Mantida para o RPC de /api/admin/users.';
comment on function public.can_access_entity(uuid, uuid, uuid, uuid, uuid, text) is
  'Legado: avalia escopo separado da permissão. Substituída por has_scoped_permission.';

-- --- 4. Higiene dos escopos -------------------------------------------------
-- Escopos de unidade/departamento/equipe sem entidade nunca casaram com nada.
delete from public.access_scopes s
 where s.scope_type in ('unit', 'department', 'team')
   and s.entity_id is null
   and not exists (select 1 from public.user_roles ur where ur.scope_id = s.id);

alter table public.access_scopes drop constraint if exists access_scopes_entity_required;
alter table public.access_scopes
  add constraint access_scopes_entity_required
  check (
    (scope_type in ('unit', 'department', 'team', 'company') and entity_id is not null)
    or scope_type in ('self', 'module')
  ) not valid;

-- --- 5. Fundação: pessoas e documentos --------------------------------------
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    profile_id = public.current_profile_id()
    or public.has_scoped_permission(
         'core.people', 'view', unit_id, department_id, team_id, profile_id)
  )
);

drop policy if exists employees_manage on public.employees;
create policy employees_manage on public.employees for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_scoped_permission(
             'core.people', 'edit', unit_id, department_id, team_id, profile_id))
with check (organization_id = public.current_organization_id()
       and public.has_scoped_permission(
             'core.people', 'edit', unit_id, department_id, team_id, profile_id));

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    owner_profile_id = public.current_profile_id()
    or public.has_scoped_permission(
         'core.documents', 'view', unit_id, department_id, team_id, owner_profile_id)
  )
);

-- --- 6. RH ------------------------------------------------------------------
-- Tabelas com unit_id/department_id próprios.
drop policy if exists rh_journey_read on public.rh_journey_records;
create policy rh_journey_read on public.rh_journey_records for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh')
      and public.has_scoped_permission('rh', 'view', unit_id, department_id, null, null))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
drop policy if exists rh_journey_manage on public.rh_journey_records;
create policy rh_journey_manage on public.rh_journey_records for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_scoped_permission('rh', 'edit', unit_id, department_id, null, null))
with check (organization_id = public.current_organization_id()
       and public.has_scoped_permission('rh', 'edit', unit_id, department_id, null, null));

drop policy if exists rh_absences_read on public.rh_absences;
create policy rh_absences_read on public.rh_absences for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh')
      and public.has_scoped_permission('rh', 'view', unit_id, department_id, null, null))
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
drop policy if exists rh_absences_request on public.rh_absences;
create policy rh_absences_request on public.rh_absences for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and (
    public.has_scoped_permission('rh', 'create', unit_id, department_id, null, null)
    or employee_id in (
      select e.id from public.employees e where e.profile_id = public.current_profile_id()
    )
  )
);
drop policy if exists rh_absences_decide on public.rh_absences;
create policy rh_absences_decide on public.rh_absences for update to authenticated
using (organization_id = public.current_organization_id()
       and public.has_scoped_permission('rh', 'approve', unit_id, department_id, null, null))
with check (organization_id = public.current_organization_id()
       and public.has_scoped_permission('rh', 'approve', unit_id, department_id, null, null));

drop policy if exists rh_sst_read on public.rh_sst_records;
create policy rh_sst_read on public.rh_sst_records for select to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    (public.can_access_module('rh')
      and public.has_scoped_permission('rh', 'view', unit_id, department_id, null, null)
      and (clinical_confidential = false or public.has_permission('rh', 'admin')))
    or (
      clinical_confidential = false
      and employee_id in (
        select e.id from public.employees e where e.profile_id = public.current_profile_id()
      )
    )
  )
);
drop policy if exists rh_sst_manage on public.rh_sst_records;
create policy rh_sst_manage on public.rh_sst_records for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_scoped_permission('rh', 'approve', unit_id, department_id, null, null))
with check (organization_id = public.current_organization_id()
       and public.has_scoped_permission('rh', 'approve', unit_id, department_id, null, null));

-- Tabelas ancoradas por employee_id: employees_in_scope já inclui o próprio
-- registro, então a disjunção de autosserviço deixa de ser necessária.
drop policy if exists rh_vacation_read on public.rh_vacation_balances;
create policy rh_vacation_read on public.rh_vacation_balances for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_access_module('rh')
  and employee_id in (select public.employees_in_scope('rh', 'view'))
);
drop policy if exists rh_vacation_manage on public.rh_vacation_balances;
create policy rh_vacation_manage on public.rh_vacation_balances for all to authenticated
using (organization_id = public.current_organization_id()
       and employee_id in (select public.employees_in_scope('rh', 'edit')))
with check (organization_id = public.current_organization_id()
       and employee_id in (select public.employees_in_scope('rh', 'edit')));

drop policy if exists rh_enrollments_read on public.rh_benefit_enrollments;
create policy rh_enrollments_read on public.rh_benefit_enrollments for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_access_module('rh')
  and employee_id in (select public.employees_in_scope('rh', 'view'))
);
drop policy if exists rh_enrollments_manage on public.rh_benefit_enrollments;
create policy rh_enrollments_manage on public.rh_benefit_enrollments for all to authenticated
using (organization_id = public.current_organization_id()
       and employee_id in (select public.employees_in_scope('rh', 'edit')))
with check (organization_id = public.current_organization_id()
       and employee_id in (select public.employees_in_scope('rh', 'edit')));

drop policy if exists rh_benefit_requests_read on public.rh_benefit_requests;
create policy rh_benefit_requests_read on public.rh_benefit_requests for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_access_module('rh')
  and employee_id in (select public.employees_in_scope('rh', 'view'))
);
drop policy if exists rh_benefit_requests_create on public.rh_benefit_requests;
create policy rh_benefit_requests_create on public.rh_benefit_requests for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and employee_id in (select public.employees_in_scope('rh', 'create'))
);
drop policy if exists rh_benefit_requests_decide on public.rh_benefit_requests;
create policy rh_benefit_requests_decide on public.rh_benefit_requests for update to authenticated
using (organization_id = public.current_organization_id()
       and employee_id in (select public.employees_in_scope('rh', 'approve')))
with check (organization_id = public.current_organization_id()
       and employee_id in (select public.employees_in_scope('rh', 'approve')));

-- Dependentes: encadeia pela adesão, cujo RLS já aplica o escopo.
drop policy if exists rh_dependents_read on public.rh_benefit_dependents;
create policy rh_dependents_read on public.rh_benefit_dependents for select to authenticated
using (
  organization_id = public.current_organization_id()
  and enrollment_id in (select id from public.rh_benefit_enrollments)
);

-- --- 7. Financeiro ----------------------------------------------------------
-- Ancorado pelo centro de custo. Títulos sem centro de custo não têm âncora de
-- escopo: só quem tem concessão de abrangência organizacional os enxerga — que
-- é exatamente o que has_scoped_permission sem alvo expressa.
drop policy if exists finance_cost_centers_read on public.finance_cost_centers;
create policy finance_cost_centers_read on public.finance_cost_centers for select to authenticated
using (organization_id = public.current_organization_id()
       and public.can_access_module('financeiro')
       and public.has_scoped_permission('financeiro', 'view', unit_id, department_id, null, null));

drop policy if exists finance_titles_read on public.finance_titles;
create policy finance_titles_read on public.finance_titles for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_access_module('financeiro')
  and (
    cost_center_id in (select public.cost_centers_in_scope('view'))
    or (cost_center_id is null and public.has_scoped_permission('financeiro', 'view'))
  )
);
drop policy if exists finance_titles_edit on public.finance_titles;
create policy finance_titles_edit on public.finance_titles for update to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    cost_center_id in (select public.cost_centers_in_scope('edit'))
    or (cost_center_id is null and public.has_scoped_permission('financeiro', 'edit'))
  )
)
with check (
  organization_id = public.current_organization_id()
  and (
    cost_center_id in (select public.cost_centers_in_scope('edit'))
    or (cost_center_id is null and public.has_scoped_permission('financeiro', 'edit'))
  )
);

-- Parcelas herdam o escopo do título: o RLS de finance_titles se aplica ao
-- subselect, então não é preciso repetir o predicado.
drop policy if exists finance_installments_read on public.finance_installments;
create policy finance_installments_read on public.finance_installments for select to authenticated
using (
  organization_id = public.current_organization_id()
  and public.can_access_module('financeiro')
  and title_id in (select id from public.finance_titles)
);

-- --- 8. Verificação ---------------------------------------------------------
do $$
declare
  sem_escopo text;
begin
  -- As policies de leitura das tabelas com âncora de escopo precisam consultar
  -- has_scoped_permission ou um dos resolvedores de conjunto.
  select string_agg(policyname, ', ')
    into sem_escopo
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'employees_read','documents_read',
      'rh_journey_read','rh_absences_read','rh_sst_read',
      'rh_vacation_read','rh_enrollments_read','rh_benefit_requests_read',
      'finance_cost_centers_read','finance_titles_read'
    )
    and coalesce(qual, '') not like '%scope%';

  if sem_escopo is not null then
    raise exception 'Policies de leitura sem aplicação de escopo: %', sem_escopo;
  end if;
end $$;
