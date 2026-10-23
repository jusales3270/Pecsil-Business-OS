-- SARA: Guias (E3, degrau 4: piloto automático com limites da área) — 22/10/2026.
--
-- Plano aprovado pelo proprietário (o que absorver da LIA/TOTVS). Uma guia é uma rotina que a própria área
-- escreve em português na conversa ("toda segunda às 8h, me mostre…", "quando o Compras aprovar um pedido,
-- me avise…"). A SARA transforma em passos (consultas e ações) e a guia vai para aprovação de quem responde
-- pela área (o proprietário ou quem tem a SARA do módulo no nível "aprovar"; a decisão é da área, não do dono).
--   * Gatilhos: atalho (a pessoa clica), agenda (dias da semana e hora, no fuso de São Paulo) ou evento
--     (um tipo de module_events: as "reações" do Blueprint). O evento entra numa fila (sara_guia_execucoes);
--     a tarefa agendada de 10 em 10 minutos roda a fila.
--   * A guia roda COMO a pessoa que a criou (responsável): a sessão é dela, então o RLS e as permissões
--     dela valem em cada consulta e em cada ação. A SARA não ganha poder nenhum.
--   * Ação dentro de guia continua pedindo "Permitir" (o cartão fica 24 h esperando), a menos que a área
--     deixe pré-autorizada com limite (limites → ferramenta → sozinha, máximo por dia, máximo de itens,
--     horário). O padrão é nada pré-autorizado.
--   * Freio: no máximo 20 execuções por guia em 24 h; eventos da própria SARA e os que a guia provoca
--     enquanto roda não disparam guia.

-- --- 1. A SARA do módulo ganha o nível "aprovar" (aprova as guias da área e os limites) --------------
-- Ninguém recebe o nível aqui: quem libera é o proprietário, em Pessoas e Acessos.
insert into public.access_features (code, module_code, label, levels, sort) values
  ('financeiro.sara', 'financeiro', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('compras.sara', 'compras', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('almoxarifado.sara', 'almoxarifado', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('fundicao.sara', 'fundicao', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('comercial.sara', 'comercial', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('fiscal.sara', 'fiscal', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('rh.sara', 'rh', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('portaria.sara', 'portaria', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('producao.sara', 'producao', 'SARA (assistente do módulo)', '{ver,aprovar}', 95),
  ('ti.sara', 'ti', 'SARA (assistente do módulo)', '{ver,aprovar}', 95)
on conflict (code) do update set levels = excluded.levels;

-- --- 2. Guias: habilidades com gatilho, responsável e limites ----------------------------------------
alter table public.sara_habilidades
  add column if not exists tipo text not null default 'habilidade',
  add column if not exists gatilho jsonb not null default '{"tipo": "atalho"}'::jsonb,
  add column if not exists responsavel_id uuid references public.profiles(id) on delete set null,
  add column if not exists responsavel_nome text,
  add column if not exists limites jsonb not null default '{}'::jsonb,
  add column if not exists pausada boolean not null default false,
  add column if not exists proxima_em timestamptz,
  add column if not exists ultima_execucao timestamptz;
alter table public.sara_habilidades drop constraint if exists sara_habilidades_tipo_check;
alter table public.sara_habilidades add constraint sara_habilidades_tipo_check check (tipo in ('habilidade', 'guia'));
alter table public.sara_habilidades drop constraint if exists sara_habilidades_gatilho_check;
alter table public.sara_habilidades add constraint sara_habilidades_gatilho_check check (gatilho->>'tipo' in ('atalho', 'agenda', 'evento'));
create index if not exists idx_sara_guias_evento on public.sara_habilidades (organization_id, (gatilho->>'evento')) where tipo = 'guia' and situacao = 'ativa';
comment on column public.sara_habilidades.limites is 'Guia: o que a área deixou a SARA fazer sozinha. { "<ferramenta>": { "sozinha": true, "max_por_dia": 3, "max_itens": 5, "horario": { "de": "07:00", "ate": "18:00" } } }. Vazio: tudo pede Permitir.';

-- --- 3. Execuções (e fila) das guias ------------------------------------------------------------------
create table if not exists public.sara_guia_execucoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  guia_id uuid not null references public.sara_habilidades(id) on delete cascade,
  disparo text not null check (disparo in ('agenda', 'evento', 'manual')),
  evento_id bigint references public.module_events(id) on delete set null,
  evento jsonb,
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'rodando', 'feita', 'falhou', 'sem_permissao', 'cancelada')),
  conversa_id uuid references public.sara_conversas(id) on delete set null,
  mensagem_id uuid references public.sara_mensagens(id) on delete set null,
  resumo text check (resumo is null or length(resumo) <= 600),
  acoes_pendentes integer not null default 0,
  acoes_feitas integer not null default 0,
  erro text check (erro is null or length(erro) <= 500),
  created_at timestamptz not null default now(),
  iniciada_em timestamptz,
  terminada_em timestamptz
);
create index if not exists idx_sara_guia_fila on public.sara_guia_execucoes (created_at) where situacao = 'na_fila';
create index if not exists idx_sara_guia_execucoes_guia on public.sara_guia_execucoes (guia_id, created_at desc);
comment on table public.sara_guia_execucoes is 'Execuções das guias da SARA (E3). Também é a fila: na_fila → rodando → feita/falhou. Gravação pelo servidor e pelas funções sara_guia_*.';

-- Quem vê as execuções de uma guia: quem a criou e quem aprova as guias do módulo (a tabela das
-- habilidades só o proprietário lê, por isso a conferência é uma função).
create or replace function public.sara_guia_pode_ver(p_guia uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sara_habilidades h where h.id = p_guia and h.organization_id = public.current_organization_id()
                 and (h.responsavel_id = public.current_profile_id() or public.has_feature(h.modulo || '.sara', 'aprovar')));
$$;
revoke all on function public.sara_guia_pode_ver(uuid) from public, anon;
grant execute on function public.sara_guia_pode_ver(uuid) to authenticated;

alter table public.sara_guia_execucoes enable row level security;
drop policy if exists sara_guia_execucoes_read on public.sara_guia_execucoes;
create policy sara_guia_execucoes_read on public.sara_guia_execucoes for select to authenticated
using (organization_id = (select public.current_organization_id())
  and ((select public.has_feature('fundacao.auditoria')) or public.sara_guia_pode_ver(guia_id)));
revoke insert, update, delete on public.sara_guia_execucoes from anon, authenticated;
grant select on public.sara_guia_execucoes to authenticated;

-- Ação preparada por uma guia: de qual guia e execução, e se foi feita sozinha (no limite da área).
alter table public.sara_acoes
  add column if not exists guia_id uuid references public.sara_habilidades(id) on delete set null,
  add column if not exists execucao_id uuid references public.sara_guia_execucoes(id) on delete set null,
  add column if not exists automatica boolean not null default false;

-- --- 4. Evento → fila das guias que reagem a ele ------------------------------------------------------
create or replace function public.sara_guias_por_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Eventos da própria SARA não disparam guia (sem laço).
  if new.module_code = 'sara' then return new; end if;
  insert into public.sara_guia_execucoes (organization_id, guia_id, disparo, evento_id, evento)
  select new.organization_id, h.id, 'evento', new.id,
         jsonb_build_object('tipo', new.event_type, 'resumo', left(new.summary, 500), 'entidade', new.entity_type, 'id', new.entity_id,
                            'quem', new.actor_name, 'quando', new.occurred_at)
  from public.sara_habilidades h
  where h.organization_id = new.organization_id and h.tipo = 'guia' and h.situacao = 'ativa' and not h.pausada
    and h.gatilho->>'tipo' = 'evento' and h.gatilho->>'evento' = new.event_type
    -- O que a guia provoca enquanto roda (as ações dela) não a dispara de novo.
    and not (new.actor_profile_id is not distinct from h.responsavel_id
             and exists (select 1 from public.sara_guia_execucoes e where e.guia_id = h.id and e.situacao = 'rodando'))
    and (select count(*) from public.sara_guia_execucoes e where e.guia_id = h.id and e.created_at > now() - interval '24 hours') < 20;
  return new;
exception when others then
  -- A guia nunca impede o evento (o pedido, a nota, o chamado) de ser gravado.
  raise warning 'sara_guias_por_evento: %', sqlerrm;
  return new;
end $$;
drop trigger if exists trg_sara_guias_por_evento on public.module_events;
create trigger trg_sara_guias_por_evento after insert on public.module_events
  for each row execute function public.sara_guias_por_evento();

-- --- 5. Funções ---------------------------------------------------------------------------------------
-- Quem aprova as guias de um módulo: o proprietário ou quem tem a SARA do módulo no nível "aprovar".
create or replace function public.sara_guia_aprova(p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_feature(p_modulo || '.sara', 'aprovar');
$$;

-- A pessoa pediu uma guia na conversa: vai para aprovação de quem responde pela área.
create or replace function public.sara_guia_propor(
  p_modulo text, p_nome text, p_descricao text, p_gatilhos text[], p_passos jsonb, p_formato text, p_gatilho jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = me);
  tipo_g text := p_gatilho->>'tipo';
  existente uuid;
  novo uuid;
  quem record;
begin
  if org is null or me is null or not public.has_feature(p_modulo || '.sara') then
    raise exception 'Você não tem permissão para usar a SARA deste módulo.' using errcode = '42501';
  end if;
  if tipo_g is null or tipo_g not in ('atalho', 'agenda', 'evento') then raise exception 'Diga quando a guia roda (atalho, agenda ou evento).'; end if;
  if tipo_g = 'evento' and coalesce(p_gatilho->>'evento', '') !~ '^[a-z_]+(\.[a-z_]+)+$' then raise exception 'Evento inválido.'; end if;
  if tipo_g = 'agenda' and (coalesce(p_gatilho->>'hora', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or jsonb_typeof(p_gatilho->'dias') <> 'array' or jsonb_array_length(p_gatilho->'dias') = 0) then
    raise exception 'Diga os dias da semana e a hora da guia.';
  end if;
  if jsonb_typeof(coalesce(p_passos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_passos, '[]'::jsonb)) = 0 then
    raise exception 'Uma guia precisa de ao menos um passo.';
  end if;
  select id into existente from public.sara_habilidades
  where organization_id = org and modulo = p_modulo and tipo = 'guia' and responsavel_id = me
    and lower(nome) = lower(btrim(p_nome)) and situacao in ('proposta', 'ativa');
  if existente is not null then return existente; end if;
  insert into public.sara_habilidades (organization_id, modulo, tipo, nome, descricao, gatilhos, passos, formato, origem, gatilho,
    responsavel_id, responsavel_nome, proposta_por_nome)
  values (org, p_modulo, 'guia', left(btrim(p_nome), 80), left(btrim(p_descricao), 600), coalesce(p_gatilhos[1:3], '{}'), p_passos, left(p_formato, 600), 'conversa',
    p_gatilho, me, meu_nome, coalesce(meu_nome, 'alguém') || ' (pela SARA)')
  returning id into novo;
  perform public.emit_module_event(org, 'sara', 'sara.guia.proposta', 'sara_guia', novo::text,
    format('%s pediu uma guia da SARA (%s): %s', coalesce(meu_nome, 'Alguém'), p_modulo, left(btrim(p_nome), 80)), jsonb_build_object('modulo', p_modulo, 'gatilho', p_gatilho));
  -- Avisa quem aprova (o proprietário e quem tem a SARA do módulo em "aprovar"), menos quem pediu.
  for quem in
    select distinct p.id from public.profiles p
    where p.organization_id = org and p.status = 'active' and p.id <> me
      and (p.is_owner or exists (select 1 from public.user_feature_grants g where g.profile_id = p.id and g.organization_id = org
                                  and g.feature_code = p_modulo || '.sara' and g.level >= 'aprovar'))
  loop
    perform public.notify_profile(org, quem.id, p_modulo, 'attention', format('Guia da SARA para aprovar: %s', left(btrim(p_nome), 80)),
      format('%s pediu: %s Aprove ou recuse na SARA do módulo, em Guias.', coalesce(meu_nome, 'Alguém'), left(btrim(p_descricao), 300)),
      '/?module=' || p_modulo || '&sara=guias');
  end loop;
  return novo;
end $$;

-- Guias do módulo para a tela: quem aprova vê todas; os outros, só as suas.
create or replace function public.sara_guias(p_modulo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  aprova boolean := public.sara_guia_aprova(p_modulo);
begin
  if org is null or me is null or not public.has_feature(p_modulo || '.sara') then
    raise exception 'Você não tem permissão para usar a SARA deste módulo.' using errcode = '42501';
  end if;
  return jsonb_build_object('pode_aprovar', aprova, 'guias', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', h.id, 'nome', h.nome, 'descricao', h.descricao, 'gatilhos', h.gatilhos, 'passos', h.passos, 'formato', h.formato, 'gatilho', h.gatilho,
      'situacao', h.situacao, 'pausada', h.pausada, 'limites', h.limites, 'responsavel', h.responsavel_nome, 'minha', h.responsavel_id = me,
      'criada_em', h.created_at, 'decidido_por', h.decidido_por_nome, 'decidido_em', h.decidido_em, 'motivo', h.motivo,
      'proxima_em', h.proxima_em, 'ultima_execucao', h.ultima_execucao,
      'execucoes', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'disparo', e.disparo, 'situacao', e.situacao, 'resumo', e.resumo,
          'pendentes', e.acoes_pendentes, 'feitas', e.acoes_feitas, 'erro', e.erro, 'quando', coalesce(e.terminada_em, e.created_at), 'conversa', e.conversa_id,
          'evento', e.evento->>'resumo') order by e.created_at desc)
        from (select * from public.sara_guia_execucoes x where x.guia_id = h.id order by x.created_at desc limit 5) e), '[]'::jsonb))
      order by case h.situacao when 'proposta' then 0 when 'ativa' then 1 else 2 end, h.updated_at desc)
    from public.sara_habilidades h
    where h.organization_id = org and h.modulo = p_modulo and h.tipo = 'guia' and h.situacao <> 'arquivada'
      and (aprova or h.responsavel_id = me)
  ), '[]'::jsonb));
end $$;

-- Quem responde pela área aprova, recusa ou arquiva, e define o que a SARA pode fazer sozinha (limites).
create or replace function public.sara_guia_decidir(p_id uuid, p_situacao text, p_limites jsonb default null, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  g public.sara_habilidades%rowtype;
  k text;
begin
  select * into g from public.sara_habilidades where id = p_id and organization_id = org and tipo = 'guia' for update;
  if g.id is null then raise exception 'Guia não encontrada.'; end if;
  if not public.sara_guia_aprova(g.modulo) then
    raise exception 'Aprovar guias é de quem responde pela área (a SARA do módulo no nível aprovar).' using errcode = '42501';
  end if;
  if p_situacao not in ('ativa', 'recusada', 'arquivada') then raise exception 'Situação inválida.'; end if;
  if p_limites is not null then
    if jsonb_typeof(p_limites) <> 'object' then raise exception 'Limites inválidos.'; end if;
    for k in select jsonb_object_keys(p_limites) loop
      if k !~ '^[a-z_]{3,60}$' or jsonb_typeof(p_limites->k) <> 'object' then raise exception 'Limite inválido: %.', k; end if;
    end loop;
  end if;
  update public.sara_habilidades
     set situacao = p_situacao, limites = coalesce(p_limites, limites), motivo = left(p_motivo, 500), decidido_em = now(), updated_at = now(),
         decidido_por_nome = (select full_name from public.profiles where id = me), proxima_em = null
   where id = g.id;
  perform public.emit_module_event(org, 'sara', 'sara.guia.decidida', 'sara_guia', g.id::text,
    format('Guia da SARA (%s) %s: %s', g.modulo, case p_situacao when 'ativa' then 'aprovada' when 'recusada' then 'recusada' else 'arquivada' end, g.nome),
    jsonb_build_object('modulo', g.modulo, 'situacao', p_situacao, 'limites', coalesce(p_limites, g.limites)));
  if g.responsavel_id is not null and g.responsavel_id <> me and p_situacao <> g.situacao then
    perform public.notify_profile(org, g.responsavel_id, g.modulo, case when p_situacao = 'ativa' then 'info' else 'attention' end,
      format('Guia da SARA %s: %s', case p_situacao when 'ativa' then 'aprovada' when 'recusada' then 'recusada' else 'arquivada' end, g.nome),
      case when p_situacao = 'ativa' then 'A guia já está valendo. Veja na SARA do módulo, em Guias.' else coalesce('Motivo: ' || left(p_motivo, 300), 'Veja na SARA do módulo, em Guias.') end,
      '/?module=' || g.modulo || '&sara=guias');
  end if;
end $$;

-- Pausar ou retomar: quem criou a guia ou quem aprova.
create or replace function public.sara_guia_pausar(p_id uuid, p_pausada boolean)
returns void language plpgsql security definer set search_path = public as $$
declare g public.sara_habilidades%rowtype;
begin
  select * into g from public.sara_habilidades where id = p_id and organization_id = public.current_organization_id() and tipo = 'guia' for update;
  if g.id is null then raise exception 'Guia não encontrada.'; end if;
  if g.responsavel_id is distinct from public.current_profile_id() and not public.sara_guia_aprova(g.modulo) then
    raise exception 'Só quem criou a guia ou quem aprova pode pausar.' using errcode = '42501';
  end if;
  update public.sara_habilidades set pausada = p_pausada, proxima_em = null, updated_at = now() where id = g.id;
end $$;

-- "Rodar agora": só quem criou (a guia roda com a sessão dela). Entra na fila da próxima volta.
create or replace function public.sara_guia_rodar(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g public.sara_habilidades%rowtype;
  novo uuid;
begin
  select * into g from public.sara_habilidades where id = p_id and organization_id = public.current_organization_id() and tipo = 'guia';
  if g.id is null then raise exception 'Guia não encontrada.'; end if;
  if g.responsavel_id is distinct from public.current_profile_id() then raise exception 'Só quem criou a guia pode rodá-la.' using errcode = '42501'; end if;
  if g.situacao <> 'ativa' or g.pausada then raise exception 'A guia precisa estar aprovada e não pausada.'; end if;
  if (select count(*) from public.sara_guia_execucoes e where e.guia_id = g.id and e.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Esta guia já rodou 20 vezes nas últimas 24 horas.';
  end if;
  if exists (select 1 from public.sara_guia_execucoes e where e.guia_id = g.id and e.situacao in ('na_fila', 'rodando')) then
    raise exception 'A guia já está na fila.';
  end if;
  insert into public.sara_guia_execucoes (organization_id, guia_id, disparo) values (g.organization_id, g.id, 'manual') returning id into novo;
  return novo;
end $$;

-- Fim de uma execução, gravado com a sessão de quem criou a guia: avisa a pessoa com o resultado.
create or replace function public.sara_guia_concluir(
  p_execucao uuid, p_situacao text, p_conversa uuid, p_mensagem uuid, p_resumo text, p_pendentes int, p_feitas int, p_erro text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  e public.sara_guia_execucoes%rowtype;
  g public.sara_habilidades%rowtype;
  corpo text;
begin
  select * into e from public.sara_guia_execucoes where id = p_execucao and organization_id = org for update;
  if e.id is null then raise exception 'Execução não encontrada.'; end if;
  select * into g from public.sara_habilidades where id = e.guia_id;
  if g.responsavel_id is distinct from me then raise exception 'Execução não encontrada.' using errcode = '42501'; end if;
  if e.situacao <> 'rodando' then raise exception 'Esta execução não está rodando.'; end if;
  if p_situacao not in ('feita', 'falhou') then raise exception 'Situação inválida.'; end if;
  update public.sara_guia_execucoes
     set situacao = p_situacao, conversa_id = p_conversa, mensagem_id = p_mensagem, resumo = left(p_resumo, 600),
         acoes_pendentes = greatest(0, coalesce(p_pendentes, 0)), acoes_feitas = greatest(0, coalesce(p_feitas, 0)),
         erro = case when p_situacao = 'falhou' then left(coalesce(p_erro, 'Falhou.'), 500) end, terminada_em = now()
   where id = e.id;
  update public.sara_habilidades set ultima_execucao = now(), usos = usos + 1, ultimo_uso = now() where id = g.id;
  perform public.emit_module_event(org, 'sara', 'sara.guia.rodou', 'sara_guia', g.id::text,
    format('A guia «%s» (%s) rodou: %s', g.nome, g.modulo, case when p_situacao = 'feita' then 'feita' else 'falhou' end),
    jsonb_build_object('modulo', g.modulo, 'execucao', e.id, 'disparo', e.disparo, 'pendentes', p_pendentes, 'feitas', p_feitas));
  corpo := case when p_situacao = 'falhou' then 'Não rodou: ' || left(coalesce(p_erro, 'falhou'), 300)
    else left(coalesce(p_resumo, ''), 300)
      || case when coalesce(p_pendentes, 0) > 0 then format(' · %s %s esperando o seu Permitir.', p_pendentes, case when p_pendentes = 1 then 'ação' else 'ações' end) else '' end
      || case when coalesce(p_feitas, 0) > 0 then format(' · %s feita(s) sozinha(s), no limite da área.', p_feitas) else '' end end;
  perform public.notify_profile(org, me, g.modulo, case when p_situacao = 'falhou' or coalesce(p_pendentes, 0) > 0 then 'attention' else 'info' end,
    format('⚡ Guia «%s»', g.nome), corpo, '/?module=' || g.modulo || '&sara=1');
end $$;

-- Ação preparada (E1), agora com validade e origem: uma guia deixa o cartão 24 h esperando; ação
-- "sozinha" só dentro do limite que a área aprovou (conferido aqui também, além da plataforma).
drop function if exists public.sara_acao_propor(uuid, uuid, text, text, jsonb, text, jsonb, text);
create or replace function public.sara_acao_propor(
  p_conversa uuid, p_mensagem uuid, p_modulo text, p_ferramenta text, p_entrada jsonb, p_resumo text, p_detalhes jsonb, p_risco text,
  p_validade_min integer default 15, p_execucao uuid default null, p_automatica boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  guia uuid;
  lim jsonb;
  v_id uuid;
begin
  if org is null or me is null or not public.has_feature(p_modulo || '.sara') then
    raise exception 'Você não tem permissão para usar a SARA deste módulo.' using errcode = '42501';
  end if;
  if p_conversa is not null and not exists (select 1 from public.sara_conversas where id = p_conversa and organization_id = org and profile_id = me) then
    raise exception 'Conversa não encontrada.';
  end if;
  if p_execucao is not null then
    select h.id, h.limites -> p_ferramenta into guia, lim
    from public.sara_guia_execucoes e join public.sara_habilidades h on h.id = e.guia_id
    where e.id = p_execucao and e.organization_id = org and e.situacao = 'rodando' and h.responsavel_id = me;
    if guia is null then raise exception 'Execução da guia não encontrada.'; end if;
  end if;
  if p_automatica then
    if guia is null or coalesce((lim->>'sozinha')::boolean, false) is not true then
      raise exception 'Esta ação não está pré-autorizada para a guia.' using errcode = '42501';
    end if;
    if (lim->>'max_por_dia') is not null and (select count(*) from public.sara_acoes a where a.guia_id = guia and a.ferramenta = p_ferramenta and a.automatica
          and a.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') >= (lim->>'max_por_dia')::int then
      raise exception 'Limite do dia atingido para esta ação.' using errcode = '42501';
    end if;
    if (lim->>'max_itens') is not null and jsonb_typeof(p_entrada->'itens') = 'array' and jsonb_array_length(p_entrada->'itens') > (lim->>'max_itens')::int then
      raise exception 'Mais itens do que o limite da guia.' using errcode = '42501';
    end if;
  end if;
  insert into public.sara_acoes (organization_id, conversa_id, mensagem_id, modulo, profile_id, profile_name, ferramenta, entrada, resumo, detalhes, risco,
    expira_em, guia_id, execucao_id, automatica)
  values (org, p_conversa, p_mensagem, p_modulo, me, (select full_name from public.profiles where id = me), p_ferramenta, coalesce(p_entrada, '{}'::jsonb),
    left(btrim(p_resumo), 600), coalesce(p_detalhes, '[]'::jsonb), case when p_risco = 'alto' then 'alto' else 'normal' end,
    now() + make_interval(mins => least(greatest(coalesce(p_validade_min, 15), 5), 1440)), guia, p_execucao, coalesce(p_automatica, false))
  returning id into v_id;
  return v_id;
end $$;

-- Resultado da execução: a feita sozinha pela guia fica assim no histórico.
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
      case when a.automatica
        then format('A guia «%s» (%s) fez sozinha, no limite aprovado pela área: %s', (select nome from public.sara_habilidades where id = a.guia_id), a.modulo, a.resumo)
        else format('A SARA (%s) fez, com a permissão de quem pediu: %s', a.modulo, a.resumo) end,
      jsonb_build_object('modulo', a.modulo, 'ferramenta', a.ferramenta, 'resultado', p_resultado, 'guia', a.guia_id, 'automatica', a.automatica));
  end if;
end $$;

-- Habilidades ativas para a SARA do módulo: as guias aparecem só para quem as criou (rodam com a sessão dela).
create or replace function public.sara_habilidades_ativas(p_modulo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.has_feature(p_modulo || '.sara') then coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'nome', h.nome, 'descricao', h.descricao, 'gatilhos', h.gatilhos, 'passos', h.passos, 'formato', h.formato, 'tipo', h.tipo) order by h.usos desc, h.nome)
    from public.sara_habilidades h
    where h.organization_id = public.current_organization_id() and h.modulo = p_modulo and h.situacao = 'ativa'
      and (h.tipo = 'habilidade' or (h.responsavel_id = public.current_profile_id() and not h.pausada))
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

revoke all on function public.sara_guias_por_evento() from public, anon, authenticated;
revoke all on function public.sara_guia_aprova(text) from public, anon;
revoke all on function public.sara_guia_propor(text, text, text, text[], jsonb, text, jsonb) from public, anon;
revoke all on function public.sara_guias(text) from public, anon;
revoke all on function public.sara_guia_decidir(uuid, text, jsonb, text) from public, anon;
revoke all on function public.sara_guia_pausar(uuid, boolean) from public, anon;
revoke all on function public.sara_guia_rodar(uuid) from public, anon;
revoke all on function public.sara_guia_concluir(uuid, text, uuid, uuid, text, int, int, text) from public, anon;
revoke all on function public.sara_acao_propor(uuid, uuid, text, text, jsonb, text, jsonb, text, integer, uuid, boolean) from public, anon;
grant execute on function public.sara_guia_aprova(text) to authenticated;
grant execute on function public.sara_guia_propor(text, text, text, text[], jsonb, text, jsonb) to authenticated;
grant execute on function public.sara_guias(text) to authenticated;
grant execute on function public.sara_guia_decidir(uuid, text, jsonb, text) to authenticated;
grant execute on function public.sara_guia_pausar(uuid, boolean) to authenticated;
grant execute on function public.sara_guia_rodar(uuid) to authenticated;
grant execute on function public.sara_guia_concluir(uuid, text, uuid, uuid, text, int, int, text) to authenticated;
grant execute on function public.sara_acao_propor(uuid, uuid, text, text, jsonb, text, jsonb, text, integer, uuid, boolean) to authenticated;
