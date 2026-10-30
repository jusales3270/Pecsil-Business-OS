-- Módulo Qualidade, primeira seção: Não conformidades (Q-01, docs/PLANO-QUALIDADE.md), 30/10/2026.
--
-- O registro nasce na conversa com a SARA da Qualidade: a pessoa manda foto e voz ou texto, a SARA
-- pergunta o que falta e prepara o cartão; só o "Permitir" grava. Corrigir, encerrar e cancelar ficam
-- na tela, com histórico. Nada se apaga.
--
-- Foto: fica guardada desde a mensagem (nc_id vazio = pendente da conversa) e entra na NC ao gravar.
-- Quem liga as fotos à NC é o servidor, pelas fotos pendentes daquela conversa: o modelo não escolhe,
-- então a foto de uma tentativa abandonada não cai na NC errada. Pendente com mais de 7 dias é apagada.
--
-- Quem decide (quadro do ROADMAP): a área de Qualidade. Os tipos semeados aqui são PROVISÓRIOS até o
-- Ricardo revisar (qualidade_regras.revisado_em vazio, e a tela mostra isso). Gravidade existe, mas
-- nasce desligada. Ninguém recebe permissão aqui: quem libera é o proprietário.

-- --- Permissões e registro do módulo ----------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('qualidade.nao_conformidades', 'qualidade', 'Não conformidades', '{ver,operar,aprovar}', 10),
  ('qualidade.coleta', 'qualidade', 'Coletar arquivos', '{operar}', 90),
  ('qualidade.sara', 'qualidade', 'SARA (assistente do módulo)', '{ver,aprovar}', 95)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('qualidade', 'Qualidade', '0.1.0', '/modules/qualidade', 'qualidade.view', 'integrated', 60)
on conflict (code) do update set status = 'integrated', name = 'Qualidade', version = excluded.version, route = excluded.route, menu_order = excluded.menu_order;

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'qualidade', true, true from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- --- Arquivos (privado; sobe e desce só pelo servidor) -----------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('qualidade-evidencias', 'qualidade-evidencias', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- --- Regras (da área de Qualidade) --------------------------------------------------------------
create table if not exists public.qualidade_regras (
  organization_id   uuid primary key references public.organizations (id) on delete cascade,
  tipos             text[] not null,
  usar_gravidade    boolean not null default false,
  gravidades        text[] not null default array['Leve', 'Moderada', 'Grave'],
  revisado_por      uuid references public.profiles (id) on delete set null,
  revisado_por_nome text,
  revisado_em       timestamptz,
  updated_at        timestamptz not null default now(),
  check (cardinality(tipos) between 1 and 30),
  check (cardinality(gravidades) between 1 and 10)
);
comment on table public.qualidade_regras is 'Tipos de não conformidade e uso da gravidade. Semeados como provisórios (revisado_em vazio) até a área de Qualidade revisar.';

insert into public.qualidade_regras (organization_id, tipos)
select o.id, array['Peça ou produto', 'Processo', 'Material ou fornecedor', 'Máquina ou equipamento', 'Segurança', 'Organização', 'Reclamação de cliente', 'Outro']
from public.organizations o
on conflict (organization_id) do nothing;

-- --- Não conformidades --------------------------------------------------------------------------
create table if not exists public.qualidade_nao_conformidades (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  numero          integer not null,
  tipo            text not null,
  setor           text not null,
  local           text,
  maquina         text,
  os_codigo       text,
  -- O que a pessoa disse, confirmado no cartão.
  descricao       text not null check (length(trim(descricao)) between 3 and 4000),
  -- O que a SARA leu na foto: opinião do modelo, mostrada separada e com a confiança.
  analise_sara    text,
  confianca       text check (confianca in ('alta', 'media', 'baixa')),
  gravidade       text,
  situacao        text not null default 'aberta' check (situacao in ('aberta', 'encerrada', 'cancelada')),
  conversa_id     uuid,
  autor_id        uuid references public.profiles (id) on delete set null,
  autor_nome      text not null,
  encerrada_em    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, numero)
);
create index if not exists qualidade_nc_data_idx on public.qualidade_nao_conformidades (organization_id, created_at desc);

create table if not exists public.qualidade_nc_fotos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Vazio enquanto a foto espera o registro da NC.
  nc_id           uuid references public.qualidade_nao_conformidades (id) on delete restrict,
  conversa_id     uuid,
  autor_id        uuid not null references public.profiles (id) on delete restrict,
  storage_path    text not null unique,
  mime            text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  tamanho         integer not null check (tamanho > 0),
  created_at      timestamptz not null default now()
);
create index if not exists qualidade_nc_fotos_nc_idx on public.qualidade_nc_fotos (nc_id);
create index if not exists qualidade_nc_fotos_pendentes_idx on public.qualidade_nc_fotos (conversa_id) where nc_id is null;

create table if not exists public.qualidade_nc_andamentos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  nc_id           uuid not null references public.qualidade_nao_conformidades (id) on delete cascade,
  autor_id        uuid references public.profiles (id) on delete set null,
  autor_nome      text not null,
  tipo            text not null check (tipo in ('registro', 'comentario', 'correcao', 'situacao')),
  texto           text not null,
  created_at      timestamptz not null default now()
);
create index if not exists qualidade_nc_andamentos_nc_idx on public.qualidade_nc_andamentos (nc_id, created_at);

alter table public.qualidade_regras enable row level security;
alter table public.qualidade_nao_conformidades enable row level security;
alter table public.qualidade_nc_fotos enable row level security;
alter table public.qualidade_nc_andamentos enable row level security;

drop policy if exists qualidade_regras_read on public.qualidade_regras;
create policy qualidade_regras_read on public.qualidade_regras for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('qualidade.nao_conformidades')));
drop policy if exists qualidade_nc_read on public.qualidade_nao_conformidades;
create policy qualidade_nc_read on public.qualidade_nao_conformidades for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('qualidade.nao_conformidades')));
-- Foto pendente só aparece para quem a mandou.
drop policy if exists qualidade_nc_fotos_read on public.qualidade_nc_fotos;
create policy qualidade_nc_fotos_read on public.qualidade_nc_fotos for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('qualidade.nao_conformidades'))
    and (nc_id is not null or autor_id = (select public.current_profile_id())));
drop policy if exists qualidade_nc_andamentos_read on public.qualidade_nc_andamentos;
create policy qualidade_nc_andamentos_read on public.qualidade_nc_andamentos for select
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('qualidade.nao_conformidades')));

revoke insert, update, delete on public.qualidade_regras, public.qualidade_nao_conformidades, public.qualidade_nc_fotos, public.qualidade_nc_andamentos from anon, authenticated;
grant select on public.qualidade_regras, public.qualidade_nao_conformidades, public.qualidade_nc_fotos, public.qualidade_nc_andamentos to authenticated;

-- --- Apoio ----------------------------------------------------------------------------------------
create or replace function public.qualidade_exigir(p_nivel public.access_level default 'operar')
returns uuid language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or public.current_profile_id() is null or not public.has_feature('qualidade.nao_conformidades', p_nivel) then
    raise exception 'Você não tem permissão para % as não conformidades.', case p_nivel when 'ver' then 'ver' when 'operar' then 'registrar ou alterar' else 'aprovar' end using errcode = '42501';
  end if;
  return org;
end $$;
revoke all on function public.qualidade_exigir(public.access_level) from public, anon;

create or replace function public.qualidade_meu_nome()
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = public.current_profile_id()
$$;
revoke all on function public.qualidade_meu_nome() from public, anon;

create or replace function public.qualidade_texto(p_texto text, p_max integer)
returns text language sql immutable as $$
  select nullif(left(trim(coalesce(p_texto, '')), p_max), '')
$$;
revoke all on function public.qualidade_texto(text, integer) from public, anon;

-- Setor da lista real de departamentos; devolve o nome como está no cadastro.
create or replace function public.qualidade_setor(p_org uuid, p_setor text)
returns text language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  select name into s from public.departments
  where organization_id = p_org and active and lower(name) = lower(trim(coalesce(p_setor, ''))) limit 1;
  if s is null then raise exception 'Escolha um dos setores da empresa.'; end if;
  return s;
end $$;
revoke all on function public.qualidade_setor(uuid, text) from public, anon;

-- --- Foto pendente ----------------------------------------------------------------------------------
-- O servidor sobe o arquivo e registra aqui, com a sessão de quem mandou.
create or replace function public.qualidade_foto_guardar(p_id uuid, p_caminho text, p_mime text, p_tamanho integer, p_conversa uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare org uuid := public.qualidade_exigir('operar');
begin
  if p_caminho not like org::text || '/%' then raise exception 'Caminho inválido.'; end if;
  insert into public.qualidade_nc_fotos (id, organization_id, conversa_id, autor_id, storage_path, mime, tamanho)
  values (p_id, org, p_conversa, public.current_profile_id(), p_caminho, p_mime, p_tamanho);
  return p_id;
end $$;
revoke all on function public.qualidade_foto_guardar(uuid, text, text, integer, uuid) from public, anon;
grant execute on function public.qualidade_foto_guardar(uuid, text, text, integer, uuid) to authenticated;

-- A primeira mensagem nasce sem conversa: a foto é ligada a ela depois de a conversa existir.
create or replace function public.qualidade_foto_ligar_conversa(p_foto uuid, p_conversa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.qualidade_exigir('operar');
begin
  update public.qualidade_nc_fotos set conversa_id = p_conversa
  where id = p_foto and organization_id = org and autor_id = public.current_profile_id() and nc_id is null and conversa_id is null;
end $$;
revoke all on function public.qualidade_foto_ligar_conversa(uuid, uuid) from public, anon;
grant execute on function public.qualidade_foto_ligar_conversa(uuid, uuid) to authenticated;

-- Apaga as pendentes da pessoa com mais de 7 dias e devolve os caminhos para o servidor limpar o arquivo.
create or replace function public.qualidade_fotos_vencidas_limpar()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('operar');
  caminhos text[];
begin
  with apagadas as (
    delete from public.qualidade_nc_fotos
    where organization_id = org and autor_id = public.current_profile_id() and nc_id is null and created_at < now() - interval '7 days'
    returning storage_path
  )
  select coalesce(array_agg(storage_path), '{}') into caminhos from apagadas;
  return caminhos;
end $$;
revoke all on function public.qualidade_fotos_vencidas_limpar() from public, anon;
grant execute on function public.qualidade_fotos_vencidas_limpar() to authenticated;

create or replace function public.qualidade_foto_abrir(p_foto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('ver');
  f record;
begin
  select id, storage_path, mime, numero into f from (
    select ft.id, ft.storage_path, ft.mime, n.numero
    from public.qualidade_nc_fotos ft left join public.qualidade_nao_conformidades n on n.id = ft.nc_id
    where ft.id = p_foto and ft.organization_id = org and (ft.nc_id is not null or ft.autor_id = public.current_profile_id())
  ) x;
  if f.id is null then raise exception 'Foto não encontrada.'; end if;
  return jsonb_build_object('storage_path', f.storage_path, 'mime', f.mime, 'numero', f.numero);
end $$;
revoke all on function public.qualidade_foto_abrir(uuid) from public, anon;
grant execute on function public.qualidade_foto_abrir(uuid) to authenticated;

-- --- Registro ---------------------------------------------------------------------------------------
-- p: { tipo, setor, local, maquina, os, descricao, analise_sara, confianca, gravidade, fotos: [uuid] }
create or replace function public.qualidade_nc_registrar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('operar');
  me uuid := public.current_profile_id();
  nome text := public.qualidade_meu_nome();
  r public.qualidade_regras%rowtype;
  n integer;
  c public.qualidade_nao_conformidades%rowtype;
  v_tipo text := trim(coalesce(p ->> 'tipo', ''));
  v_setor text;
  v_grav text := public.qualidade_texto(p ->> 'gravidade', 40);
  v_conf text := public.qualidade_texto(p ->> 'confianca', 10);
  v_desc text := public.qualidade_texto(p ->> 'descricao', 4000);
  v_fotos uuid[];
  v_conversa uuid;
  ligadas integer;
begin
  select * into r from public.qualidade_regras where organization_id = org;
  if r.organization_id is null then raise exception 'As regras de não conformidade ainda não foram configuradas.'; end if;
  if not (v_tipo = any (r.tipos)) then raise exception 'Escolha um dos tipos da lista.'; end if;
  v_setor := public.qualidade_setor(org, p ->> 'setor');
  if length(coalesce(v_desc, '')) < 3 then raise exception 'Descreva o que aconteceu.'; end if;
  if v_conf is not null and v_conf not in ('alta', 'media', 'baixa') then v_conf := null; end if;
  if not r.usar_gravidade then v_grav := null;
  elsif v_grav is null or not (v_grav = any (r.gravidades)) then raise exception 'Escolha uma das gravidades da lista.'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_fotos from jsonb_array_elements_text(coalesce(p -> 'fotos', '[]'::jsonb)) x;
  select conversa_id into v_conversa from public.qualidade_nc_fotos where id = any (v_fotos) and autor_id = me and nc_id is null limit 1;

  perform pg_advisory_xact_lock(hashtext('qualidade_nc:' || org::text));
  select coalesce(max(numero), 0) + 1 into n from public.qualidade_nao_conformidades where organization_id = org;
  insert into public.qualidade_nao_conformidades (organization_id, numero, tipo, setor, local, maquina, os_codigo, descricao, analise_sara, confianca, gravidade, conversa_id, autor_id, autor_nome)
  values (org, n, v_tipo, v_setor, public.qualidade_texto(p ->> 'local', 160), public.qualidade_texto(p ->> 'maquina', 160), public.qualidade_texto(p ->> 'os', 40),
    v_desc, public.qualidade_texto(p ->> 'analise_sara', 2000), v_conf, v_grav, v_conversa, me, nome)
  returning * into c;
  update public.qualidade_nc_fotos set nc_id = c.id where id = any (v_fotos) and organization_id = org and autor_id = me and nc_id is null;
  get diagnostics ligadas = row_count;
  insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto)
  values (org, c.id, me, nome, 'registro', format('Registrou a não conformidade pela SARA (%s).', case ligadas when 0 then 'sem foto' when 1 then '1 foto' else ligadas || ' fotos' end));

  perform public.notify_feature(org, 'qualidade.nao_conformidades', 'aprovar', 'qualidade', 'attention',
    format('Não conformidade NC-%s · %s', c.numero, c.tipo), left(format('%s (%s): %s', nome, c.setor, c.descricao), 400), '/?module=qualidade&secao=N%C3%A3o%20conformidades', me);
  perform public.emit_module_event(org, 'qualidade', 'qualidade.nc.registrada', 'qualidade_nc', c.id::text,
    format('Não conformidade NC-%s registrada: %s, %s', c.numero, c.tipo, c.setor),
    jsonb_build_object('numero', c.numero, 'tipo', c.tipo, 'setor', c.setor, 'fotos', ligadas));
  return jsonb_build_object('id', c.id, 'numero', c.numero, 'fotos', ligadas);
end $$;
revoke all on function public.qualidade_nc_registrar(jsonb) from public, anon;
grant execute on function public.qualidade_nc_registrar(jsonb) to authenticated;

-- --- Andamento --------------------------------------------------------------------------------------
-- p_acao: comentar · corrigir · encerrar · reabrir · cancelar
-- p_extra (corrigir): { tipo, setor, local, maquina, os, descricao, gravidade }
create or replace function public.qualidade_nc_acao(p_nc uuid, p_acao text, p_texto text default null, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('operar');
  me uuid := public.current_profile_id();
  nome text := public.qualidade_meu_nome();
  c public.qualidade_nao_conformidades%rowtype;
  r public.qualidade_regras%rowtype;
  texto text := public.qualidade_texto(p_texto, 2000);
  v_tipo text; v_setor text; v_local text; v_maq text; v_os text; v_desc text; v_grav text;
  mudou text[] := '{}';
begin
  select * into c from public.qualidade_nao_conformidades where id = p_nc and organization_id = org for update;
  if c.id is null then raise exception 'Não conformidade não encontrada.'; end if;

  if p_acao = 'comentar' then
    if texto is null then raise exception 'Escreva o comentário.'; end if;
    insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto) values (org, c.id, me, nome, 'comentario', texto);

  elsif p_acao = 'corrigir' then
    if c.situacao <> 'aberta' then raise exception 'Reabra a não conformidade para corrigir.'; end if;
    select * into r from public.qualidade_regras where organization_id = org;
    v_tipo := coalesce(public.qualidade_texto(p_extra ->> 'tipo', 120), c.tipo);
    if v_tipo <> c.tipo and not (v_tipo = any (r.tipos)) then raise exception 'Escolha um dos tipos da lista.'; end if;
    v_setor := case when p_extra ? 'setor' then public.qualidade_setor(org, p_extra ->> 'setor') else c.setor end;
    v_local := case when p_extra ? 'local' then public.qualidade_texto(p_extra ->> 'local', 160) else c.local end;
    v_maq := case when p_extra ? 'maquina' then public.qualidade_texto(p_extra ->> 'maquina', 160) else c.maquina end;
    v_os := case when p_extra ? 'os' then public.qualidade_texto(p_extra ->> 'os', 40) else c.os_codigo end;
    v_desc := coalesce(public.qualidade_texto(p_extra ->> 'descricao', 4000), c.descricao);
    if length(v_desc) < 3 then raise exception 'Descreva o que aconteceu.'; end if;
    v_grav := case when r.usar_gravidade and p_extra ? 'gravidade' then public.qualidade_texto(p_extra ->> 'gravidade', 40) else c.gravidade end;
    if v_grav is distinct from c.gravidade and v_grav is not null and not (v_grav = any (r.gravidades)) then raise exception 'Escolha uma das gravidades da lista.'; end if;
    if v_tipo is distinct from c.tipo then mudou := mudou || format('tipo: %s → %s', c.tipo, v_tipo); end if;
    if v_setor is distinct from c.setor then mudou := mudou || format('setor: %s → %s', c.setor, v_setor); end if;
    if v_local is distinct from c.local then mudou := mudou || format('local: %s → %s', coalesce(c.local, '—'), coalesce(v_local, '—')); end if;
    if v_maq is distinct from c.maquina then mudou := mudou || format('máquina: %s → %s', coalesce(c.maquina, '—'), coalesce(v_maq, '—')); end if;
    if v_os is distinct from c.os_codigo then mudou := mudou || format('OS: %s → %s', coalesce(c.os_codigo, '—'), coalesce(v_os, '—')); end if;
    if v_grav is distinct from c.gravidade then mudou := mudou || format('gravidade: %s → %s', coalesce(c.gravidade, '—'), coalesce(v_grav, '—')); end if;
    if v_desc is distinct from c.descricao then mudou := mudou || 'descrição'::text; end if;
    if cardinality(mudou) = 0 then return; end if;
    update public.qualidade_nao_conformidades set tipo = v_tipo, setor = v_setor, local = v_local, maquina = v_maq, os_codigo = v_os, descricao = v_desc, gravidade = v_grav, updated_at = now() where id = c.id;
    insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'correcao', left('Corrigiu ' || array_to_string(mudou, '; ') || coalesce('. ' || texto, ''), 2000));

  elsif p_acao in ('encerrar', 'reabrir', 'cancelar') then
    if p_acao = 'reabrir' and c.situacao = 'aberta' then raise exception 'Esta não conformidade já está aberta.'; end if;
    if p_acao <> 'reabrir' and c.situacao <> 'aberta' then raise exception 'Esta não conformidade não está aberta.'; end if;
    if p_acao = 'cancelar' and texto is null then raise exception 'Diga por que está cancelando.'; end if;
    update public.qualidade_nao_conformidades
    set situacao = case p_acao when 'encerrar' then 'encerrada' when 'cancelar' then 'cancelada' else 'aberta' end,
        encerrada_em = case when p_acao = 'reabrir' then null else now() end, updated_at = now()
    where id = c.id;
    insert into public.qualidade_nc_andamentos (organization_id, nc_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'situacao', (case p_acao when 'encerrar' then 'Encerrou' when 'cancelar' then 'Cancelou' else 'Reabriu' end) || coalesce(': ' || texto, '.'));

  else
    raise exception 'Ação inválida.';
  end if;

  perform public.emit_module_event(org, 'qualidade',
    case p_acao when 'comentar' then 'qualidade.nc.comentada' when 'corrigir' then 'qualidade.nc.corrigida' when 'encerrar' then 'qualidade.nc.encerrada' when 'cancelar' then 'qualidade.nc.cancelada' else 'qualidade.nc.reaberta' end,
    'qualidade_nc', c.id::text, format('Não conformidade NC-%s: %s', c.numero, p_acao), jsonb_build_object('numero', c.numero));
end $$;
revoke all on function public.qualidade_nc_acao(uuid, text, text, jsonb) from public, anon;
grant execute on function public.qualidade_nc_acao(uuid, text, text, jsonb) to authenticated;

-- --- Regras: quem aprova -----------------------------------------------------------------------------
create or replace function public.qualidade_salvar_regras(p_tipos text[], p_usar_gravidade boolean, p_gravidades text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.qualidade_exigir('aprovar');
  v_tipos text[];
  v_gravidades text[];
begin
  -- Sem repetir e na ordem digitada.
  select coalesce(array_agg(t order by o), '{}') into v_tipos
  from (select trim(x) t, min(o) o from unnest(p_tipos) with ordinality u(x, o) where trim(x) <> '' group by trim(x)) y;
  select coalesce(array_agg(t order by o), '{}') into v_gravidades
  from (select trim(x) t, min(o) o from unnest(p_gravidades) with ordinality u(x, o) where trim(x) <> '' group by trim(x)) y;
  if cardinality(v_tipos) = 0 then raise exception 'Informe ao menos um tipo.'; end if;
  if cardinality(v_tipos) > 30 then raise exception 'No máximo 30 tipos.'; end if;
  if p_usar_gravidade and cardinality(v_gravidades) = 0 then raise exception 'Informe ao menos uma gravidade.'; end if;
  if cardinality(v_gravidades) > 10 then raise exception 'No máximo 10 gravidades.'; end if;
  update public.qualidade_regras r
  set tipos = v_tipos, usar_gravidade = p_usar_gravidade, gravidades = case when cardinality(v_gravidades) > 0 then v_gravidades else r.gravidades end,
      revisado_por = public.current_profile_id(), revisado_por_nome = public.qualidade_meu_nome(), revisado_em = now(), updated_at = now()
  where r.organization_id = org;
  perform public.emit_module_event(org, 'qualidade', 'qualidade.regras.alteradas', 'qualidade_regras', org::text, 'Regras de não conformidade alteradas',
    jsonb_build_object('tipos', cardinality(v_tipos), 'usar_gravidade', p_usar_gravidade));
end $$;
revoke all on function public.qualidade_salvar_regras(text[], boolean, text[]) from public, anon;
grant execute on function public.qualidade_salvar_regras(text[], boolean, text[]) to authenticated;

notify pgrst, 'reload schema';
