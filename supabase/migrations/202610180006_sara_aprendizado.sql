-- O que a SARA aprendeu (I-12, proprietário 18/10/2026): Fundação › "O que a SARA aprendeu".
--   sara_lacunas      pedidos que a SARA não conseguiu atender (nenhuma consulta responde), com o destino
--                     que o proprietário dá: roadmap, já existe na tela, não fazer.
--   sara_habilidades  habilidades que a SARA propõe ao perceber trabalho repetitivo (uma rotina com nome que
--                     combina consultas que ela já tem). Só o proprietário ativa; ativa, vira atalho na SARA do
--                     módulo e só funciona com as permissões de quem pergunta. Nunca grava nada.
-- Leitura: o proprietário e quem tem a Auditoria. Decisões: o proprietário (é construção da plataforma).

create table if not exists public.sara_lacunas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null,
  assunto text not null check (length(assunto) between 3 and 300),
  pergunta text,
  mensagem_id uuid references public.sara_mensagens(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  profile_name text,
  destino text not null default 'pendente' check (destino in ('pendente', 'roadmap', 'ja_existe', 'nao_fazer')),
  destino_por_nome text,
  destino_em timestamptz,
  destino_nota text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sara_lacunas_org on public.sara_lacunas (organization_id, modulo, created_at desc);

create table if not exists public.sara_habilidades (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null,
  nome text not null check (length(nome) between 3 and 80),
  descricao text not null check (length(descricao) between 3 and 600),
  gatilhos text[] not null default '{}',
  passos jsonb not null default '[]'::jsonb,
  formato text,
  origem text not null check (origem in ('conversa', 'analise')),
  evidencia jsonb not null default '{}'::jsonb,
  situacao text not null default 'proposta' check (situacao in ('proposta', 'ativa', 'recusada', 'arquivada')),
  proposta_por_nome text,
  decidido_por_nome text,
  decidido_em timestamptz,
  motivo text,
  usos integer not null default 0,
  ultimo_uso timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sara_habilidades_org on public.sara_habilidades (organization_id, modulo, situacao);

alter table public.sara_lacunas enable row level security;
alter table public.sara_habilidades enable row level security;
drop policy if exists sara_lacunas_leitura on public.sara_lacunas;
create policy sara_lacunas_leitura on public.sara_lacunas for select to authenticated
  using (organization_id = (select public.current_organization_id()) and ((select public.is_owner()) or (select public.has_feature('fundacao.auditoria'))));
drop policy if exists sara_habilidades_leitura on public.sara_habilidades;
create policy sara_habilidades_leitura on public.sara_habilidades for select to authenticated
  using (organization_id = (select public.current_organization_id()) and ((select public.is_owner()) or (select public.has_feature('fundacao.auditoria'))));
grant select on public.sara_lacunas, public.sara_habilidades to authenticated;

-- A SARA anota as lacunas de uma resposta (com a sessão de quem conversou).
create or replace function public.sara_lacunas_registrar(p_modulo text, p_mensagem uuid, p_pergunta text, p_assuntos text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  n integer;
begin
  if org is null or me is null or not public.has_feature(p_modulo || '.sara') then
    raise exception 'Sem acesso à SARA deste módulo.' using errcode = '42501';
  end if;
  insert into public.sara_lacunas (organization_id, modulo, assunto, pergunta, mensagem_id, profile_id, profile_name)
  select org, p_modulo, left(btrim(a), 300), left(p_pergunta, 1000), p_mensagem, me, (select full_name from public.profiles where id = me)
  from unnest(coalesce(p_assuntos, '{}'::text[])) a
  where length(btrim(a)) >= 3
  limit 5;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Proposta de habilidade: pela SARA, numa conversa (quem conversa tem a SARA do módulo), ou pela análise
-- das conversas (o proprietário). A mesma habilidade (nome) proposta de novo só soma evidência.
create or replace function public.sara_habilidade_propor(
  p_modulo text, p_nome text, p_descricao text, p_gatilhos text[], p_passos jsonb, p_formato text, p_origem text, p_evidencia jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  existente uuid;
  novo uuid;
begin
  if org is null or me is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_origem = 'analise' and not public.is_owner() then raise exception 'A análise das conversas é do proprietário.' using errcode = '42501'; end if;
  if p_origem = 'conversa' and not public.has_feature(p_modulo || '.sara') then raise exception 'Sem acesso à SARA deste módulo.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_passos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_passos, '[]'::jsonb)) = 0 then
    raise exception 'Uma habilidade precisa de ao menos um passo.';
  end if;
  select id into existente from public.sara_habilidades
  where organization_id = org and modulo = p_modulo and lower(nome) = lower(btrim(p_nome)) and situacao in ('proposta', 'ativa');
  if existente is not null then
    update public.sara_habilidades
       set evidencia = evidencia || jsonb_build_object('vezes', coalesce((evidencia->>'vezes')::int, 1) + 1, 'ultima_proposta', now()),
           updated_at = now()
     where id = existente;
    return existente;
  end if;
  insert into public.sara_habilidades (organization_id, modulo, nome, descricao, gatilhos, passos, formato, origem, evidencia, proposta_por_nome)
  values (org, p_modulo, left(btrim(p_nome), 80), left(btrim(p_descricao), 600), coalesce(p_gatilhos[1:5], '{}'), p_passos, left(p_formato, 600), p_origem,
          coalesce(p_evidencia, '{}'::jsonb) || jsonb_build_object('vezes', coalesce((p_evidencia->>'vezes')::int, 1)),
          case when p_origem = 'conversa' then 'SARA (em conversa com ' || coalesce((select full_name from public.profiles where id = me), 'alguém') || ')' else 'SARA (análise das conversas)' end)
  returning id into novo;
  return novo;
end;
$$;

-- Habilidades ativas do módulo (para a SARA usar e mostrar como atalho).
create or replace function public.sara_habilidades_ativas(p_modulo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.has_feature(p_modulo || '.sara') then coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'nome', h.nome, 'descricao', h.descricao, 'gatilhos', h.gatilhos, 'passos', h.passos, 'formato', h.formato) order by h.usos desc, h.nome)
    from public.sara_habilidades h
    where h.organization_id = public.current_organization_id() and h.modulo = p_modulo and h.situacao = 'ativa'
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

create or replace function public.sara_habilidade_usada(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sara_habilidades h set usos = usos + 1, ultimo_uso = now()
  where h.id = p_id and h.organization_id = public.current_organization_id() and h.situacao = 'ativa' and public.has_feature(h.modulo || '.sara');
end;
$$;

-- Decisões do proprietário.
create or replace function public.sara_habilidade_decidir(p_id uuid, p_situacao text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'Ativar ou recusar habilidades da SARA é do proprietário.' using errcode = '42501'; end if;
  if p_situacao not in ('ativa', 'recusada', 'arquivada', 'proposta') then raise exception 'Situação inválida.'; end if;
  update public.sara_habilidades
     set situacao = p_situacao, motivo = left(p_motivo, 500), decidido_em = now(), updated_at = now(),
         decidido_por_nome = (select full_name from public.profiles where id = public.current_profile_id())
   where id = p_id and organization_id = public.current_organization_id();
  if not found then raise exception 'Habilidade não encontrada.'; end if;
end;
$$;

create or replace function public.sara_lacunas_destino(p_ids uuid[], p_destino text, p_nota text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.is_owner() then raise exception 'O destino das lacunas é do proprietário.' using errcode = '42501'; end if;
  if p_destino not in ('pendente', 'roadmap', 'ja_existe', 'nao_fazer') then raise exception 'Destino inválido.'; end if;
  update public.sara_lacunas
     set destino = p_destino, destino_nota = left(p_nota, 500), destino_em = now(),
         destino_por_nome = (select full_name from public.profiles where id = public.current_profile_id())
   where id = any(p_ids) and organization_id = public.current_organization_id();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Resumo para a tela: uso por módulo, lacunas, respostas ruins e habilidades (últimos p_dias).
create or replace function public.sara_aprendizado(p_dias integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 90), 1), 365));
begin
  if org is null or not (public.is_owner() or public.has_feature('fundacao.auditoria')) then
    raise exception 'O aprendizado da SARA é do proprietário e da Auditoria.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pode_decidir', public.is_owner(),
    'modulos', coalesce((
      select jsonb_agg(jsonb_build_object('modulo', x.modulo, 'conversas', x.conversas, 'pessoas', x.pessoas, 'respostas', x.respostas, 'nota_media', x.nota_media,
        'avaliadas', x.avaliadas, 'ruins', x.ruins, 'fora_do_escopo', x.fora, 'tokens', x.tokens) order by x.respostas desc)
      from (
        select c.modulo, count(distinct c.id) conversas, count(distinct c.profile_id) pessoas, count(m.id) respostas,
               round(avg(m.nota)::numeric, 1) nota_media, count(m.nota) avaliadas, count(*) filter (where m.nota <= 2) ruins,
               count(*) filter (where m.ferramentas->'escopo'->>'fora' is not null) fora, coalesce(sum(m.tokens_entrada + m.tokens_saida), 0) tokens
        from public.sara_conversas c join public.sara_mensagens m on m.conversa_id = c.id and m.papel = 'sara'
        where c.organization_id = org and m.created_at >= desde
        group by c.modulo
      ) x
    ), '[]'::jsonb),
    'lacunas', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'modulo', l.modulo, 'assunto', l.assunto, 'pergunta', l.pergunta, 'pessoa', l.profile_name, 'quando', l.created_at,
        'destino', l.destino, 'destino_por', l.destino_por_nome, 'destino_nota', l.destino_nota) order by l.created_at desc)
      from (select * from public.sara_lacunas where organization_id = org and created_at >= desde order by created_at desc limit 500) l
    ), '[]'::jsonb),
    'ruins', coalesce((
      select jsonb_agg(r order by r->>'quando' desc)
      from (
        select jsonb_build_object('modulo', c.modulo, 'nota', m.nota, 'quando', m.created_at, 'pessoa', c.profile_name, 'resposta', left(m.texto, 600),
          'pergunta', (select left(p.texto, 400) from public.sara_mensagens p where p.conversa_id = m.conversa_id and p.papel = 'pessoa' and p.created_at <= m.created_at order by p.created_at desc limit 1)) r
        from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
        where c.organization_id = org and m.papel = 'sara' and m.nota <= 2 and m.created_at >= desde
        order by m.created_at desc limit 50
      ) z
    ), '[]'::jsonb),
    'habilidades', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'modulo', h.modulo, 'nome', h.nome, 'descricao', h.descricao, 'gatilhos', h.gatilhos, 'passos', h.passos, 'formato', h.formato,
        'origem', h.origem, 'evidencia', h.evidencia, 'situacao', h.situacao, 'proposta_por', h.proposta_por_nome, 'decidido_por', h.decidido_por_nome, 'decidido_em', h.decidido_em,
        'motivo', h.motivo, 'usos', h.usos, 'ultimo_uso', h.ultimo_uso, 'criada_em', h.created_at)
        order by case h.situacao when 'proposta' then 0 when 'ativa' then 1 else 2 end, h.updated_at desc)
      from public.sara_habilidades h where h.organization_id = org
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.sara_lacunas_registrar(text, uuid, text, text[]) from public, anon;
revoke all on function public.sara_habilidade_propor(text, text, text, text[], jsonb, text, text, jsonb) from public, anon;
revoke all on function public.sara_habilidades_ativas(text) from public, anon;
revoke all on function public.sara_habilidade_usada(uuid) from public, anon;
revoke all on function public.sara_habilidade_decidir(uuid, text, text) from public, anon;
revoke all on function public.sara_lacunas_destino(uuid[], text, text) from public, anon;
revoke all on function public.sara_aprendizado(integer) from public, anon;
grant execute on function public.sara_lacunas_registrar(text, uuid, text, text[]) to authenticated;
grant execute on function public.sara_habilidade_propor(text, text, text, text[], jsonb, text, text, jsonb) to authenticated;
grant execute on function public.sara_habilidades_ativas(text) to authenticated;
grant execute on function public.sara_habilidade_usada(uuid) to authenticated;
grant execute on function public.sara_habilidade_decidir(uuid, text, text) to authenticated;
grant execute on function public.sara_lacunas_destino(uuid[], text, text) to authenticated;
grant execute on function public.sara_aprendizado(integer) to authenticated;
