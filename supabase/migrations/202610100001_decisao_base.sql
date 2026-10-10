-- Base comum do modelo de decisão (PLANO-JEV, Etapa 0), já com o Clef (10/10/2026).
--
--   ai_uses       um registro por uso (ligado/desligado, modelo, limites). Só o proprietário.
--   ai_judgments  auditoria de cada consulta: o que foi perguntado (já filtrado), a resposta,
--                 a confiança, a faixa e o que a pessoa decidiu depois. Mede a taxa de acerto.
--
-- Ninguém grava direto nas tabelas: só pelas funções abaixo, que conferem a permissão.
-- O modelo só sugere; a decisão é sempre de uma pessoa (PLANO-JEV, seção 2).

-- --- Permissão ------------------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('fundacao.sugestoes', 'fundacao', 'Sugestões da IA', '{ver,operar}', 50)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- Usos -------------------------------------------------------------------------------
create table if not exists public.ai_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z]+\.[a-z_]+$'),
  label text not null,
  module_code text not null,
  -- Funcionalidade exigida para ver e decidir as sugestões deste uso.
  feature_code text not null,
  enabled boolean not null default false,
  model text not null default 'clef-flash' check (model in ('clef-flash', 'clef')),
  limit_high numeric(4,3) not null default 0.80 check (limit_high > 0 and limit_high <= 1),
  limit_low numeric(4,3) not null default 0.40 check (limit_low >= 0 and limit_low < 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  check (limit_low < limit_high)
);

alter table public.ai_uses enable row level security;
drop policy if exists ai_uses_owner on public.ai_uses;
create policy ai_uses_owner on public.ai_uses for all to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()))
  with check (organization_id = (select public.current_organization_id()) and (select public.is_owner()));
grant select, update on public.ai_uses to authenticated;

-- Uso de teste do proprietário (tela "Testar o modelo"). Nasce desligado, como todo uso.
insert into public.ai_uses (organization_id, code, label, module_code, feature_code)
select o.id, 'fundacao.teste', 'Teste do modelo', 'fundacao', 'fundacao.sugestoes' from public.organizations o
on conflict (organization_id, code) do nothing;

-- Configuração de um uso para quem consulta (sem abrir a tabela inteira).
create or replace function public.ai_use_config(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('code', u.code, 'label', u.label, 'enabled', u.enabled, 'model', u.model,
    'limitHigh', u.limit_high, 'limitLow', u.limit_low, 'featureCode', u.feature_code, 'moduleCode', u.module_code)
  from public.ai_uses u
  where u.organization_id = public.current_organization_id() and u.code = p_code
    and (public.is_owner() or public.has_feature(u.feature_code, 'ver'));
$$;
revoke all on function public.ai_use_config(text) from public, anon;
grant execute on function public.ai_use_config(text) to authenticated;

-- --- Auditoria das consultas --------------------------------------------------------------
create table if not exists public.ai_judgments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  use_code text not null,
  feature_code text not null,
  entity_type text,
  entity_id text,
  -- Resumo do que foi enviado, já passado pelo filtro. Bloqueado pelo filtro: só o motivo.
  state_summary text not null default '',
  questions jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  band text check (band in ('alta', 'media', 'baixa')),
  model text,
  latency_ms integer,
  input_tokens integer,
  outcome text not null default 'pendente'
    check (outcome in ('pendente', 'aceita', 'recusada', 'corrigida', 'ignorada', 'bloqueada', 'erro')),
  error_detail text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_judgments_fila on public.ai_judgments (organization_id, outcome, created_at desc);
create index if not exists idx_ai_judgments_uso on public.ai_judgments (organization_id, use_code, created_at desc);

alter table public.ai_judgments enable row level security;
drop policy if exists ai_judgments_read on public.ai_judgments;
create policy ai_judgments_read on public.ai_judgments for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and ((select public.is_owner())
       or ((select public.has_feature('fundacao.sugestoes')) and public.has_feature(feature_code)))
);
grant select on public.ai_judgments to authenticated;

-- Grava uma consulta (chamada pelo servidor com a sessão de quem consultou).
create or replace function public.ai_judgment_record(
  p_use text, p_entity_type text, p_entity_id text, p_state_summary text, p_questions jsonb, p_answers jsonb,
  p_confidence numeric, p_band text, p_model text, p_latency_ms integer, p_input_tokens integer,
  p_outcome text, p_error_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  uso public.ai_uses%rowtype;
  novo uuid;
begin
  select * into uso from public.ai_uses where organization_id = org and code = p_use;
  if uso.id is null then raise exception 'Uso de IA desconhecido: %', p_use; end if;
  if not (public.is_owner() or public.has_feature(uso.feature_code, 'ver')) then
    raise exception 'Sem permissão para consultar a IA neste uso.' using errcode = '42501';
  end if;
  if p_outcome not in ('pendente', 'bloqueada', 'erro') then raise exception 'Situação inicial inválida.'; end if;
  insert into public.ai_judgments (organization_id, use_code, feature_code, entity_type, entity_id, state_summary, questions, answers,
    confidence, band, model, latency_ms, input_tokens, outcome, error_detail, created_by)
  values (org, uso.code, uso.feature_code, p_entity_type, p_entity_id, left(coalesce(p_state_summary, ''), 2000),
    coalesce(p_questions, '{}'::jsonb), coalesce(p_answers, '{}'::jsonb), p_confidence, p_band, p_model, p_latency_ms, p_input_tokens,
    p_outcome, left(p_error_detail, 500), public.current_profile_id())
  returning id into novo;
  return novo;
end;
$$;
revoke all on function public.ai_judgment_record(text, text, text, text, jsonb, jsonb, numeric, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.ai_judgment_record(text, text, text, text, jsonb, jsonb, numeric, text, text, integer, integer, text, text) to authenticated;

-- A pessoa decide a sugestão: aceita, recusa, corrige ou ignora.
create or replace function public.ai_judgment_decide(p_id uuid, p_outcome text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  j public.ai_judgments%rowtype;
begin
  if p_outcome not in ('aceita', 'recusada', 'corrigida', 'ignorada') then raise exception 'Decisão inválida.'; end if;
  select * into j from public.ai_judgments where id = p_id and organization_id = org for update;
  if j.id is null then raise exception 'Sugestão não encontrada.'; end if;
  if not (public.is_owner() or (public.has_feature('fundacao.sugestoes', 'operar') and public.has_feature(j.feature_code, 'operar'))) then
    raise exception 'Sem permissão para decidir esta sugestão.' using errcode = '42501';
  end if;
  if j.outcome <> 'pendente' then raise exception 'Esta sugestão já foi decidida.'; end if;
  if p_outcome = 'corrigida' and length(trim(coalesce(p_note, ''))) < 3 then raise exception 'Diga qual é a resposta certa.'; end if;

  update public.ai_judgments
     set outcome = p_outcome, decided_by = public.current_profile_id(),
         decided_by_name = (select full_name from public.profiles where id = public.current_profile_id()),
         decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = j.id;

  perform public.emit_module_event(org, 'fundacao', 'fundacao.sugestao.decidida', 'sugestao', j.id::text,
    format('Sugestão da IA %s (%s)', p_outcome, j.use_code),
    jsonb_build_object('uso', j.use_code, 'decisao', p_outcome, 'confianca', j.confidence, 'faixa', j.band));
end;
$$;
revoke all on function public.ai_judgment_decide(uuid, text, text) from public, anon;
grant execute on function public.ai_judgment_decide(uuid, text, text) to authenticated;

-- Números por uso para o painel do proprietário (últimos N dias).
create or replace function public.ai_use_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if not public.is_owner() then raise exception 'Só o proprietário vê o painel de uso.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'code')
    from (
      select jsonb_build_object(
        'code', u.code, 'label', u.label, 'moduleCode', u.module_code, 'featureCode', u.feature_code,
        'enabled', u.enabled, 'model', u.model, 'limitHigh', u.limit_high, 'limitLow', u.limit_low,
        'consultas', count(j.id) filter (where j.outcome not in ('bloqueada', 'erro')),
        'bloqueadas', count(j.id) filter (where j.outcome = 'bloqueada'),
        'erros', count(j.id) filter (where j.outcome = 'erro'),
        'pendentes', count(j.id) filter (where j.outcome = 'pendente'),
        'aceitas', count(j.id) filter (where j.outcome = 'aceita'),
        'recusadas', count(j.id) filter (where j.outcome = 'recusada'),
        'corrigidas', count(j.id) filter (where j.outcome = 'corrigida'),
        'latenciaMedia', round(avg(j.latency_ms) filter (where j.latency_ms is not null)),
        'tokens', coalesce(sum(j.input_tokens), 0),
        'porDia', (select coalesce(jsonb_object_agg(d.dia, d.n), '{}'::jsonb) from (
            select to_char(j2.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia, count(*) as n
            from public.ai_judgments j2
            where j2.organization_id = org and j2.use_code = u.code and j2.created_at >= now() - make_interval(days => p_days)
            group by 1) d)
      ) as x
      from public.ai_uses u
      left join public.ai_judgments j on j.organization_id = org and j.use_code = u.code and j.created_at >= now() - make_interval(days => p_days)
      where u.organization_id = org
      group by u.id
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.ai_use_stats(integer) from public, anon;
grant execute on function public.ai_use_stats(integer) to authenticated;
