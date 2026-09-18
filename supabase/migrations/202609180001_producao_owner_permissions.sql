-- ============================================================================
-- Produção: permissões do Proprietário
-- ============================================================================
-- A Produção passou a ler o Forja por /api/forja/dashboard, que exige
-- has_scoped_permission('producao', 'view'). Só o Gestor tinha Produção em
-- role_permissions; o Proprietário, que enxerga todos os módulos, ficava de
-- fora. Mesmo conjunto de ações que ele tem em Compras e Portaria.
-- ============================================================================

insert into public.role_permissions (role_id, module_code, action, granted)
select r.id, 'producao', act.action::public.permission_action, true
from public.roles r
cross join (values ('view'), ('create'), ('edit'), ('approve'), ('export')) as act(action)
where r.code = 'owner'
on conflict (role_id, module_code, action) do update set granted = true;
