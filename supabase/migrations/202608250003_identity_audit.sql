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
