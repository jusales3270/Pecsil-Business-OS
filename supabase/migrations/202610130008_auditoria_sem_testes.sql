-- Auditoria central: a trilha não mostra o rastro dos usuários temporários de teste (13/10/2026).
-- Os testes de navegador criam e apagam usuários fictícios (…@pecsil-teste.local, nome "QA …"); o
-- banco guardou o rastro deles (259 de 269 eventos "acesso criado", 910 de 990 registros de acesso).
-- Nada é apagado: a trilha só esconde, salvo quando pedido (p_incluir_testes). Gente de verdade é
-- bloqueada, nunca apagada — então perfil que não existe mais é perfil de teste.
create or replace function public.auditoria_trilha(
  p_desde timestamptz, p_ate timestamptz, p_pessoa uuid default null, p_modulo text default null,
  p_fonte text default null, p_busca text default null, p_entidade text default null, p_limite int default 300, p_incluir_testes boolean default false
)
returns table (
  fonte text, quando timestamptz, pessoa_id uuid, pessoa_nome text, pessoa_email text, modulo text, acao text, resumo text,
  entidade_tipo text, entidade_id text, risco text, detalhes jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lim int := least(greatest(coalesce(p_limite, 300), 1), 2000);
  busca text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  if not public.auditoria_pode_ver() then raise exception 'Sem permissão para a auditoria.' using errcode = '42501'; end if;
  return query
  select * from (
    select case when a.event_type = 'acesso.tela' then 'tela' else 'acao' end::text, a.occurred_at, p.id, p.full_name, p.email, a.module_code, a.event_type,
      coalesce(a.metadata ->> 'secao', a.metadata ->> 'descricao', a.metadata ->> 'nome', a.metadata ->> 'codigo', a.metadata ->> 'acao', ''),
      a.entity_type, a.entity_id::text, a.risk_level, a.metadata
    from public.audit_logs a
    left join public.profiles p on p.id = a.actor_profile_id or (a.actor_profile_id is null and p.user_id = a.actor_user_id)
    where a.organization_id = org and a.occurred_at between p_desde and p_ate
      and (p_fonte is null or p_fonte = case when a.event_type = 'acesso.tela' then 'tela' else 'acao' end)
      and (p_pessoa is null or p.id = p_pessoa)
      and (p_modulo is null or a.module_code = p_modulo)
      and (p_entidade is null or a.entity_id::text = p_entidade)
      and (p_incluir_testes or (
        (p.email is null or p.email not like '%@pecsil-teste.local')
        and coalesce(a.metadata ->> 'email', '') not like '%@pecsil-teste.local'
        and not (a.event_type like 'core.access%' and not exists (
          select 1 from public.profiles x where x.id::text = coalesce(a.metadata ->> 'profile_id', a.entity_id::text)))
      ))
    union all
    select 'evento', e.occurred_at, p.id, coalesce(p.full_name, e.actor_name), p.email, e.module_code, e.event_type, e.summary,
      e.entity_type, e.entity_id, 'normal', e.payload
    from public.module_events e
    left join public.profiles p on p.id = e.actor_profile_id
    where e.organization_id = org and e.occurred_at between p_desde and p_ate
      and (p_fonte is null or p_fonte = 'evento')
      and (p_pessoa is null or p.id = p_pessoa)
      and (p_modulo is null or e.module_code = p_modulo)
      and (p_entidade is null or e.entity_id = p_entidade)
      and (p_incluir_testes or (
        (p.email is null or p.email not like '%@pecsil-teste.local')
        and not (e.module_code = 'acesso' and e.summary ~ '· QA ')
      ))
    union all
    select 'login', l.created_at, p.id, p.full_name, coalesce(p.email, l.payload ->> 'actor_username'), 'acesso',
      'login.' || (l.payload ->> 'action'), '', 'usuario', p.id::text, 'low', '{}'::jsonb
    from auth.audit_log_entries l
    join public.profiles p on p.user_id = (l.payload ->> 'actor_id')::uuid and p.organization_id = org
    where l.created_at between p_desde and p_ate and p_entidade is null
      and (l.payload ->> 'action') in ('login', 'logout', 'user_recovery_requested', 'user_modified')
      and (p_fonte is null or p_fonte = 'login')
      and (p_pessoa is null or p.id = p_pessoa)
      and (p_modulo is null or p_modulo = 'acesso')
      and (p_incluir_testes or p.email not like '%@pecsil-teste.local')
  ) t (fonte, quando, pessoa_id, pessoa_nome, pessoa_email, modulo, acao, resumo, entidade_tipo, entidade_id, risco, detalhes)
  where busca is null or t.resumo ilike '%' || busca || '%' or t.acao ilike '%' || busca || '%' or coalesce(t.pessoa_nome, '') ilike '%' || busca || '%'
     or t.detalhes::text ilike '%' || busca || '%'
  order by t.quando desc
  limit lim;
end;
$$;
revoke all on function public.auditoria_trilha(timestamptz, timestamptz, uuid, text, text, text, text, int, boolean) from public, anon;
grant execute on function public.auditoria_trilha(timestamptz, timestamptz, uuid, text, text, text, text, int, boolean) to authenticated;
