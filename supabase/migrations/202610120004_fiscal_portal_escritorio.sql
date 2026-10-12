-- Fiscal — Portal do escritório de contabilidade (Entrega A, 12/10/2026, pedido do proprietário).
--
-- O malote continua levando o papel; o andamento passa a ficar aqui. Organizado por competência:
--   - checklist do fechamento do mês (modelo por empresa, editável; números tirados da plataforma);
--   - malote (o que foi no papel, e o "recebido" do escritório);
--   - pendências nos dois sentidos, com mensagens e anexos;
--   - situação da competência: em preparação → enviada → conferida → fechada.
--
-- Dois lados, duas permissões:
--   fiscal.escritorio (ver/operar) — a EMPRESA: prepara o fechamento, registra malote, responde;
--   fiscal.portal (operar)        — o ESCRITÓRIO (conta de terceiro, com validade): vê o portal,
--                                    confirma o malote, abre e responde pendências, envia anexos,
--                                    marca a competência como conferida.
-- O escritório vê só o portal: os números do mês chegam como totais, nunca as linhas dos módulos
-- (o que mais ele puder ver, o proprietário libera em Pessoas e Acessos).
-- LGPD: o escritório é operador de dados. Aceite do termo de confidencialidade antes de usar; tudo
-- que ele abre, baixa e faz vai para a auditoria (audit_logs).

insert into public.access_features (code, module_code, label, levels, sort) values
  ('fiscal.escritorio', 'fiscal', 'Escritório contábil', '{ver,operar}', 50),
  ('fiscal.portal', 'fiscal', 'Portal do contador', '{operar}', 60)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- De que lado a pessoa está ------------------------------------------------------------------
-- 'empresa' (dono ou Escritório contábil), 'escritorio' (Portal do contador) ou nulo (sem acesso).
create or replace function public.fiscal_portal_lado()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_organization_id() is null then null
    when public.is_owner() or public.has_feature('fiscal.escritorio') then 'empresa'
    when public.has_feature('fiscal.portal', 'operar') then 'escritorio'
  end
$$;
revoke all on function public.fiscal_portal_lado() from public, anon;
grant execute on function public.fiscal_portal_lado() to authenticated;

-- --- Tabelas --------------------------------------------------------------------------------------
create table if not exists public.fiscal_checklist_modelo (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null check (codigo ~ '^[a-z_]{2,40}$'),
  rotulo text not null check (length(rotulo) between 2 and 120),
  descricao text check (descricao is null or length(descricao) <= 300),
  -- indicador: número tirado da plataforma para este item (nulo = item só manual)
  indicador text check (indicador is null or indicador in ('notas_entrada', 'notas_sefaz', 'livro_icms', 'malote')),
  ordem int not null default 100,
  ativo boolean not null default true,
  unique (organization_id, codigo)
);

create table if not exists public.fiscal_competencias (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  situacao text not null default 'em_preparacao' check (situacao in ('em_preparacao', 'enviada', 'conferida', 'fechada')),
  enviada_em timestamptz, enviada_por_nome text,
  conferida_em timestamptz, conferida_por_nome text,
  fechada_em timestamptz, fechada_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, competencia)
);

create table if not exists public.fiscal_competencia_itens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia_id uuid not null references public.fiscal_competencias(id) on delete cascade,
  codigo text not null,
  rotulo text not null,
  descricao text,
  indicador text,
  ordem int not null default 100,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'pronto', 'nao_se_aplica')),
  observacao text check (observacao is null or length(observacao) <= 300),
  marcado_por_nome text,
  marcado_em timestamptz,
  unique (competencia_id, codigo)
);

create table if not exists public.fiscal_malotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia_id uuid not null references public.fiscal_competencias(id) on delete cascade,
  numero int not null,
  enviado_em date not null default current_date,
  conteudo text not null check (length(trim(conteudo)) between 2 and 2000),
  observacao text check (observacao is null or length(observacao) <= 500),
  enviado_por uuid references public.profiles(id) on delete set null,
  enviado_por_nome text,
  recebido_em timestamptz,
  recebido_por_nome text,
  recebido_obs text check (recebido_obs is null or length(recebido_obs) <= 500),
  created_at timestamptz not null default now(),
  unique (organization_id, numero)
);

create table if not exists public.fiscal_pendencias (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competencia_id uuid references public.fiscal_competencias(id) on delete set null,
  assunto text not null check (length(trim(assunto)) between 3 and 160),
  aberta_por_lado text not null check (aberta_por_lado in ('empresa', 'escritorio')),
  aberta_por_nome text,
  -- quem precisa agir agora
  situacao text not null default 'aguardando_escritorio' check (situacao in ('aguardando_empresa', 'aguardando_escritorio', 'resolvida')),
  resolvida_em timestamptz,
  resolvida_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_fiscal_pendencias_org on public.fiscal_pendencias (organization_id, situacao, updated_at desc);

create table if not exists public.fiscal_pendencia_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pendencia_id uuid not null references public.fiscal_pendencias(id) on delete cascade,
  lado text not null check (lado in ('empresa', 'escritorio')),
  autor uuid references public.profiles(id) on delete set null,
  autor_nome text,
  texto text not null check (length(trim(texto)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_fiscal_pendencia_mensagens on public.fiscal_pendencia_mensagens (pendencia_id, created_at);

-- Anexos do portal: SÓ estes documentos o escritório pode baixar.
create table if not exists public.fiscal_portal_anexos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.company_documents(id) on delete cascade,
  competencia_id uuid references public.fiscal_competencias(id) on delete cascade,
  pendencia_id uuid references public.fiscal_pendencias(id) on delete cascade,
  lado text not null check (lado in ('empresa', 'escritorio')),
  nome text not null,
  tamanho bigint not null default 0,
  enviado_por_nome text,
  created_at timestamptz not null default now(),
  check (competencia_id is not null or pendencia_id is not null)
);
create index if not exists idx_fiscal_portal_anexos on public.fiscal_portal_anexos (organization_id, competencia_id);

create table if not exists public.fiscal_portal_aceites (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  versao text not null,
  aceito_em timestamptz not null default now(),
  primary key (profile_id, versao)
);

-- Leitura: quem é de um dos lados do portal, na própria organização. Escrita: só pelas funções.
do $$
declare t text;
begin
  foreach t in array array['fiscal_checklist_modelo', 'fiscal_competencias', 'fiscal_competencia_itens', 'fiscal_malotes',
                           'fiscal_pendencias', 'fiscal_pendencia_mensagens', 'fiscal_portal_anexos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (organization_id = (select public.current_organization_id()) and (select public.fiscal_portal_lado()) is not null)', t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter table public.fiscal_portal_aceites enable row level security;
drop policy if exists fiscal_portal_aceites_read on public.fiscal_portal_aceites;
create policy fiscal_portal_aceites_read on public.fiscal_portal_aceites for select using (
  organization_id = (select public.current_organization_id()) and (profile_id = (select public.current_profile_id()) or (select public.fiscal_portal_lado()) = 'empresa')
);
revoke insert, update, delete on public.fiscal_portal_aceites from anon, authenticated;

-- Modelo inicial do checklist (genérico; cada empresa ajusta o seu).
insert into public.fiscal_checklist_modelo (organization_id, codigo, rotulo, descricao, indicador, ordem)
select o.id, m.codigo, m.rotulo, m.descricao, m.indicador, m.ordem
from public.organizations o
cross join (values
  ('notas_entrada', 'Notas de entrada lançadas', 'Notas de entrada do mês no Painel do ICMS, com XML.', 'notas_entrada', 10),
  ('notas_sefaz', 'Notas da SEFAZ conferidas', 'Toda nota emitida contra o CNPJ da empresa está no Painel do ICMS (ou foi recusada).', 'notas_sefaz', 20),
  ('notas_saida', 'Notas de saída', 'Notas emitidas pela empresa no mês.', null, 30),
  ('livro_icms', 'Livro de apuração do ICMS', 'Créditos e débitos do mês lançados no livro.', 'livro_icms', 40),
  ('extratos', 'Extratos bancários', 'Extratos de todas as contas do mês.', null, 50),
  ('malote', 'Malote enviado', 'Documentos físicos do mês enviados ao escritório.', 'malote', 60)
) as m(codigo, rotulo, descricao, indicador, ordem)
on conflict (organization_id, codigo) do nothing;

-- --- Auditoria e avisos -----------------------------------------------------------------------------
create or replace function public.fiscal_portal_auditar(p_org uuid, p_evento text, p_tipo text, p_id uuid, p_dados jsonb, p_risco text default 'normal')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (organization_id, actor_user_id, actor_profile_id, module_code, event_type, entity_type, entity_id, risk_level, metadata)
  values (p_org, auth.uid(), public.current_profile_id(), 'fiscal', p_evento, p_tipo, p_id, p_risco,
    coalesce(p_dados, '{}'::jsonb) || jsonb_build_object('lado', public.fiscal_portal_lado(),
      'por', (select full_name from public.profiles where id = public.current_profile_id())))
$$;
revoke all on function public.fiscal_portal_auditar(uuid, text, text, uuid, jsonb, text) from public, anon, authenticated;

-- Aviso para o OUTRO lado: 'escritorio' = quem tem o Portal do contador; 'empresa' = quem opera o
-- Escritório contábil (sem ninguém, os proprietários). Quem fez não recebe.
create or replace function public.fiscal_portal_avisar(p_org uuid, p_destino text, p_severidade text, p_titulo text, p_corpo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.current_profile_id();
  alvo text := case when p_destino = 'escritorio' then 'fiscal.portal' else 'fiscal.escritorio' end;
  url text := '/?module=fiscal&secao=' || case when p_destino = 'escritorio' then 'Portal%20do%20contador' else 'Escrit%C3%B3rio%20cont%C3%A1bil' end;
begin
  insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
  select distinct p_org, p.id, 'fiscal', p_severidade, left(p_titulo, 200), left(p_corpo, 500), url
  from public.profiles p
  where p.organization_id = p_org and p.status = 'active' and (p.access_expires_at is null or p.access_expires_at > now())
    and (me is null or p.id <> me)
    and (exists (select 1 from public.user_feature_grants g where g.profile_id = p.id and g.organization_id = p_org and g.feature_code = alvo and g.level >= 'operar')
      or (p_destino = 'empresa' and p.is_owner and not exists (
        select 1 from public.user_feature_grants g join public.profiles q on q.id = g.profile_id
        where g.organization_id = p_org and g.feature_code = 'fiscal.escritorio' and g.level >= 'operar' and q.status = 'active')));
end;
$$;
revoke all on function public.fiscal_portal_avisar(uuid, text, text, text, text) from public, anon, authenticated;

-- --- Regras de acesso das funções ------------------------------------------------------------------
-- Empresa que opera, ou escritório que já aceitou o termo vigente.
create or replace function public.fiscal_portal_exigir(p_lado text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lado text := public.fiscal_portal_lado();
begin
  if lado is null then raise exception 'Sem acesso ao portal do escritório.' using errcode = '42501'; end if;
  if p_lado is not null and lado <> p_lado then
    raise exception '%', case when p_lado = 'empresa' then 'Esta ação é da empresa.' else 'Esta ação é do escritório.' end using errcode = '42501';
  end if;
  if lado = 'empresa' and not (public.is_owner() or public.has_feature('fiscal.escritorio', 'operar')) then
    raise exception 'Você acompanha o portal, mas não opera o Escritório contábil.' using errcode = '42501';
  end if;
  if lado = 'escritorio' and not exists (select 1 from public.fiscal_portal_aceites where profile_id = public.current_profile_id() and versao = 'v1-2026-10') then
    raise exception 'Aceite o termo de confidencialidade antes de usar o portal.' using errcode = '42501';
  end if;
  return lado;
end;
$$;
revoke all on function public.fiscal_portal_exigir(text) from public, anon, authenticated;

-- --- Aceite do termo (escritório) --------------------------------------------------------------------
create or replace function public.fiscal_portal_aceitar(p_versao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.fiscal_portal_lado() is null then raise exception 'Sem acesso ao portal do escritório.' using errcode = '42501'; end if;
  if p_versao <> 'v1-2026-10' then raise exception 'Versão do termo desconhecida.'; end if;
  insert into public.fiscal_portal_aceites (organization_id, profile_id, versao) values (org, public.current_profile_id(), p_versao)
  on conflict do nothing;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.aceite', 'profile', public.current_profile_id(), jsonb_build_object('versao', p_versao), 'sensitive');
end;
$$;

-- Registro de acesso do escritório (uma vez por competência por dia), para a auditoria.
create or replace function public.fiscal_portal_registrar_acesso(p_mes date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.fiscal_portal_lado() is distinct from 'escritorio' then return; end if;
  if exists (select 1 from public.audit_logs where organization_id = org and actor_profile_id = public.current_profile_id()
     and event_type = 'fiscal_portal.acesso' and metadata ->> 'competencia' = to_char(p_mes, 'YYYY-MM') and occurred_at > now() - interval '1 day') then
    return;
  end if;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.acesso', 'organization', org, jsonb_build_object('competencia', to_char(p_mes, 'YYYY-MM')), 'normal');
end;
$$;

-- --- Competência --------------------------------------------------------------------------------------
create or replace function public.fiscal_portal_competencia_abrir(p_mes date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  mes date := date_trunc('month', p_mes)::date;
  novo uuid;
begin
  perform public.fiscal_portal_exigir('empresa');
  insert into public.fiscal_competencias (organization_id, competencia) values (org, mes)
  on conflict (organization_id, competencia) do nothing returning id into novo;
  if novo is null then return (select id from public.fiscal_competencias where organization_id = org and competencia = mes); end if;
  insert into public.fiscal_competencia_itens (organization_id, competencia_id, codigo, rotulo, descricao, indicador, ordem)
  select org, novo, m.codigo, m.rotulo, m.descricao, m.indicador, m.ordem from public.fiscal_checklist_modelo m where m.organization_id = org and m.ativo;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.competencia_aberta', 'fiscal_competencia', novo, jsonb_build_object('competencia', to_char(mes, 'YYYY-MM')));
  return novo;
end;
$$;

-- Situação: empresa envia, reabre e fecha; o escritório confere.
create or replace function public.fiscal_portal_situacao(p_competencia uuid, p_situacao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  c public.fiscal_competencias%rowtype;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
  mes text;
begin
  select * into c from public.fiscal_competencias where id = p_competencia and organization_id = org for update;
  if c.id is null then raise exception 'Competência não encontrada.'; end if;
  mes := to_char(c.competencia, 'MM/YYYY');
  if not (
    (lado = 'empresa' and p_situacao = 'enviada' and c.situacao = 'em_preparacao') or
    (lado = 'empresa' and p_situacao = 'em_preparacao' and c.situacao in ('enviada', 'conferida')) or
    (lado = 'empresa' and p_situacao = 'fechada' and c.situacao = 'conferida') or
    (lado = 'escritorio' and p_situacao = 'conferida' and c.situacao = 'enviada') or
    (lado = 'escritorio' and p_situacao = 'enviada' and c.situacao = 'conferida')
  ) then
    raise exception 'Mudança de situação não permitida (de % para %).', c.situacao, p_situacao;
  end if;
  update public.fiscal_competencias set situacao = p_situacao, updated_at = now(),
    enviada_em = case when p_situacao = 'enviada' and lado = 'empresa' then now() else enviada_em end,
    enviada_por_nome = case when p_situacao = 'enviada' and lado = 'empresa' then nome else enviada_por_nome end,
    conferida_em = case when p_situacao = 'conferida' then now() when p_situacao in ('em_preparacao', 'enviada') then null else conferida_em end,
    conferida_por_nome = case when p_situacao = 'conferida' then nome when p_situacao in ('em_preparacao', 'enviada') then null else conferida_por_nome end,
    fechada_em = case when p_situacao = 'fechada' then now() else null end,
    fechada_por_nome = case when p_situacao = 'fechada' then nome else null end
  where id = c.id;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.situacao', 'fiscal_competencia', c.id,
    jsonb_build_object('competencia', to_char(c.competencia, 'YYYY-MM'), 'de', c.situacao, 'para', p_situacao));
  if p_situacao = 'enviada' and lado = 'empresa' then
    perform public.fiscal_portal_avisar(org, 'escritorio', 'info', format('Competência %s enviada', mes), format('%s marcou a competência %s como pronta para o escritório.', nome, mes));
    perform public.emit_module_event(org, 'fiscal', 'fiscal.competencia.enviada', 'fiscal_competencia', c.id::text, format('Competência %s enviada ao escritório', mes), jsonb_build_object('competencia', to_char(c.competencia, 'YYYY-MM')));
  elsif p_situacao = 'conferida' then
    perform public.fiscal_portal_avisar(org, 'empresa', 'info', format('Escritório conferiu %s', mes), format('%s conferiu a competência %s.', nome, mes));
    perform public.emit_module_event(org, 'fiscal', 'fiscal.competencia.conferida', 'fiscal_competencia', c.id::text, format('Competência %s conferida pelo escritório', mes), jsonb_build_object('competencia', to_char(c.competencia, 'YYYY-MM')));
  elsif p_situacao = 'fechada' then
    perform public.emit_module_event(org, 'fiscal', 'fiscal.competencia.fechada', 'fiscal_competencia', c.id::text, format('Competência %s fechada', mes), jsonb_build_object('competencia', to_char(c.competencia, 'YYYY-MM')));
  elsif lado = 'escritorio' then
    perform public.fiscal_portal_avisar(org, 'empresa', 'attention', format('Escritório desfez a conferência de %s', mes), format('%s voltou a competência %s para "enviada".', nome, mes));
  else
    perform public.fiscal_portal_avisar(org, 'escritorio', 'attention', format('Competência %s reaberta', mes), format('%s reabriu a competência %s para ajustes.', nome, mes));
  end if;
end;
$$;

create or replace function public.fiscal_portal_item(p_item uuid, p_situacao text, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  i public.fiscal_competencia_itens%rowtype;
begin
  perform public.fiscal_portal_exigir('empresa');
  select * into i from public.fiscal_competencia_itens where id = p_item and organization_id = org;
  if i.id is null then raise exception 'Item não encontrado.'; end if;
  if (select situacao from public.fiscal_competencias where id = i.competencia_id) = 'fechada' then raise exception 'Competência fechada: reabra para mudar.'; end if;
  update public.fiscal_competencia_itens set situacao = p_situacao, observacao = nullif(trim(coalesce(p_observacao, '')), ''),
    marcado_por_nome = (select full_name from public.profiles where id = public.current_profile_id()), marcado_em = now()
  where id = i.id;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.item', 'fiscal_competencia_item', i.id, jsonb_build_object('item', i.codigo, 'situacao', p_situacao));
end;
$$;

-- --- Malote --------------------------------------------------------------------------------------------
create or replace function public.fiscal_portal_malote_registrar(p_competencia uuid, p_enviado_em date, p_conteudo text, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  c public.fiscal_competencias%rowtype;
  novo uuid;
  n int;
begin
  perform public.fiscal_portal_exigir('empresa');
  select * into c from public.fiscal_competencias where id = p_competencia and organization_id = org;
  if c.id is null then raise exception 'Competência não encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtext('fiscal_malote_' || org::text));
  select coalesce(max(numero), 0) + 1 into n from public.fiscal_malotes where organization_id = org;
  insert into public.fiscal_malotes (organization_id, competencia_id, numero, enviado_em, conteudo, observacao, enviado_por, enviado_por_nome)
  values (org, c.id, n, coalesce(p_enviado_em, current_date), trim(p_conteudo), nullif(trim(coalesce(p_observacao, '')), ''), me,
    (select full_name from public.profiles where id = me))
  returning id into novo;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.malote', 'fiscal_malote', novo, jsonb_build_object('numero', n, 'competencia', to_char(c.competencia, 'YYYY-MM')));
  perform public.fiscal_portal_avisar(org, 'escritorio', 'info', format('Malote nº %s a caminho', n), format('Competência %s · %s', to_char(c.competencia, 'MM/YYYY'), left(trim(p_conteudo), 300)));
  perform public.emit_module_event(org, 'fiscal', 'fiscal.malote.registrado', 'fiscal_malote', novo::text, format('Malote nº %s enviado ao escritório', n), jsonb_build_object('numero', n));
  return novo;
end;
$$;

create or replace function public.fiscal_portal_malote_receber(p_malote uuid, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  m public.fiscal_malotes%rowtype;
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
begin
  perform public.fiscal_portal_exigir('escritorio');
  select * into m from public.fiscal_malotes where id = p_malote and organization_id = org for update;
  if m.id is null then raise exception 'Malote não encontrado.'; end if;
  if m.recebido_em is not null then return; end if;
  update public.fiscal_malotes set recebido_em = now(), recebido_por_nome = nome, recebido_obs = nullif(trim(coalesce(p_observacao, '')), '') where id = m.id;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.malote_recebido', 'fiscal_malote', m.id, jsonb_build_object('numero', m.numero));
  perform public.fiscal_portal_avisar(org, 'empresa', case when nullif(trim(coalesce(p_observacao, '')), '') is null then 'info' else 'attention' end,
    format('Malote nº %s recebido pelo escritório', m.numero), coalesce(nullif(trim(coalesce(p_observacao, '')), ''), format('Recebido por %s.', nome)));
  perform public.emit_module_event(org, 'fiscal', 'fiscal.malote.recebido', 'fiscal_malote', m.id::text, format('Malote nº %s recebido pelo escritório', m.numero), jsonb_build_object('numero', m.numero));
end;
$$;

-- --- Pendências ------------------------------------------------------------------------------------------
create or replace function public.fiscal_portal_pendencia_abrir(p_competencia uuid, p_assunto text, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = me);
  novo uuid;
begin
  if p_competencia is not null and not exists (select 1 from public.fiscal_competencias where id = p_competencia and organization_id = org) then
    raise exception 'Competência não encontrada.';
  end if;
  insert into public.fiscal_pendencias (organization_id, competencia_id, assunto, aberta_por_lado, aberta_por_nome, situacao)
  values (org, p_competencia, trim(p_assunto), lado, nome, case when lado = 'empresa' then 'aguardando_escritorio' else 'aguardando_empresa' end)
  returning id into novo;
  insert into public.fiscal_pendencia_mensagens (organization_id, pendencia_id, lado, autor, autor_nome, texto) values (org, novo, lado, me, nome, trim(p_texto));
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.pendencia', 'fiscal_pendencia', novo, jsonb_build_object('assunto', left(trim(p_assunto), 160)));
  perform public.fiscal_portal_avisar(org, case when lado = 'empresa' then 'escritorio' else 'empresa' end, 'attention',
    format('Pendência: %s', left(trim(p_assunto), 120)), format('%s: %s', nome, left(trim(p_texto), 300)));
  perform public.emit_module_event(org, 'fiscal', 'fiscal.pendencia.aberta', 'fiscal_pendencia', novo::text,
    format('Pendência aberta (%s): %s', case when lado = 'empresa' then 'empresa' else 'escritório' end, left(trim(p_assunto), 120)), jsonb_build_object('lado', lado));
  return novo;
end;
$$;

create or replace function public.fiscal_portal_pendencia_responder(p_pendencia uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = me);
  p public.fiscal_pendencias%rowtype;
begin
  select * into p from public.fiscal_pendencias where id = p_pendencia and organization_id = org for update;
  if p.id is null then raise exception 'Pendência não encontrada.'; end if;
  insert into public.fiscal_pendencia_mensagens (organization_id, pendencia_id, lado, autor, autor_nome, texto) values (org, p.id, lado, me, nome, trim(p_texto));
  update public.fiscal_pendencias set situacao = case when lado = 'empresa' then 'aguardando_escritorio' else 'aguardando_empresa' end,
    resolvida_em = null, resolvida_por_nome = null, updated_at = now() where id = p.id;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.resposta', 'fiscal_pendencia', p.id, '{}'::jsonb);
  perform public.fiscal_portal_avisar(org, case when lado = 'empresa' then 'escritorio' else 'empresa' end, 'info',
    format('Resposta: %s', left(p.assunto, 120)), format('%s: %s', nome, left(trim(p_texto), 300)));
end;
$$;

create or replace function public.fiscal_portal_pendencia_resolver(p_pendencia uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  nome text := (select full_name from public.profiles where id = public.current_profile_id());
  p public.fiscal_pendencias%rowtype;
begin
  select * into p from public.fiscal_pendencias where id = p_pendencia and organization_id = org for update;
  if p.id is null then raise exception 'Pendência não encontrada.'; end if;
  if p.situacao = 'resolvida' then return; end if;
  update public.fiscal_pendencias set situacao = 'resolvida', resolvida_em = now(), resolvida_por_nome = nome, updated_at = now() where id = p.id;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.resolvida', 'fiscal_pendencia', p.id, '{}'::jsonb);
  perform public.fiscal_portal_avisar(org, case when lado = 'empresa' then 'escritorio' else 'empresa' end, 'info',
    format('Resolvida: %s', left(p.assunto, 120)), format('%s marcou a pendência como resolvida.', nome));
end;
$$;

-- --- Anexos ----------------------------------------------------------------------------------------------
-- O arquivo sobe pelo servidor (chave de serviço); o registro é feito aqui, com a sessão, que confere
-- o lado. Fica em Documentos › Fiscal com a funcionalidade fiscal.portal.
create or replace function public.fiscal_portal_anexo_registrar(
  p_competencia uuid, p_pendencia uuid, p_original_name text, p_mime text, p_size bigint, p_sha256 text, p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  lado text := public.fiscal_portal_exigir();
  me uuid := public.current_profile_id();
  nome text := (select full_name from public.profiles where id = me);
  doc uuid;
begin
  if p_competencia is null and p_pendencia is null then raise exception 'Anexe a uma competência ou a uma pendência.'; end if;
  if p_competencia is not null and not exists (select 1 from public.fiscal_competencias where id = p_competencia and organization_id = org) then raise exception 'Competência não encontrada.'; end if;
  if p_pendencia is not null and not exists (select 1 from public.fiscal_pendencias where id = p_pendencia and organization_id = org) then raise exception 'Pendência não encontrada.'; end if;
  if p_storage_path not like org::text || '/fiscal/%' then raise exception 'Caminho do arquivo inválido.'; end if;
  insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
    sha256, storage_path, version, source, entity_type, entity_id, uploaded_by, uploaded_by_name)
  values (org, 'fiscal', 'fiscal.portal', left(p_original_name, 200), 'Portal do escritório', left(p_original_name, 255), p_mime, p_size,
    lower(p_sha256), p_storage_path, 1, 'envio', case when p_pendencia is not null then 'fiscal_pendencia' else 'fiscal_competencia' end,
    coalesce(p_pendencia, p_competencia)::text, me, nome)
  returning id into doc;
  insert into public.fiscal_portal_anexos (organization_id, document_id, competencia_id, pendencia_id, lado, nome, tamanho, enviado_por_nome)
  values (org, doc, p_competencia, p_pendencia, lado, left(p_original_name, 255), coalesce(p_size, 0), nome);
  if p_pendencia is not null then update public.fiscal_pendencias set updated_at = now() where id = p_pendencia; end if;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.anexo', 'document', doc, jsonb_build_object('arquivo', left(p_original_name, 120), 'tamanho', p_size), 'sensitive');
  perform public.emit_module_event(org, 'fundacao', 'fundacao.documento.enviado', 'documento', doc::text,
    format('Documento guardado em fiscal: %s', left(p_original_name, 120)), jsonb_build_object('setor', 'fiscal', 'origem', 'portal', 'versao', 1, 'tamanho', p_size));
  return doc;
end;
$$;

-- Baixar um anexo: só documentos do portal, e fica na auditoria (quem, quando, qual arquivo).
create or replace function public.fiscal_portal_baixar(p_document uuid)
returns table (storage_path text, original_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if public.fiscal_portal_lado() is null then raise exception 'Sem acesso ao portal do escritório.' using errcode = '42501'; end if;
  if public.fiscal_portal_lado() = 'escritorio' then perform public.fiscal_portal_exigir('escritorio'); end if;
  if not exists (select 1 from public.fiscal_portal_anexos a where a.document_id = p_document and a.organization_id = org) then
    raise exception 'Arquivo não encontrado no portal.' using errcode = '42501';
  end if;
  perform public.fiscal_portal_auditar(org, 'fiscal_portal.download', 'document', p_document,
    jsonb_build_object('arquivo', (select d.original_name from public.company_documents d where d.id = p_document)), 'sensitive');
  return query select d.storage_path, d.original_name from public.company_documents d where d.id = p_document and d.organization_id = org;
end;
$$;

-- --- Números do mês (só totais) -----------------------------------------------------------------------------
create or replace function public.fiscal_portal_indicadores(p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  mes date := date_trunc('month', p_mes)::date;
  r jsonb;
begin
  if public.fiscal_portal_lado() is null then raise exception 'Sem acesso ao portal do escritório.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'notas_entrada', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(valor), 0), 'icms', coalesce(sum(icms), 0),
        'sem_xml', count(*) filter (where not xml_ok))
      from public.fiscal_icms_entries where organization_id = org and competencia = mes),
    'notas_sefaz', (select jsonb_build_object('quantidade', count(*),
        'fora_do_painel', count(*) filter (where d.situacao = 'autorizada' and not exists (select 1 from public.fiscal_icms_entries e where e.organization_id = org and e.chave = d.chave)),
        'canceladas', count(*) filter (where d.situacao = 'cancelada'))
      from public.fiscal_dfe d where d.organization_id = org and (d.emissao at time zone 'America/Sao_Paulo')::date >= mes and (d.emissao at time zone 'America/Sao_Paulo')::date < (mes + interval '1 month')),
    'livro_icms', (select jsonb_build_object('linhas', count(*), 'credito', coalesce(sum(credito), 0), 'debito', coalesce(sum(debito), 0))
      from public.fiscal_icms_ledger where organization_id = org and competencia = mes),
    'malote', (select jsonb_build_object('enviados', count(*), 'recebidos', count(*) filter (where m.recebido_em is not null))
      from public.fiscal_malotes m join public.fiscal_competencias c on c.id = m.competencia_id where m.organization_id = org and c.competencia = mes)
  ) into r;
  return r;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'fiscal_portal_aceitar(text)', 'fiscal_portal_registrar_acesso(date)', 'fiscal_portal_competencia_abrir(date)',
    'fiscal_portal_situacao(uuid, text)', 'fiscal_portal_item(uuid, text, text)', 'fiscal_portal_malote_registrar(uuid, date, text, text)',
    'fiscal_portal_malote_receber(uuid, text)', 'fiscal_portal_pendencia_abrir(uuid, text, text)', 'fiscal_portal_pendencia_responder(uuid, text)',
    'fiscal_portal_pendencia_resolver(uuid)', 'fiscal_portal_anexo_registrar(uuid, uuid, text, text, bigint, text, text)',
    'fiscal_portal_baixar(uuid)', 'fiscal_portal_indicadores(date)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
