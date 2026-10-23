-- Documentos da SARA central (23/10/2026, docs/PLANO-MINDMASTER.md › Documentos): a central monta relatórios e
-- cartas em PDF com o timbre da empresa e envia a quem se destina. SÓ A CENTRAL CRIA (warroom.sara); as SARAs
-- dos módulos e as pessoas só RECEBEM. Nesta etapa o envio é interno (plataforma); e-mail e WhatsApp vêm depois.
--   * O PDF fica no bucket privado `sara-documentos` (sem política para usuários: sobe e desce pelo servidor,
--     que confere quem pode abrir pela tabela).
--   * Número sequencial por ano (DOC-2026-0001), reservado antes de gerar o PDF (ele vai impresso).
--   * Veem o documento: quem criou, quem recebeu, o proprietário e a auditoria.
--   * Enviar: só quem criou (o Permitir da SARA chama sara_documento_enviar com a sessão dela). Quem recebe é
--     avisado no sino; abrir marca a hora.

insert into storage.buckets (id, name, public) values ('sara-documentos', 'sara-documentos', false)
on conflict (id) do update set public = false;

create table if not exists public.sara_documentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero text not null check (numero ~ '^DOC-\d{4}-\d{4,}$'),
  tipo text not null check (tipo in ('relatorio', 'carta')),
  titulo text not null check (length(btrim(titulo)) between 3 and 160),
  conteudo jsonb not null default '{}'::jsonb,
  areas text[] not null default '{}',
  caminho text,
  paginas integer,
  bytes integer,
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  conversa_id uuid references public.sara_conversas(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, numero)
);
create index if not exists idx_sara_documentos on public.sara_documentos (organization_id, created_at desc);

create table if not exists public.sara_documento_envios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  documento_id uuid not null references public.sara_documentos(id) on delete cascade,
  para_profile_id uuid not null references public.profiles(id) on delete cascade,
  para_nome text,
  canal text not null default 'plataforma' check (canal in ('plataforma', 'email', 'whatsapp')),
  enviado_por uuid references public.profiles(id) on delete set null,
  enviado_por_nome text,
  enviado_em timestamptz not null default now(),
  aberto_em timestamptz,
  unique (documento_id, para_profile_id, canal)
);
create index if not exists idx_sara_documento_envios_para on public.sara_documento_envios (para_profile_id, enviado_em desc);
comment on table public.sara_documentos is 'Documentos em PDF da SARA central (relatório, carta). Gravação pelas funções sara_documento_*.';
comment on table public.sara_documento_envios is 'Para quem cada documento da SARA central foi enviado, por qual canal, e quando abriu.';

-- Quem vê: quem criou, quem recebeu, o proprietário e a auditoria.
create or replace function public.sara_documento_pode_ver(p_documento uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sara_documentos d where d.id = p_documento and d.organization_id = public.current_organization_id()
    and (d.criado_por = public.current_profile_id() or public.is_owner() or public.has_feature('fundacao.auditoria')
         or exists (select 1 from public.sara_documento_envios e where e.documento_id = d.id and e.para_profile_id = public.current_profile_id())));
$$;
revoke all on function public.sara_documento_pode_ver(uuid) from public, anon;
grant execute on function public.sara_documento_pode_ver(uuid) to authenticated;

alter table public.sara_documentos enable row level security;
alter table public.sara_documento_envios enable row level security;
drop policy if exists sara_documentos_read on public.sara_documentos;
create policy sara_documentos_read on public.sara_documentos for select to authenticated
using (organization_id = (select public.current_organization_id()) and public.sara_documento_pode_ver(id));
drop policy if exists sara_documento_envios_read on public.sara_documento_envios;
create policy sara_documento_envios_read on public.sara_documento_envios for select to authenticated
using (organization_id = (select public.current_organization_id())
  and (para_profile_id = (select public.current_profile_id()) or public.sara_documento_pode_ver(documento_id)));
revoke insert, update, delete on public.sara_documentos, public.sara_documento_envios from anon, authenticated;
grant select on public.sara_documentos, public.sara_documento_envios to authenticated;

-- 1. Reserva o número e registra o documento (só a SARA central). O PDF é ligado depois (sara_documento_arquivo).
create or replace function public.sara_documento_registrar(p_tipo text, p_titulo text, p_conteudo jsonb, p_areas text[], p_conversa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  ano text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY');
  seq integer;
  v_id uuid;
  v_numero text;
begin
  if org is null or me is null or not public.has_feature('warroom.sara') then
    raise exception 'Só a SARA central cria documentos.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('sara_documentos:' || org::text || ':' || ano));
  select coalesce(max(substring(numero from '^DOC-\d{4}-(\d+)$')::int), 0) + 1 into seq
  from public.sara_documentos where organization_id = org and numero like 'DOC-' || ano || '-%';
  v_numero := 'DOC-' || ano || '-' || lpad(seq::text, 4, '0');
  insert into public.sara_documentos (organization_id, numero, tipo, titulo, conteudo, areas, criado_por, criado_por_nome, conversa_id)
  values (org, v_numero, p_tipo, left(btrim(p_titulo), 160), coalesce(p_conteudo, '{}'::jsonb), coalesce(p_areas, '{}'), me,
          (select full_name from public.profiles where id = me),
          (select id from public.sara_conversas where id = p_conversa and organization_id = org and profile_id = me))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;

-- 2. Liga o PDF guardado (só quem criou).
create or replace function public.sara_documento_arquivo(p_documento uuid, p_caminho text, p_paginas integer, p_bytes integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.sara_documentos set caminho = p_caminho, paginas = p_paginas, bytes = p_bytes
  where id = p_documento and organization_id = public.current_organization_id() and criado_por = public.current_profile_id() and caminho is null;
  if not found then raise exception 'Documento não encontrado.' using errcode = '42501'; end if;
end;
$$;

-- 3. Envia pela plataforma (só quem criou): registra e avisa no sino.
create or replace function public.sara_documento_enviar(p_documento uuid, p_para uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  d public.sara_documentos%rowtype;
  para record;
  v_id uuid;
begin
  select * into d from public.sara_documentos where id = p_documento and organization_id = org;
  if d.id is null or d.criado_por is distinct from me then raise exception 'Só quem criou o documento envia.' using errcode = '42501'; end if;
  if d.caminho is null then raise exception 'O PDF deste documento não foi gerado.'; end if;
  select id, full_name into para from public.profiles where id = p_para and organization_id = org and status = 'active'
    and (access_expires_at is null or access_expires_at > now());
  if para.id is null then raise exception 'Esta pessoa não está ativa na plataforma.'; end if;
  insert into public.sara_documento_envios (organization_id, documento_id, para_profile_id, para_nome, canal, enviado_por, enviado_por_nome)
  values (org, d.id, para.id, para.full_name, 'plataforma', me, (select full_name from public.profiles where id = me))
  on conflict (documento_id, para_profile_id, canal) do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ja_enviado', true, 'para', para.full_name); end if;
  perform public.notify_profile(org, para.id, 'sara', 'info', left(format('Documento para você: %s', d.titulo), 200),
    format('%s · %s, enviado pela SARA central. Toque para abrir o PDF.', d.numero, coalesce((select full_name from public.profiles where id = me), 'Plataforma')),
    '/?documentos=' || d.id::text);
  perform public.emit_module_event(org, 'sara', 'sara.documento.enviado', 'sara_documento', d.id::text,
    format('Documento %s enviado a %s', d.numero, para.full_name), jsonb_build_object('documento', d.id, 'para', para.id, 'canal', 'plataforma'));
  return jsonb_build_object('enviado', true, 'para', para.full_name, 'numero', d.numero);
end;
$$;

-- 4. Os documentos que recebi (e marcar como aberto).
create or replace function public.sara_documentos_recebidos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'tipo', d.tipo, 'titulo', d.titulo, 'paginas', d.paginas,
    'enviado_por', e.enviado_por_nome, 'enviado_em', e.enviado_em, 'aberto_em', e.aberto_em) order by e.enviado_em desc), '[]'::jsonb)
  from public.sara_documento_envios e join public.sara_documentos d on d.id = e.documento_id
  where e.organization_id = public.current_organization_id() and e.para_profile_id = public.current_profile_id()
    and e.enviado_em > now() - interval '180 days';
$$;
create or replace function public.sara_documento_aberto(p_documento uuid)
returns void language sql security definer set search_path = public as $$
  update public.sara_documento_envios set aberto_em = coalesce(aberto_em, now())
  where documento_id = p_documento and para_profile_id = public.current_profile_id() and organization_id = public.current_organization_id();
$$;

revoke all on function public.sara_documento_registrar(text, text, jsonb, text[], uuid) from public, anon;
revoke all on function public.sara_documento_arquivo(uuid, text, integer, integer) from public, anon;
revoke all on function public.sara_documento_enviar(uuid, uuid) from public, anon;
revoke all on function public.sara_documentos_recebidos() from public, anon;
revoke all on function public.sara_documento_aberto(uuid) from public, anon;
grant execute on function public.sara_documento_registrar(text, text, jsonb, text[], uuid) to authenticated;
grant execute on function public.sara_documento_arquivo(uuid, text, integer, integer) to authenticated;
grant execute on function public.sara_documento_enviar(uuid, uuid) to authenticated;
grant execute on function public.sara_documentos_recebidos() to authenticated;
grant execute on function public.sara_documento_aberto(uuid) to authenticated;
