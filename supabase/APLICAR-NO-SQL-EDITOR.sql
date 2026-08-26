-- ============================================================================
-- Pecsil Business OS — Credenciais, Permissões e Minha Conta
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e execute.
--
--   202608250001_access_hardening   (isolamento por organização)   [aplicada]
--   202608250002_scoped_permissions  (escopo por módulo)           [aplicada]
--   202608250003_identity_audit      (auditoria de identidade)      [aplicada]
--   202608260001_profile_avatar      (foto de perfil)               << NOVA
--
-- Idempotente: reexecutar as já aplicadas não causa efeito colateral.
-- Testado no Postgres local com o schema completo.
-- ============================================================================


-- ####################  202608250001_access_hardening  ####################

-- ============================================================================
-- Pecsil Business OS — Isolamento por organização nas policies administrativas
--
-- Dez policies `for all` verificavam apenas a permissão no USING, sem filtrar a
-- organização. Como as policies permissivas se combinam com OR, o USING de uma
-- policy `for all` também ALARGA o SELECT: na prática, quem tivesse
-- `core.organization.edit` lia e escrevia unidades/departamentos/equipes/cargos
-- de QUALQUER organização, e quem tivesse `core.access.admin` fazia o mesmo com
-- `role_permissions` e `user_roles`.
--
-- Hoje existe uma só organização (Pecsil), então o efeito prático é nulo — mas
-- é uma mina terrestre para o dia em que existir a segunda. Esta migration
-- recria cada policy acrescentando o filtro de organização no USING, sem mudar
-- nenhuma regra de permissão.
--
-- Nada aqui depende da Etapa de escopo; pode ser aplicada isoladamente.
-- ============================================================================

-- --- Estrutura organizacional -----------------------------------------------
drop policy if exists units_admin_all on public.units;
create policy units_admin_all on public.units for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'));

drop policy if exists departments_admin_all on public.departments;
create policy departments_admin_all on public.departments for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'));

drop policy if exists teams_admin_all on public.teams;
create policy teams_admin_all on public.teams for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'));

drop policy if exists positions_admin_all on public.positions;
create policy positions_admin_all on public.positions for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.organization', 'edit'));

-- --- Pessoas ----------------------------------------------------------------
-- O ramo `has_permission` de profiles_read não filtrava a organização.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (
  user_id = auth.uid()
  or (organization_id = public.current_organization_id()
      and public.has_permission('core.people', 'view'))
);

drop policy if exists employees_manage on public.employees;
create policy employees_manage on public.employees for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.people', 'edit'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.people', 'edit'));

-- --- Documentos -------------------------------------------------------------
drop policy if exists documents_manage on public.documents;
create policy documents_manage on public.documents for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.documents', 'edit'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.documents', 'edit'));

-- --- Administração de acessos ----------------------------------------------
drop policy if exists access_admin_roles on public.roles;
create policy access_admin_roles on public.roles for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.access', 'admin'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.access', 'admin'));

drop policy if exists access_admin_scopes on public.access_scopes;
create policy access_admin_scopes on public.access_scopes for all to authenticated
using (organization_id = public.current_organization_id()
       and public.has_permission('core.access', 'admin'))
with check (organization_id = public.current_organization_id()
       and public.has_permission('core.access', 'admin'));

-- role_permissions não tem organization_id: filtra pelo papel dono da linha.
drop policy if exists access_admin_permissions on public.role_permissions;
create policy access_admin_permissions on public.role_permissions for all to authenticated
using (exists (select 1 from public.roles r
               where r.id = role_id
                 and r.organization_id = public.current_organization_id())
       and public.has_permission('core.access', 'admin'))
with check (exists (select 1 from public.roles r
               where r.id = role_id
                 and r.organization_id = public.current_organization_id())
       and public.has_permission('core.access', 'admin'));

-- user_roles também não tem organization_id: filtra pelo perfil alvo.
drop policy if exists access_admin_user_roles on public.user_roles;
create policy access_admin_user_roles on public.user_roles for all to authenticated
using (exists (select 1 from public.profiles p
               where p.id = profile_id
                 and p.organization_id = public.current_organization_id())
       and public.has_permission('core.access', 'admin'))
with check (exists (select 1 from public.profiles p
               where p.id = profile_id
                 and p.organization_id = public.current_organization_id())
       and public.has_permission('core.access', 'admin'));

drop policy if exists user_roles_read on public.user_roles;
create policy user_roles_read on public.user_roles for select to authenticated
using (
  profile_id = public.current_profile_id()
  or (public.has_permission('core.access', 'view')
      and exists (select 1 from public.profiles p
                  where p.id = profile_id
                    and p.organization_id = public.current_organization_id()))
);

-- --- Verificação ------------------------------------------------------------
-- Falha a migration se alguma das policies recriadas ficou sem o filtro de
-- organização — transforma este tipo de defeito em erro de implantação.
do $$
declare
  faltando text;
begin
  select string_agg(policyname, ', ')
    into faltando
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'units_admin_all','departments_admin_all','teams_admin_all','positions_admin_all',
      'profiles_read','employees_manage','documents_manage',
      'access_admin_roles','access_admin_scopes','access_admin_permissions',
      'access_admin_user_roles','user_roles_read'
    )
    and coalesce(qual, '') not like '%current_organization_id%';

  if faltando is not null then
    raise exception 'Policies sem isolamento por organização: %', faltando;
  end if;
end $$;

-- ####################  202608250002_scoped_permissions  ####################

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

-- ####################  202608250003_identity_audit  ####################

-- ============================================================================
-- Pecsil Business OS — Auditoria de identidade (rede de segurança)
--
-- A auditoria PRIMÁRIA das credenciais é feita pela aplicação
-- (`lib/auth/admin-users.ts` → writeAudit), porque só lá o ator é conhecido:
-- as operações de identidade rodam com a service role, e nela `auth.uid()` e
-- `current_profile_id()` são nulos — um trigger sozinho gravaria auditoria sem
-- autor, que é justamente o campo que importa.
--
-- Este trigger existe para o outro fim: provar que NADA alterou identidade por
-- fora da API. Ele marca `metadata->>'source' = 'trigger'`. Um registro de
-- trigger sem o registro correspondente da aplicação no mesmo instante é
-- sinal de alteração feita direto no banco (script, psql, Studio).
-- ============================================================================

create or replace function public.audit_identity_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  entity_uuid uuid;
  target_org uuid;
  target_profile uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_uuid := nullif(row_data ->> 'id', '')::uuid;

  -- `user_roles` não tem organization_id: resolve pelo perfil alvo.
  if tg_table_name = 'user_roles' then
    target_profile := nullif(row_data ->> 'profile_id', '')::uuid;
    select p.organization_id into target_org from public.profiles p where p.id = target_profile;
  else
    target_org := nullif(row_data ->> 'organization_id', '')::uuid;
    if tg_table_name = 'profiles' then
      target_profile := entity_uuid;
    end if;
  end if;

  -- Sem organização não há como registrar (audit_logs.organization_id é
  -- obrigatório); não bloqueia a operação por causa da auditoria.
  if target_org is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, actor_profile_id, module_code,
    event_type, entity_type, entity_id, risk_level, metadata
  ) values (
    target_org,
    auth.uid(),
    public.current_profile_id(),
    'core.access',
    'core.access.' || tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    entity_uuid,
    'sensitive',
    jsonb_build_object(
      'source', 'trigger',
      'profile_id', target_profile,
      -- Nunca copia a linha inteira: evita levar dado pessoal para a trilha.
      'status', row_data ->> 'status',
      'role_id', row_data ->> 'role_id',
      'scope_id', row_data ->> 'scope_id',
      'valid_until', row_data ->> 'valid_until'
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.audit_identity_mutation() from public;

drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit
after insert or update or delete on public.user_roles
for each row execute function public.audit_identity_mutation();

-- Em profiles só interessa a mudança de situação (ativo/bloqueado/desativado);
-- edições de nome não são evento de segurança.
drop trigger if exists profiles_status_audit on public.profiles;
create trigger profiles_status_audit
after update of status on public.profiles
for each row
when (old.status is distinct from new.status)
execute function public.audit_identity_mutation();

drop trigger if exists profiles_create_audit on public.profiles;
create trigger profiles_create_audit
after insert on public.profiles
for each row execute function public.audit_identity_mutation();

-- ####################  202608260001_profile_avatar  ####################

-- ============================================================================
-- Pecsil Business OS — Foto de perfil (autosserviço da conta)
--
-- Acrescenta a foto do usuário e o bucket de Storage correspondente.
--
-- Diferente de `rh-documents`, este bucket é PÚBLICO para leitura: uma foto de
-- perfil precisa aparecer em avatares, listas e cabeçalhos, e URL assinada com
-- validade curta obrigaria a renovar a imagem o tempo todo. Não há dado
-- sensível aqui — e a ESCRITA continua restrita: cada pessoa só grava na
-- própria pasta, cujo nome é o id do perfil.
--
-- Convenção de caminho: {profile_id}/{arquivo}
-- ============================================================================

alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'Caminho do arquivo no bucket "avatars" ({profile_id}/{arquivo}). Nulo = usa as iniciais.';

-- --- Bucket -----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- --- RLS do Storage ---------------------------------------------------------
-- Leitura é pública (o bucket é público). Escrita: só o dono da pasta.
drop policy if exists avatars_objects_insert on storage.objects;
drop policy if exists avatars_objects_update on storage.objects;
drop policy if exists avatars_objects_delete on storage.objects;

create policy avatars_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
);

create policy avatars_objects_update on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
);

create policy avatars_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
);

-- --- Autosserviço do próprio perfil -----------------------------------------
-- `profiles_update_self` já permitia o UPDATE do próprio registro. Recriada
-- aqui apenas para deixar explícito que nome e foto são editáveis pelo dono,
-- mas e-mail, organização e situação NÃO — esses continuam sendo administração.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and organization_id = public.current_organization_id()
);

-- Blindagem: mesmo com a policy acima, um UPDATE direto não pode trocar
-- e-mail, organização, situação nem o vínculo com auth.users.
create or replace function public.profiles_protect_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Administração (service role) passa direto; auth.uid() é nulo nela.
  if auth.uid() is null or new.user_id <> auth.uid() then
    return new;
  end if;
  new.email := old.email;
  new.organization_id := old.organization_id;
  new.status := old.status;
  new.user_id := old.user_id;
  return new;
end;
$$;

revoke all on function public.profiles_protect_self_update() from public;

drop trigger if exists profiles_protect_self on public.profiles;
create trigger profiles_protect_self
before update on public.profiles
for each row execute function public.profiles_protect_self_update();
