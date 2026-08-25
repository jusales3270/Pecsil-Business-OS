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
