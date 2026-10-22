-- SARA: ações com "Permitir / Não permitir" (E1) e aviso de custo ao proprietário (E4) — 22/10/2026.
--
-- Plano aprovado pelo proprietário (o que absorver da LIA/TOTVS). A SARA deixa de só consultar: ela
-- PREPARA uma ação (pedir material, abrir chamado de TI, anotar na Biblioteca…) e a pessoa decide no
-- cartão "Permitir / Não permitir". Nada grava sem o toque da pessoa (PLANO-SARA §2, Blueprint nível 4).
--   * A proposta fica em sara_acoes por 15 minutos; só quem pediu decide (a ação roda com a credencial dela).
--   * A execução é a MESMA função do banco que a tela usa (ela confere a permissão de novo): a SARA não
--     ganha poder nenhum além do que a pessoa já tem.
--   * Cada ação feita ou recusada fica no histórico (module_events, módulo "sara"), com quem pediu e o quê.
--   * Custo: quando o uso do mês de um módulo passa de 80% do teto, o proprietário é avisado (uma vez no mês).

create table if not exists public.sara_acoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversa_id uuid references public.sara_conversas(id) on delete cascade,
  mensagem_id uuid references public.sara_mensagens(id) on delete set null,
  modulo text not null check (modulo ~ '^[a-z]{2,30}$'),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  profile_name text,
  ferramenta text not null check (ferramenta ~ '^[a-z_]{3,60}$'),
  entrada jsonb not null default '{}'::jsonb,
  resumo text not null check (length(btrim(resumo)) between 1 and 600),
  detalhes jsonb not null default '[]'::jsonb,
  risco text not null default 'normal' check (risco in ('normal', 'alto')),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'permitida', 'recusada', 'expirada', 'executada', 'falhou')),
  resultado jsonb,
  erro text check (erro is null or length(erro) <= 500),
  expira_em timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now(),
  decidido_em timestamptz,
  concluido_em timestamptz
);
create index if not exists idx_sara_acoes_conversa on public.sara_acoes (conversa_id, created_at);
create index if not exists idx_sara_acoes_pessoa on public.sara_acoes (organization_id, profile_id, created_at desc);
comment on table public.sara_acoes is 'Ações que a SARA preparou e a pessoa permitiu ou não (E1, 22/10/2026). Gravação só pelas funções sara_acao_*.';

alter table public.sara_acoes enable row level security;
drop policy if exists sara_acoes_read on public.sara_acoes;
create policy sara_acoes_read on public.sara_acoes for select to authenticated
using (organization_id = (select public.current_organization_id())
  and (profile_id = (select public.current_profile_id()) or (select public.is_owner()) or (select public.has_feature('fundacao.auditoria'))));
revoke insert, update, delete on public.sara_acoes from anon, authenticated;
grant select on public.sara_acoes to authenticated;

-- A SARA preparou uma ação: fica pendente até a pessoa decidir (só a própria pessoa, com a SARA do módulo).
create or replace function public.sara_acao_propor(p_conversa uuid, p_mensagem uuid, p_modulo text, p_ferramenta text, p_entrada jsonb, p_resumo text, p_detalhes jsonb, p_risco text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  v_id uuid;
begin
  if org is null or me is null or not public.has_feature(p_modulo || '.sara') then
    raise exception 'Você não tem permissão para usar a SARA deste módulo.' using errcode = '42501';
  end if;
  if p_conversa is not null and not exists (select 1 from public.sara_conversas where id = p_conversa and organization_id = org and profile_id = me) then
    raise exception 'Conversa não encontrada.';
  end if;
  insert into public.sara_acoes (organization_id, conversa_id, mensagem_id, modulo, profile_id, profile_name, ferramenta, entrada, resumo, detalhes, risco)
  values (org, p_conversa, p_mensagem, p_modulo, me, (select full_name from public.profiles where id = me), p_ferramenta, coalesce(p_entrada, '{}'::jsonb),
    left(btrim(p_resumo), 600), coalesce(p_detalhes, '[]'::jsonb), case when p_risco = 'alto' then 'alto' else 'normal' end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.sara_acao_propor(uuid, uuid, text, text, jsonb, text, jsonb, text) from public, anon;
grant execute on function public.sara_acao_propor(uuid, uuid, text, text, jsonb, text, jsonb, text) to authenticated;

-- A pessoa decidiu. Permitir devolve a ferramenta e a entrada para o servidor executar com a sessão dela.
-- Só uma decisão por proposta (a linha fica travada); vencida não executa.
create or replace function public.sara_acao_decidir(p_id uuid, p_permitir boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  a public.sara_acoes%rowtype;
begin
  select * into a from public.sara_acoes where id = p_id and organization_id = org for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if a.profile_id is distinct from me then raise exception 'Só quem pediu à SARA pode permitir esta ação.' using errcode = '42501'; end if;
  if a.situacao <> 'pendente' then raise exception 'Esta ação já foi decidida (%).', a.situacao; end if;
  if a.expira_em < now() then
    update public.sara_acoes set situacao = 'expirada', decidido_em = now() where id = a.id;
    return jsonb_build_object('situacao', 'expirada');
  end if;
  if not p_permitir then
    update public.sara_acoes set situacao = 'recusada', decidido_em = now() where id = a.id;
    perform public.emit_module_event(org, 'sara', 'sara.acao.recusada', 'sara_acao', a.id::text,
      format('A SARA (%s) propôs e a pessoa não permitiu: %s', a.modulo, a.resumo), jsonb_build_object('modulo', a.modulo, 'ferramenta', a.ferramenta));
    return jsonb_build_object('situacao', 'recusada');
  end if;
  update public.sara_acoes set situacao = 'permitida', decidido_em = now() where id = a.id;
  return jsonb_build_object('situacao', 'permitida', 'ferramenta', a.ferramenta, 'entrada', a.entrada, 'modulo', a.modulo, 'resumo', a.resumo);
end $$;
revoke all on function public.sara_acao_decidir(uuid, boolean) from public, anon;
grant execute on function public.sara_acao_decidir(uuid, boolean) to authenticated;

-- Resultado da execução (feita pelo servidor com a sessão de quem permitiu).
create or replace function public.sara_acao_concluir(p_id uuid, p_ok boolean, p_resultado jsonb, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  a public.sara_acoes%rowtype;
begin
  select * into a from public.sara_acoes where id = p_id and organization_id = org for update;
  if a.id is null or a.profile_id is distinct from public.current_profile_id() then raise exception 'Ação não encontrada.'; end if;
  if a.situacao <> 'permitida' then raise exception 'Esta ação não está esperando execução.'; end if;
  update public.sara_acoes set situacao = case when p_ok then 'executada' else 'falhou' end, resultado = p_resultado,
    erro = case when p_ok then null else left(coalesce(p_erro, 'Falhou.'), 500) end, concluido_em = now()
  where id = a.id;
  if p_ok then
    perform public.emit_module_event(org, 'sara', 'sara.acao.executada', 'sara_acao', a.id::text,
      format('A SARA (%s) fez, com a permissão de quem pediu: %s', a.modulo, a.resumo),
      jsonb_build_object('modulo', a.modulo, 'ferramenta', a.ferramenta, 'resultado', p_resultado));
  end if;
end $$;
revoke all on function public.sara_acao_concluir(uuid, boolean, jsonb, text) from public, anon;
grant execute on function public.sara_acao_concluir(uuid, boolean, jsonb, text) to authenticated;

-- --- E4: custo ---------------------------------------------------------------------------------
-- Uso detalhado para o painel do proprietário (custo em R$ é calculado na plataforma pelo modelo e
-- pelos tokens, inclusive o cache). Só o proprietário ou a auditoria.
create or replace function public.sara_uso_detalhado(p_meses int default 6)
returns table (mes date, modulo text, pessoa text, modelo text, mensagens bigint, tokens_entrada bigint, tokens_saida bigint, cache_lido bigint, cache_gravado bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.has_feature('fundacao.auditoria')) then
    raise exception 'O uso da SARA é visto só pelo proprietário.' using errcode = '42501';
  end if;
  return query
  select date_trunc('month', m.created_at at time zone 'America/Sao_Paulo')::date, c.modulo, coalesce(c.profile_name, '—'), coalesce(m.modelo, '—'),
    count(*), sum(m.tokens_entrada)::bigint, sum(m.tokens_saida)::bigint,
    sum(coalesce((m.ferramentas -> 'cache' ->> 'lido')::bigint, 0))::bigint, sum(coalesce((m.ferramentas -> 'cache' ->> 'gravado')::bigint, 0))::bigint
  from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
  where m.organization_id = public.current_organization_id() and m.papel = 'sara'
    and m.created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' - make_interval(months => greatest(0, least(p_meses, 24) - 1))
  group by 1, 2, 3, 4;
end $$;
revoke all on function public.sara_uso_detalhado(int) from public, anon;
grant execute on function public.sara_uso_detalhado(int) to authenticated;

-- Passou de 80% do teto do mês: avisa o(s) proprietário(s) uma vez por mês e módulo.
create or replace function public.sara_aviso_teto(p_modulo text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  teto bigint;
  uso bigint := public.sara_uso_mes(p_modulo);
  chave text := p_modulo || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  dono record;
begin
  if org is null or not public.has_feature(p_modulo || '.sara') then return false; end if;
  select teto_tokens_mes into teto from public.sara_modulos where organization_id = org and modulo = p_modulo;
  teto := coalesce(teto, 2000000);
  if teto <= 0 or uso < teto * 0.8 then return false; end if;
  if exists (select 1 from public.module_events where organization_id = org and event_type = 'sara.teto.alerta' and entity_id = chave) then return false; end if;
  perform public.emit_module_event(org, 'sara', 'sara.teto.alerta', 'sara_modulo', chave,
    format('A SARA (%s) passou de 80%% do teto de uso do mês', p_modulo), jsonb_build_object('modulo', p_modulo, 'uso', uso, 'teto', teto));
  for dono in select id from public.profiles where organization_id = org and is_owner and status = 'active' loop
    perform public.notify_profile(org, dono.id, 'sara', 'attention', format('SARA (%s): 80%% do teto do mês', p_modulo),
      format('O uso deste mês chegou a %s%% do teto. Ao chegar a 100%%, a SARA deste módulo para até o mês que vem (ou até o teto subir).', round(uso * 100.0 / teto)),
      '/?view=O%20que%20a%20SARA%20aprendeu');
  end loop;
  return true;
end $$;
revoke all on function public.sara_aviso_teto(text) from public, anon;
grant execute on function public.sara_aviso_teto(text) to authenticated;
