-- Tarefas e quadro (I-28, PLANO-SARA-FERRAMENTAS etapa 3, 10/11/2026): um plano falado ou escrito (uma reunião,
-- uma ata, um pedido à SARA) vira tarefas com responsável e prazo, cobradas na véspera e no vencimento.
-- Decisões do proprietário (10/11):
--   * qualquer pessoa ativa cria tarefa para qualquer pessoa ativa da empresa; o nome de quem criou aparece;
--   * quem recebe pode DEVOLVER, com o motivo (quem criou é avisado);
--   * todos veem as suas (Fundação › Tarefas e "Minhas tarefas"); a diretoria (SARA central) vê tudo.
-- Quem vê uma tarefa: o responsável, quem criou, quem responde pela área dela (sara_responsaveis), a diretoria
-- (warroom.sara), o proprietário e a Auditoria. Gravação só pelas funções tarefa_* e quadro_criar.

create table if not exists public.quadros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo text not null check (length(btrim(titulo)) between 3 and 160),
  origem text not null default 'tela' check (origem in ('tela', 'texto', 'reuniao', 'sara')),
  resumo text check (resumo is null or length(resumo) <= 4000),
  texto text check (texto is null or length(texto) <= 60000),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_quadros_org on public.quadros (organization_id, created_at desc);
comment on table public.quadros is 'Quadro de tarefas (reunião, ata, plano): agrupa as tarefas que saíram dele. Gravação por quadro_criar.';

create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quadro_id uuid references public.quadros(id) on delete set null,
  titulo text not null check (length(btrim(titulo)) between 3 and 200),
  detalhe text check (detalhe is null or length(detalhe) <= 2000),
  modulo text check (modulo is null or modulo ~ '^[a-z]{2,30}$'),
  responsavel_id uuid references public.profiles(id) on delete set null,
  responsavel_nome text,
  prazo date,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'em_andamento', 'feita', 'devolvida', 'cancelada')),
  motivo text check (motivo is null or length(motivo) <= 500),
  referencia_tipo text check (referencia_tipo is null or referencia_tipo ~ '^[a-z_]{2,40}$'),
  referencia_id text check (referencia_id is null or length(referencia_id) <= 80),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  concluida_em timestamptz,
  lembrete_em timestamptz,
  cobrancas integer not null default 0,
  cobrado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tarefas_responsavel on public.tarefas (organization_id, responsavel_id, situacao);
create index if not exists idx_tarefas_abertas on public.tarefas (organization_id, prazo) where situacao in ('aberta', 'em_andamento');
create index if not exists idx_tarefas_quadro on public.tarefas (quadro_id);
comment on table public.tarefas is 'Tarefa com responsável e prazo (I-28). Gravação pelas funções tarefa_criar e tarefa_atualizar; cobrança pelo servidor.';

create table if not exists public.tarefa_andamentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  tipo text not null check (tipo in ('criada', 'andamento', 'feita', 'devolvida', 'reaberta', 'cancelada', 'comentario', 'prazo', 'responsavel', 'cobranca')),
  texto text check (texto is null or length(texto) <= 1000),
  autor_id uuid references public.profiles(id) on delete set null,
  autor_nome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tarefa_andamentos on public.tarefa_andamentos (tarefa_id, created_at);

-- Quem vê a tarefa (usado pelas políticas e pelas funções).
create or replace function public.tarefa_pode_ver(p_org uuid, p_responsavel uuid, p_criado_por uuid, p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_org = public.current_organization_id() and (
    p_responsavel = public.current_profile_id() or p_criado_por = public.current_profile_id()
    or public.is_owner() or public.has_feature('fundacao.auditoria') or public.has_feature('warroom.sara')
    or (p_modulo is not null and exists (select 1 from public.sara_responsaveis r
          where r.organization_id = p_org and r.modulo = p_modulo and r.profile_id = public.current_profile_id())));
$$;
revoke all on function public.tarefa_pode_ver(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.tarefa_pode_ver(uuid, uuid, uuid, text) to authenticated;

alter table public.quadros enable row level security;
alter table public.tarefas enable row level security;
alter table public.tarefa_andamentos enable row level security;
drop policy if exists tarefas_read on public.tarefas;
create policy tarefas_read on public.tarefas for select to authenticated
using (public.tarefa_pode_ver(organization_id, responsavel_id, criado_por, modulo));
drop policy if exists tarefa_andamentos_read on public.tarefa_andamentos;
create policy tarefa_andamentos_read on public.tarefa_andamentos for select to authenticated
using (exists (select 1 from public.tarefas t where t.id = tarefa_id and public.tarefa_pode_ver(t.organization_id, t.responsavel_id, t.criado_por, t.modulo)));
drop policy if exists quadros_read on public.quadros;
create policy quadros_read on public.quadros for select to authenticated
using (organization_id = (select public.current_organization_id()) and (
  criado_por = (select public.current_profile_id()) or (select public.is_owner()) or (select public.has_feature('fundacao.auditoria')) or (select public.has_feature('warroom.sara'))
  or exists (select 1 from public.tarefas t where t.quadro_id = quadros.id and public.tarefa_pode_ver(t.organization_id, t.responsavel_id, t.criado_por, t.modulo))));
revoke insert, update, delete on public.quadros, public.tarefas, public.tarefa_andamentos from anon, authenticated;
grant select on public.quadros, public.tarefas, public.tarefa_andamentos to authenticated;

-- Pessoa ativa da empresa (responsável de tarefa).
create or replace function public.tarefa_pessoa_ativa(p_org uuid, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = p_id and organization_id = p_org and status = 'active'
    and (access_expires_at is null or access_expires_at > now());
$$;
revoke all on function public.tarefa_pessoa_ativa(uuid, uuid) from public, anon, authenticated;

-- Quadro novo (reunião, ata, plano): qualquer pessoa ativa.
create or replace function public.quadro_criar(p_titulo text, p_origem text default 'tela', p_resumo text default null, p_texto text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  novo uuid;
begin
  if org is null or me is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  insert into public.quadros (organization_id, titulo, origem, resumo, texto, criado_por, criado_por_nome)
  values (org, btrim(p_titulo), coalesce(p_origem, 'tela'), nullif(btrim(coalesce(p_resumo, '')), ''), nullif(btrim(coalesce(p_texto, '')), ''),
    me, (select full_name from public.profiles where id = me))
  returning id into novo;
  return novo;
end $$;

-- Tarefa nova: qualquer pessoa ativa, para qualquer pessoa ativa da empresa (ou sem responsável, para completar).
create or replace function public.tarefa_criar(
  p_titulo text, p_detalhe text default null, p_responsavel uuid default null, p_prazo date default null, p_modulo text default null,
  p_quadro uuid default null, p_referencia_tipo text default null, p_referencia_id text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = me);
  nome_resp text;
  novo uuid;
begin
  if org is null or me is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_responsavel is not null then
    nome_resp := public.tarefa_pessoa_ativa(org, p_responsavel);
    if nome_resp is null then raise exception 'O responsável não está ativo na plataforma.'; end if;
  end if;
  if p_quadro is not null and not exists (select 1 from public.quadros q where q.id = p_quadro and q.organization_id = org and q.criado_por = me) then
    raise exception 'Quadro não encontrado.';
  end if;
  insert into public.tarefas (organization_id, quadro_id, titulo, detalhe, modulo, responsavel_id, responsavel_nome, prazo, referencia_tipo, referencia_id, criado_por, criado_por_nome)
  values (org, p_quadro, btrim(p_titulo), nullif(btrim(coalesce(p_detalhe, '')), ''), p_modulo, p_responsavel, nome_resp, p_prazo,
    p_referencia_tipo, p_referencia_id, me, meu_nome)
  returning id into novo;
  insert into public.tarefa_andamentos (organization_id, tarefa_id, tipo, texto, autor_id, autor_nome)
  values (org, novo, 'criada', case when nome_resp is null then 'Sem responsável: falta definir.' else format('Para %s%s', nome_resp, coalesce(' até ' || to_char(p_prazo, 'DD/MM/YYYY'), '')) end, me, meu_nome);
  if p_responsavel is not null and p_responsavel <> me then
    perform public.notify_profile(org, p_responsavel, coalesce(p_modulo, 'fundacao'), 'attention', left(format('Tarefa para você: %s', btrim(p_titulo)), 200),
      format('%s pediu%s.', coalesce(meu_nome, 'Alguém'), coalesce(', até ' || to_char(p_prazo, 'DD/MM/YYYY'), '')), '/?tarefas=' || novo::text);
  end if;
  perform public.emit_module_event(org, 'fundacao', 'fundacao.tarefa.criada', 'tarefa', novo::text,
    format('Tarefa para %s: %s', coalesce(nome_resp, 'definir'), left(btrim(p_titulo), 120)), jsonb_build_object('prazo', p_prazo, 'modulo', p_modulo, 'quadro', p_quadro));
  return novo;
end $$;

-- Andamento da tarefa. Quem pode o quê:
--   responsável: andamento, feita, devolver (com motivo), comentar;
--   quem criou, o proprietário e quem responde pela área: feita, reabrir, cancelar (com motivo), prazo, responsavel, comentar;
--   quem só vê: comentar.
create or replace function public.tarefa_atualizar(p_id uuid, p_acao text, p_texto text default null, p_prazo date default null, p_responsavel uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = me);
  t public.tarefas%rowtype;
  texto text := nullif(left(btrim(coalesce(p_texto, '')), 1000), '');
  sou_resp boolean;
  sou_gestor boolean;
  nome_novo text;
  aberta boolean;
begin
  select * into t from public.tarefas where id = p_id and organization_id = org for update;
  if t.id is null or not public.tarefa_pode_ver(t.organization_id, t.responsavel_id, t.criado_por, t.modulo) then raise exception 'Tarefa não encontrada.'; end if;
  sou_resp := t.responsavel_id = me;
  sou_gestor := t.criado_por = me or public.is_owner() or (t.modulo is not null and exists (select 1 from public.sara_responsaveis r where r.organization_id = org and r.modulo = t.modulo and r.profile_id = me));
  aberta := t.situacao in ('aberta', 'em_andamento');

  if p_acao = 'comentar' then
    if texto is null then raise exception 'Escreva o comentário.'; end if;
  elsif p_acao = 'andamento' then
    if not sou_resp or not aberta then raise exception 'Só o responsável marca o andamento de uma tarefa aberta.' using errcode = '42501'; end if;
    update public.tarefas set situacao = 'em_andamento', updated_at = now() where id = t.id;
  elsif p_acao = 'feita' then
    if not (sou_resp or sou_gestor) or not aberta then raise exception 'Só o responsável ou quem criou conclui uma tarefa aberta.' using errcode = '42501'; end if;
    update public.tarefas set situacao = 'feita', concluida_em = now(), updated_at = now() where id = t.id;
  elsif p_acao = 'devolver' then
    if not sou_resp or not aberta then raise exception 'Só o responsável devolve a tarefa.' using errcode = '42501'; end if;
    if texto is null then raise exception 'Diga o motivo da devolução.'; end if;
    update public.tarefas set situacao = 'devolvida', motivo = texto, updated_at = now() where id = t.id;
  elsif p_acao = 'reabrir' then
    if not sou_gestor or aberta then raise exception 'Só quem criou reabre a tarefa.' using errcode = '42501'; end if;
    update public.tarefas set situacao = 'aberta', concluida_em = null, motivo = null, cobrancas = 0, cobrado_em = null, lembrete_em = null, updated_at = now() where id = t.id;
  elsif p_acao = 'cancelar' then
    if not sou_gestor or not aberta then raise exception 'Só quem criou cancela a tarefa.' using errcode = '42501'; end if;
    if texto is null then raise exception 'Diga o motivo do cancelamento.'; end if;
    update public.tarefas set situacao = 'cancelada', motivo = texto, updated_at = now() where id = t.id;
  elsif p_acao = 'prazo' then
    if not sou_gestor then raise exception 'Só quem criou muda o prazo.' using errcode = '42501'; end if;
    update public.tarefas set prazo = p_prazo, lembrete_em = null, cobrancas = 0, cobrado_em = null, updated_at = now() where id = t.id;
    texto := coalesce('Novo prazo: ' || to_char(p_prazo, 'DD/MM/YYYY'), 'Sem prazo') || coalesce('. ' || texto, '');
  elsif p_acao = 'responsavel' then
    if not sou_gestor then raise exception 'Só quem criou troca o responsável.' using errcode = '42501'; end if;
    nome_novo := public.tarefa_pessoa_ativa(org, p_responsavel);
    if nome_novo is null then raise exception 'O responsável não está ativo na plataforma.'; end if;
    update public.tarefas set responsavel_id = p_responsavel, responsavel_nome = nome_novo, situacao = case when situacao = 'devolvida' then 'aberta' else situacao end,
      lembrete_em = null, cobrancas = 0, cobrado_em = null, updated_at = now() where id = t.id;
    texto := format('Responsável: %s', nome_novo) || coalesce('. ' || texto, '');
    if p_responsavel <> me then
      perform public.notify_profile(org, p_responsavel, coalesce(t.modulo, 'fundacao'), 'attention', left(format('Tarefa para você: %s', t.titulo), 200),
        format('%s passou para você%s.', coalesce(meu_nome, 'Alguém'), coalesce(', até ' || to_char(t.prazo, 'DD/MM/YYYY'), '')), '/?tarefas=' || t.id::text);
    end if;
  else
    raise exception 'Ação desconhecida.';
  end if;

  insert into public.tarefa_andamentos (organization_id, tarefa_id, tipo, texto, autor_id, autor_nome)
  values (org, t.id, case p_acao when 'devolver' then 'devolvida' when 'reabrir' then 'reaberta' when 'cancelar' then 'cancelada' else p_acao end, texto, me, meu_nome);
  -- Quem criou fica sabendo quando o responsável conclui ou devolve.
  if p_acao in ('feita', 'devolver') and t.criado_por is not null and t.criado_por <> me then
    perform public.notify_profile(org, t.criado_por, coalesce(t.modulo, 'fundacao'), case when p_acao = 'devolver' then 'attention' else 'info' end,
      left(format('%s %s: %s', coalesce(meu_nome, 'Alguém'), case when p_acao = 'devolver' then 'devolveu a tarefa' else 'concluiu a tarefa' end, t.titulo), 200),
      coalesce(texto, ''), '/?tarefas=' || t.id::text);
  end if;
  perform public.emit_module_event(org, 'fundacao', 'fundacao.tarefa.' || p_acao, 'tarefa', t.id::text,
    format('%s · %s: %s', coalesce(meu_nome, 'Alguém'), p_acao, left(t.titulo, 120)), jsonb_build_object('texto', texto));
  return jsonb_build_object('ok', true);
end $$;

-- As minhas (como responsável): abertas primeiro, pelo prazo; as concluídas, devolvidas e canceladas dos últimos 30 dias.
create or replace function public.tarefas_minhas()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'titulo', t.titulo, 'detalhe', t.detalhe, 'modulo', t.modulo, 'prazo', t.prazo, 'situacao', t.situacao,
    'motivo', t.motivo, 'criado_por', t.criado_por_nome, 'quadro', q.titulo, 'quadro_id', t.quadro_id, 'criada_em', t.created_at, 'concluida_em', t.concluida_em)
    order by (t.situacao in ('aberta', 'em_andamento')) desc, t.prazo nulls last, t.created_at desc), '[]'::jsonb)
  from public.tarefas t left join public.quadros q on q.id = t.quadro_id
  where t.organization_id = public.current_organization_id() and t.responsavel_id = public.current_profile_id()
    and (t.situacao in ('aberta', 'em_andamento') or t.updated_at > now() - interval '30 days');
$$;

revoke all on function public.quadro_criar(text, text, text, text) from public, anon;
revoke all on function public.tarefa_criar(text, text, uuid, date, text, uuid, text, text) from public, anon;
revoke all on function public.tarefa_atualizar(uuid, text, text, date, uuid) from public, anon;
revoke all on function public.tarefas_minhas() from public, anon;
grant execute on function public.quadro_criar(text, text, text, text) to authenticated;
grant execute on function public.tarefa_criar(text, text, uuid, date, text, uuid, text, text) to authenticated;
grant execute on function public.tarefa_atualizar(uuid, text, text, date, uuid) to authenticated;
grant execute on function public.tarefas_minhas() to authenticated;
