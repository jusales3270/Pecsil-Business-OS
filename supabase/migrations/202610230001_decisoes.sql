-- Decisões para você (23/10/2026, pedido do proprietário): o canal da plataforma para a decisão que é de
-- uma pessoa ou de uma área ("quem decide o quê", ROADMAP §0). Até aqui o sino só avisava; a resposta
-- voltava por fora (conversa, WhatsApp). Agora a pergunta chega no sino e a pessoa responde no menu da
-- conta, em "Decisões para você", escolhendo uma das opções (com observação). A resposta fica gravada,
-- vai para o histórico e o proprietário é avisado, só para acompanhar: quem decide é a pessoa.
--   * Quem pergunta: o proprietário (pela tela ou pelo servidor). A pergunta nunca é para ele mesmo decidir
--     o que é da área.
--   * Quem responde: só a pessoa a quem a pergunta foi feita. Pode mudar a resposta (fica no histórico).
--   * Quem vê: a pessoa, o proprietário e a Auditoria.

create table if not exists public.decisoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null check (chave ~ '^[a-z0-9_.-]{3,120}$'),
  origem text not null default 'plataforma' check (origem ~ '^[a-z0-9_.-]{2,40}$'),
  modulo text check (modulo is null or modulo ~ '^[a-z]{2,30}$'),
  assunto text not null check (length(btrim(assunto)) between 3 and 160),
  pergunta text not null check (length(btrim(pergunta)) between 3 and 1000),
  detalhes text[] not null default '{}',
  opcoes text[] not null default '{Sim,Não}' check (cardinality(opcoes) between 2 and 5),
  para_profile_id uuid not null references public.profiles(id) on delete cascade,
  para_nome text,
  resposta text,
  nota text check (nota is null or length(nota) <= 1000),
  respondido_em timestamptz,
  criada_por_nome text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_decisoes_chave on public.decisoes (organization_id, para_profile_id, chave);
create index if not exists idx_decisoes_para on public.decisoes (para_profile_id, respondido_em nulls first, created_at desc);
comment on table public.decisoes is 'Decisões para você: pergunta a uma pessoa ou área, respondida no menu da conta. Gravação pelas funções decisao_*.';

alter table public.decisoes enable row level security;
drop policy if exists decisoes_read on public.decisoes;
create policy decisoes_read on public.decisoes for select to authenticated
using (organization_id = (select public.current_organization_id())
  and (para_profile_id = (select public.current_profile_id()) or (select public.is_owner()) or (select public.has_feature('fundacao.auditoria'))));
revoke insert, update, delete on public.decisoes from anon, authenticated;
grant select on public.decisoes to authenticated;

-- Pergunta nova (pelo servidor ou pelo proprietário): avisa a pessoa no sino e vai para o histórico.
create or replace function public.decisoes_ao_criar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_profile(new.organization_id, new.para_profile_id, coalesce(new.modulo, 'fundacao'), 'approval',
    format('Decisão para você: %s', left(new.assunto, 120)), left(new.pergunta, 400), '/?decisoes=' || new.id::text);
  perform public.emit_module_event(new.organization_id, 'fundacao', 'fundacao.decisao.pedida', 'decisao', new.id::text,
    format('Decisão pedida a %s: %s', coalesce(new.para_nome, 'alguém'), left(new.assunto, 120)), jsonb_build_object('chave', new.chave, 'origem', new.origem));
  return new;
end $$;
drop trigger if exists trg_decisoes_ao_criar on public.decisoes;
create trigger trg_decisoes_ao_criar after insert on public.decisoes for each row execute function public.decisoes_ao_criar();
revoke all on function public.decisoes_ao_criar() from public, anon, authenticated;

-- O proprietário pergunta a alguém (a mesma pergunta, para a mesma pessoa, não se repete).
create or replace function public.decisao_criar(
  p_para uuid, p_chave text, p_assunto text, p_pergunta text, p_detalhes text[] default '{}', p_opcoes text[] default '{Sim,Não}',
  p_origem text default 'plataforma', p_modulo text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  existente uuid;
  novo uuid;
begin
  if org is null or not public.is_owner() then raise exception 'Quem pergunta às áreas é o proprietário.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_para and organization_id = org and status = 'active') then raise exception 'Pessoa não encontrada.'; end if;
  select id into existente from public.decisoes where organization_id = org and para_profile_id = p_para and chave = p_chave;
  if existente is not null then return existente; end if;
  insert into public.decisoes (organization_id, chave, origem, modulo, assunto, pergunta, detalhes, opcoes, para_profile_id, para_nome, criada_por_nome)
  values (org, p_chave, coalesce(p_origem, 'plataforma'), p_modulo, btrim(p_assunto), btrim(p_pergunta), coalesce(p_detalhes, '{}'), coalesce(p_opcoes, '{Sim,Não}'),
    p_para, (select full_name from public.profiles where id = p_para), (select full_name from public.profiles where id = public.current_profile_id()))
  returning id into novo;
  return novo;
end $$;

-- As minhas: as que esperam resposta primeiro, depois as respondidas (90 dias).
create or replace function public.decisoes_minhas()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'assunto', d.assunto, 'pergunta', d.pergunta, 'detalhes', d.detalhes, 'opcoes', d.opcoes,
    'modulo', d.modulo, 'resposta', d.resposta, 'nota', d.nota, 'respondido_em', d.respondido_em, 'pedida_por', d.criada_por_nome, 'pedida_em', d.created_at)
    order by (d.resposta is null) desc, d.created_at desc), '[]'::jsonb)
  from public.decisoes d
  where d.organization_id = public.current_organization_id() and d.para_profile_id = public.current_profile_id()
    and (d.resposta is null or d.respondido_em > now() - interval '90 days');
$$;

-- A pessoa responde (ou muda a resposta). O proprietário é avisado, só para acompanhar.
create or replace function public.decisao_responder(p_id uuid, p_resposta text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  d public.decisoes%rowtype;
  dono record;
  v_nota text := nullif(left(btrim(coalesce(p_nota, '')), 1000), '');
begin
  select * into d from public.decisoes where id = p_id and organization_id = org for update;
  if d.id is null then raise exception 'Decisão não encontrada.'; end if;
  if d.para_profile_id is distinct from me then raise exception 'Só quem recebeu a pergunta responde.' using errcode = '42501'; end if;
  if p_resposta is null or not (p_resposta = any (d.opcoes)) then raise exception 'Escolha uma das opções.'; end if;
  update public.decisoes set resposta = p_resposta, nota = v_nota, respondido_em = now() where id = d.id;
  perform public.emit_module_event(org, 'fundacao', 'fundacao.decisao.respondida', 'decisao', d.id::text,
    format('%s respondeu "%s": %s', coalesce(d.para_nome, 'Alguém'), p_resposta, left(d.assunto, 120)),
    jsonb_build_object('chave', d.chave, 'resposta', p_resposta, 'nota', v_nota, 'mudou', d.resposta is not null and d.resposta <> p_resposta));
  for dono in select id from public.profiles where organization_id = org and is_owner and status = 'active' and id <> me loop
    perform public.notify_profile(org, dono.id, coalesce(d.modulo, 'fundacao'), 'info', format('%s respondeu: %s', coalesce(d.para_nome, 'Alguém'), p_resposta),
      left(d.assunto, 160) || coalesce(' · ' || left(v_nota, 200), ''), null);
  end loop;
end $$;

revoke all on function public.decisao_criar(uuid, text, text, text, text[], text[], text, text) from public, anon;
revoke all on function public.decisoes_minhas() from public, anon;
revoke all on function public.decisao_responder(uuid, text, text) from public, anon;
grant execute on function public.decisao_criar(uuid, text, text, text, text[], text[], text, text) to authenticated;
grant execute on function public.decisoes_minhas() to authenticated;
grant execute on function public.decisao_responder(uuid, text, text) to authenticated;
