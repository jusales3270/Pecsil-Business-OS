-- Auditoria central (13/10/2026, pedido do proprietário: "saber quem acessou, o que fez, aprovou").
--
-- O banco já guarda três trilhas, desde 01/09/2026:
--   · audit_logs        — ações (quem lançou, alterou, excluiu, aprovou), por gatilho e pelas rotas;
--   · module_events     — a linha do tempo do negócio (portaria, compras, OS, orçamentos…);
--   · auth.audit_log_entries — entradas e saídas do sistema (login, logout).
-- Esta migração junta as três numa leitura só (quem tem Fundação › Auditoria, ou o proprietário),
-- passa a registrar a abertura de telas (só dali em diante), dá o último acesso de cada pessoa e
-- liga a auditoria com "o que mudou" (antes → depois) nos cadastros e documentos de venda.

-- --- Auditoria com o que mudou ------------------------------------------------------------------
-- Campos que não dizem nada (carimbos de data) ficam de fora; texto longo é cortado.
-- (Permissões já são auditadas pela tela de Pessoas e Acessos, com antes e depois; itens de
-- orçamento são regravados a cada salvar — o cabeçalho e as anotações contam a história.)
create or replace function public.audit_mudanca()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  antes jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  depois jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  linha jsonb := coalesce(depois, antes);
  mudou jsonb := '{}'::jsonb;
  k text;
  corta constant int := 200;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(depois) loop
      continue when k in ('updated_at', 'created_at', 'synced_at', 'normalized_name');
      if (antes -> k) is distinct from (depois -> k) then
        mudou := mudou || jsonb_build_object(k, jsonb_build_array(left(antes ->> k, corta), left(depois ->> k, corta)));
      end if;
    end loop;
    if mudou = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (
    nullif(linha ->> 'organization_id', '')::uuid, auth.uid(), public.current_profile_id(), coalesce(tg_argv[0], 'core'),
    tg_table_name || '.' || lower(tg_op), tg_table_name, nullif(linha ->> 'id', '')::uuid,
    coalesce(tg_argv[1], 'normal'),
    jsonb_build_object('operation', tg_op)
      || case when tg_op = 'UPDATE' then jsonb_build_object('mudou', mudou) else '{}'::jsonb end
      || case when linha ? 'numero' then jsonb_build_object('numero', linha -> 'numero') else '{}'::jsonb end
      || case when linha ? 'codigo' then jsonb_build_object('codigo', linha -> 'codigo') else '{}'::jsonb end
      || case when linha ? 'descricao' then jsonb_build_object('descricao', left(linha ->> 'descricao', 120)) else '{}'::jsonb end
      || case when linha ? 'name' then jsonb_build_object('nome', left(linha ->> 'name', 120)) else '{}'::jsonb end
      || case when linha ? 'quantidade' then jsonb_build_object('quantidade', linha -> 'quantidade') else '{}'::jsonb end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_mudanca() from public, anon, authenticated;

drop trigger if exists products_auditoria on public.products;
create trigger products_auditoria after insert or update or delete on public.products for each row execute function public.audit_mudanca('comercial');
drop trigger if exists product_groups_auditoria on public.product_groups;
create trigger product_groups_auditoria after insert or update or delete on public.product_groups for each row execute function public.audit_mudanca('comercial');
drop trigger if exists sales_quotes_auditoria on public.sales_quotes;
create trigger sales_quotes_auditoria after insert or update or delete on public.sales_quotes for each row execute function public.audit_mudanca('comercial');
drop trigger if exists production_entries_auditoria on public.production_entries;
create trigger production_entries_auditoria after insert or update or delete on public.production_entries for each row execute function public.audit_mudanca('producao');
drop trigger if exists customers_auditoria on public.customers;
create trigger customers_auditoria after insert or update or delete on public.customers for each row execute function public.audit_mudanca('cadastros');

-- --- Abertura de telas (só dali em diante) -----------------------------------------------------
-- A própria pessoa registra (o autor é a sessão, nunca o parâmetro). A mesma tela não se repete
-- em menos de 15 minutos, para a trilha não virar ruído.
create or replace function public.auditoria_registrar_acesso(p_modulo text, p_secao text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  perfil uuid := public.current_profile_id();
  modulo text := left(regexp_replace(coalesce(p_modulo, ''), '[^a-z0-9_.-]', '', 'gi'), 40);
  secao text := left(btrim(coalesce(p_secao, '')), 80);
begin
  if org is null or perfil is null or modulo = '' then return; end if;
  if exists (
    select 1 from public.audit_logs
    where organization_id = org and actor_profile_id = perfil and event_type = 'acesso.tela'
      and module_code = modulo and coalesce(metadata ->> 'secao', '') = secao and occurred_at > now() - interval '15 minutes'
  ) then return; end if;
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, risk_level, metadata)
  values (org, auth.uid(), perfil, modulo, 'acesso.tela', 'tela', 'low', jsonb_build_object('secao', nullif(secao, '')));
end;
$$;
revoke all on function public.auditoria_registrar_acesso(text, text) from public, anon;
grant execute on function public.auditoria_registrar_acesso(text, text) to authenticated;
create index if not exists idx_audit_logs_acesso on public.audit_logs (organization_id, actor_profile_id, occurred_at desc) where event_type = 'acesso.tela';
create index if not exists idx_audit_logs_quando on public.audit_logs (organization_id, occurred_at desc);
create index if not exists idx_audit_logs_entidade on public.audit_logs (entity_id) where entity_id is not null;
create index if not exists idx_module_events_entidade on public.module_events (entity_id) where entity_id is not null;

-- --- A trilha unificada -----------------------------------------------------------------------
create or replace function public.auditoria_pode_ver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_owner() or public.has_feature('fundacao.auditoria'); $$;
revoke all on function public.auditoria_pode_ver() from public, anon;
grant execute on function public.auditoria_pode_ver() to authenticated;

-- p_fonte: null (tudo), 'acao', 'evento', 'login', 'tela'. p_entidade: o caminho de um registro.
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
    -- Ações (audit_logs), inclusive a abertura de telas.
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
      and (p_incluir_testes or p.email is null or p.email not like '%@pecsil-teste.local')
    union all
    -- Eventos do negócio (module_events).
    select 'evento', e.occurred_at, p.id, coalesce(p.full_name, e.actor_name), p.email, e.module_code, e.event_type, e.summary,
      e.entity_type, e.entity_id, 'normal', e.payload
    from public.module_events e
    left join public.profiles p on p.id = e.actor_profile_id
    where e.organization_id = org and e.occurred_at between p_desde and p_ate
      and (p_fonte is null or p_fonte = 'evento')
      and (p_pessoa is null or p.id = p_pessoa)
      and (p_modulo is null or e.module_code = p_modulo)
      and (p_entidade is null or e.entity_id = p_entidade)
      and (p_incluir_testes or p.email is null or p.email not like '%@pecsil-teste.local')
    union all
    -- Entradas e saídas do sistema (registro do login).
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

-- Último acesso de cada pessoa: último login e última atividade (renovação da sessão), pelo
-- registro de login — vale para trás, desde 01/09.
create or replace function public.auditoria_ultimos_acessos()
returns table (profile_id uuid, ultimo_login timestamptz, ultima_atividade timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.auditoria_pode_ver() or public.has_permission('core.access', 'view')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select p.id,
    max(l.created_at) filter (where l.payload ->> 'action' = 'login'),
    max(l.created_at) filter (where l.payload ->> 'action' in ('login', 'token_refreshed'))
  from public.profiles p
  join auth.audit_log_entries l on (l.payload ->> 'actor_id')::uuid = p.user_id
  where p.organization_id = public.current_organization_id()
  group by p.id;
end;
$$;
revoke all on function public.auditoria_ultimos_acessos() from public, anon;
grant execute on function public.auditoria_ultimos_acessos() to authenticated;

-- A mesma leitura para a lista de Pessoas e Acessos (montada pelo servidor, que já conferiu que
-- é o proprietário).
create or replace function public.auditoria_ultimos_acessos_org(p_org uuid)
returns table (profile_id uuid, ultimo_login timestamptz, ultima_atividade timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
    max(l.created_at) filter (where l.payload ->> 'action' = 'login'),
    max(l.created_at) filter (where l.payload ->> 'action' in ('login', 'token_refreshed'))
  from public.profiles p
  join auth.audit_log_entries l on (l.payload ->> 'actor_id')::uuid = p.user_id
  where p.organization_id = p_org
  group by p.id;
$$;
revoke all on function public.auditoria_ultimos_acessos_org(uuid) from public, anon, authenticated;
grant execute on function public.auditoria_ultimos_acessos_org(uuid) to service_role;
