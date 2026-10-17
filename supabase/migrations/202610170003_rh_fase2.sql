-- R-01 (roadmap) · Blueprint Fase 2: o RH deixa de ter partes de demonstração.
--   1. Conferência de documento: "Aprovar" e "Reprovar" passam a ser gravados (antes mudavam só a
--      tela). Decide quem aprova documentos no RH (rh.documentos · aprovar), com motivo na reprovação.
--   2. Homologação de módulo: quem homologou, quando e com que resultado fica gravado (antes a aba
--      Homologação era um texto fixo "100% · 8/8 Conforme"). Serve ao RH e, depois, ao Financeiro.
--      Registra quem tem a Homologação do módulo (rh.homologacao · operar).

-- 1. Conferência de documento ------------------------------------------------------------------
alter table public.documents
  add column if not exists review_status text check (review_status is null or review_status in ('aprovado', 'reprovado')),
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text check (review_note is null or length(review_note) <= 500);

create or replace function public.rh_documento_conferir(p_id uuid, p_decisao text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  doc public.documents%rowtype;
begin
  if org is null or not public.has_feature('rh.documentos', 'aprovar') then
    raise exception 'Conferir documento é de quem aprova documentos no RH.' using errcode = '42501';
  end if;
  if p_decisao not in ('aprovado', 'reprovado') then raise exception 'Decisão inválida.'; end if;
  if p_decisao = 'reprovado' and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da reprovação.'; end if;
  select * into doc from public.documents where id = p_id and organization_id = org and module_code = 'rh' for update;
  if doc.id is null then raise exception 'Documento não encontrado.'; end if;
  update public.documents set review_status = p_decisao, reviewed_by = me,
    reviewed_by_name = (select full_name from public.profiles where id = me), reviewed_at = now(),
    review_note = nullif(left(trim(coalesce(p_motivo, '')), 500), '')
  where id = doc.id;
  perform public.emit_module_event(org, 'rh', 'rh.documento.conferido', 'documento', doc.id::text,
    format('Documento %s · %s', case when p_decisao = 'aprovado' then 'aprovado' else 'reprovado' end, doc.title),
    jsonb_build_object('decisao', p_decisao, 'motivo', p_motivo, 'categoria', doc.category));
end;
$$;
revoke all on function public.rh_documento_conferir(uuid, text, text) from public, anon;
grant execute on function public.rh_documento_conferir(uuid, text, text) to authenticated;

-- 2. Homologação de módulo ---------------------------------------------------------------------
create table if not exists public.module_homologations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_code text not null check (module_code ~ '^[a-z]{2,30}$'),
  resultado text not null check (resultado in ('aprovado', 'com_ressalvas', 'reprovado')),
  observacao text check (observacao is null or length(observacao) <= 2000),
  profile_id uuid references public.profiles(id) on delete set null,
  profile_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_module_homologations_org on public.module_homologations (organization_id, module_code, created_at desc);
alter table public.module_homologations enable row level security;
drop policy if exists module_homologations_read on public.module_homologations;
create policy module_homologations_read on public.module_homologations for select to authenticated
using (organization_id = public.current_organization_id() and (public.is_owner() or public.has_feature(module_code || '.homologacao')));
revoke insert, update, delete on public.module_homologations from anon, authenticated;

create or replace function public.modulo_homologacao_registrar(p_modulo text, p_resultado text, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  v_id uuid;
begin
  if org is null or p_modulo !~ '^[a-z]{2,30}$' or not public.has_feature(p_modulo || '.homologacao', 'operar') then
    raise exception 'Registrar a homologação é de quem tem a Homologação do módulo.' using errcode = '42501';
  end if;
  if p_resultado not in ('aprovado', 'com_ressalvas', 'reprovado') then raise exception 'Resultado inválido.'; end if;
  if p_resultado <> 'aprovado' and coalesce(trim(p_observacao), '') = '' then raise exception 'Descreva a ressalva ou o motivo.'; end if;
  insert into public.module_homologations (organization_id, module_code, resultado, observacao, profile_id, profile_name)
  values (org, p_modulo, p_resultado, nullif(left(trim(coalesce(p_observacao, '')), 2000), ''), me, (select full_name from public.profiles where id = me))
  returning id into v_id;
  perform public.emit_module_event(org, p_modulo, p_modulo || '.homologacao.registrada', 'homologacao', v_id::text,
    format('Homologação do módulo registrada · %s', replace(p_resultado, '_', ' ')), jsonb_build_object('resultado', p_resultado));
  return v_id;
end;
$$;
revoke all on function public.modulo_homologacao_registrar(text, text, text) from public, anon;
grant execute on function public.modulo_homologacao_registrar(text, text, text) to authenticated;
