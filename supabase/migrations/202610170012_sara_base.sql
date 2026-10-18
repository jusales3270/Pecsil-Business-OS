-- I-12 (roadmap) · SARA copilot por módulo, nível 1 — base comum (docs/PLANO-SARA.md, S-1).
--   * sara_modulos: a SARA de cada módulo, DESLIGADA por padrão. Ligar, o modelo (Claude Haiku ou
--     Sonnet) e o teto de uso por mês são do proprietário (uso e custo da IA).
--   * sara_conversas / sara_mensagens: o registro de cada conversa (quem, módulo, perguntas,
--     ferramentas usadas com as fontes, tokens, custo estimado e a nota da pessoa). Cada pessoa vê as
--     suas; a auditoria (proprietário ou fundacao.auditoria) vê todas.
--   * Gravação só pelas funções abaixo, com a sessão de quem conversa.

create table if not exists public.sara_modulos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null check (modulo ~ '^[a-z]{2,30}$'),
  ligada boolean not null default false,
  modelo text not null default 'claude-haiku-5-5' check (modelo in ('claude-haiku-5-5', 'claude-sonnet-5-5')),
  teto_tokens_mes int not null default 2000000 check (teto_tokens_mes between 0 and 100000000),
  atualizado_por text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, modulo)
);
alter table public.sara_modulos enable row level security;
drop policy if exists sara_modulos_read on public.sara_modulos;
create policy sara_modulos_read on public.sara_modulos for select to authenticated using (organization_id = public.current_organization_id());
revoke insert, update, delete on public.sara_modulos from anon, authenticated;

insert into public.sara_modulos (organization_id, modulo) select o.id, 'financeiro' from public.organizations o on conflict do nothing;

create table if not exists public.sara_conversas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null,
  profile_id uuid references public.profiles(id) on delete set null,
  profile_name text,
  titulo text check (titulo is null or length(titulo) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sara_conversas_pessoa on public.sara_conversas (organization_id, profile_id, updated_at desc);

create table if not exists public.sara_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversa_id uuid not null references public.sara_conversas(id) on delete cascade,
  papel text not null check (papel in ('pessoa', 'sara')),
  texto text not null check (length(texto) <= 20000),
  ferramentas jsonb not null default '[]'::jsonb,
  modelo text,
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  nota smallint check (nota is null or nota between 1 and 5),
  created_at timestamptz not null default now()
);
create index if not exists idx_sara_mensagens_conversa on public.sara_mensagens (conversa_id, created_at);
create index if not exists idx_sara_mensagens_mes on public.sara_mensagens (organization_id, created_at);

alter table public.sara_conversas enable row level security;
alter table public.sara_mensagens enable row level security;
drop policy if exists sara_conversas_read on public.sara_conversas;
create policy sara_conversas_read on public.sara_conversas for select to authenticated
using (organization_id = public.current_organization_id() and (profile_id = public.current_profile_id() or public.is_owner() or public.has_feature('fundacao.auditoria')));
drop policy if exists sara_mensagens_read on public.sara_mensagens;
create policy sara_mensagens_read on public.sara_mensagens for select to authenticated
using (organization_id = public.current_organization_id() and exists (
  select 1 from public.sara_conversas c where c.id = conversa_id and (c.profile_id = public.current_profile_id() or public.is_owner() or public.has_feature('fundacao.auditoria'))));
revoke insert, update, delete on public.sara_conversas, public.sara_mensagens from anon, authenticated;

-- Configurar a SARA de um módulo: só o proprietário (uso e custo da IA são recurso da plataforma).
create or replace function public.sara_configurar(p_modulo text, p_ligada boolean, p_modelo text, p_teto int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not public.is_owner() then raise exception 'Ligar a SARA e definir o teto de uso é do proprietário.' using errcode = '42501'; end if;
  if p_modelo not in ('claude-haiku-5-5', 'claude-sonnet-5-5') then raise exception 'Modelo inválido.'; end if;
  insert into public.sara_modulos (organization_id, modulo, ligada, modelo, teto_tokens_mes, atualizado_por, updated_at)
  values (org, p_modulo, p_ligada, p_modelo, greatest(0, coalesce(p_teto, 2000000)), (select full_name from public.profiles where id = public.current_profile_id()), now())
  on conflict (organization_id, modulo) do update set ligada = excluded.ligada, modelo = excluded.modelo, teto_tokens_mes = excluded.teto_tokens_mes,
    atualizado_por = excluded.atualizado_por, updated_at = now();
  perform public.emit_module_event(org, 'fundacao', 'fundacao.sara.configurada', 'sara', p_modulo,
    format('SARA do módulo %s %s (%s, teto %s tokens/mês)', p_modulo, case when p_ligada then 'ligada' else 'desligada' end, p_modelo, p_teto),
    jsonb_build_object('ligada', p_ligada, 'modelo', p_modelo, 'teto', p_teto));
end;
$$;
revoke all on function public.sara_configurar(text, boolean, text, int) from public, anon;
grant execute on function public.sara_configurar(text, boolean, text, int) to authenticated;

-- Uso do mês por módulo (para o teto).
create or replace function public.sara_uso_mes(p_modulo text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(m.tokens_entrada + m.tokens_saida), 0)::bigint
  from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
  where m.organization_id = public.current_organization_id() and c.modulo = p_modulo
    and m.created_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
$$;
revoke all on function public.sara_uso_mes(text) from public, anon;
grant execute on function public.sara_uso_mes(text) to authenticated;

-- Registro de uma troca (pergunta + resposta) com a sessão de quem conversa.
create or replace function public.sara_registrar(
  p_conversa uuid, p_modulo text, p_pergunta text, p_resposta text, p_ferramentas jsonb, p_modelo text, p_tokens_entrada int, p_tokens_saida int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  conv uuid := p_conversa;
  resp uuid;
begin
  if org is null or me is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if conv is null then
    insert into public.sara_conversas (organization_id, modulo, profile_id, profile_name, titulo)
    values (org, p_modulo, me, (select full_name from public.profiles where id = me), left(btrim(p_pergunta), 120))
    returning id into conv;
  elsif not exists (select 1 from public.sara_conversas where id = conv and organization_id = org and profile_id = me) then
    raise exception 'Conversa não encontrada.' using errcode = '42501';
  end if;
  insert into public.sara_mensagens (organization_id, conversa_id, papel, texto) values (org, conv, 'pessoa', left(p_pergunta, 20000));
  insert into public.sara_mensagens (organization_id, conversa_id, papel, texto, ferramentas, modelo, tokens_entrada, tokens_saida)
  values (org, conv, 'sara', left(p_resposta, 20000), coalesce(p_ferramentas, '[]'::jsonb), p_modelo, greatest(0, coalesce(p_tokens_entrada, 0)), greatest(0, coalesce(p_tokens_saida, 0)))
  returning id into resp;
  update public.sara_conversas set updated_at = now() where id = conv;
  return jsonb_build_object('conversa', conv, 'mensagem', resp);
end;
$$;
revoke all on function public.sara_registrar(uuid, text, text, text, jsonb, text, int, int) from public, anon;
grant execute on function public.sara_registrar(uuid, text, text, text, jsonb, text, int, int) to authenticated;

-- Nota da pessoa para uma resposta (mede o acerto).
create or replace function public.sara_avaliar(p_mensagem uuid, p_nota smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_nota not between 1 and 5 then raise exception 'Nota de 1 a 5.'; end if;
  update public.sara_mensagens m set nota = p_nota
  where m.id = p_mensagem and m.papel = 'sara' and m.organization_id = public.current_organization_id()
    and exists (select 1 from public.sara_conversas c where c.id = m.conversa_id and c.profile_id = public.current_profile_id());
  if not found then raise exception 'Resposta não encontrada.'; end if;
end;
$$;
revoke all on function public.sara_avaliar(uuid, smallint) from public, anon;
grant execute on function public.sara_avaliar(uuid, smallint) to authenticated;
