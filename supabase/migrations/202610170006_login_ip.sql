-- B-11 (roadmap) · IP do login na Auditoria.
-- O GoTrue (v2.189.0) grava o login em auth.audit_log_entries com o ip_address VAZIO de propósito
-- (no código: NewAuditLogEntry(..., models.LoginAction, "", ...)); nenhuma configuração muda isso.
-- A plataforma passa a guardar o IP que o Traefik entrega (X-Forwarded-For; o Traefik descarta o que
-- vem do navegador e põe o IP de quem conectou), nos dois logins:
--   * senha: o gateway /sb, quando auth/v1/token?grant_type=password responde 200;
--   * digital: a rota /api/auth/digital/login, depois de criar a sessão.
-- Fica numa tabela própria, sem leitura nem escrita pelos usuários (só a chave do servidor grava);
-- a Auditoria mostra o IP e o aparelho no próprio login. IP é dado pessoal: serve só à auditoria.

create table if not exists public.login_ips (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  via text not null check (via in ('senha', 'digital')),
  occurred_at timestamptz not null default now()
);
create index if not exists idx_login_ips_user on public.login_ips (user_id, occurred_at desc);
alter table public.login_ips enable row level security;
revoke all on public.login_ips from anon, authenticated;

CREATE OR REPLACE FUNCTION public.auditoria_trilha(p_desde timestamp with time zone, p_ate timestamp with time zone, p_pessoa uuid DEFAULT NULL::uuid, p_modulo text DEFAULT NULL::text, p_fonte text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_entidade text DEFAULT NULL::text, p_limite integer DEFAULT 300, p_incluir_testes boolean DEFAULT false)
 RETURNS TABLE(fonte text, quando timestamp with time zone, pessoa_id uuid, pessoa_nome text, pessoa_email text, modulo text, acao text, resumo text, entidade_tipo text, entidade_id text, risco text, detalhes jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'login.' || (l.payload ->> 'action'),
      coalesce(case when li.ip is not null then 'IP ' || host(li.ip) || case when li.via = 'digital' then ' · digital' else '' end end, ''),
      'usuario', p.id::text, 'low',
      coalesce(jsonb_strip_nulls(jsonb_build_object('ip', host(li.ip), 'aparelho', li.user_agent, 'via', li.via)), '{}'::jsonb)
    from auth.audit_log_entries l
    join public.profiles p on p.user_id = (l.payload ->> 'actor_id')::uuid and p.organization_id = org
    -- IP do login: o GoTrue grava o ip_address vazio no login; a plataforma grava o IP que o proxy
    -- entrega (login_ips) e liga ao login da mesma pessoa no mesmo instante.
    left join lateral (
      select x.ip, x.user_agent, x.via from public.login_ips x
      where (l.payload ->> 'action') = 'login' and x.user_id = p.user_id
        and x.occurred_at between l.created_at - interval '30 seconds' and l.created_at + interval '30 seconds'
      order by abs(extract(epoch from x.occurred_at - l.created_at)) limit 1
    ) li on true
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
$function$;
