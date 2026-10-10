-- Segundo Cérebro, Etapa 1 (10/10/2026): guarda de documentos por setor.
--
-- Cada documento pertence a um setor (module_code) e é protegido por uma funcionalidade
-- que já existe (feature_code): quem vê aquela tela vê o documento. O arquivo passa
-- SEMPRE pelo servidor: a rota confere a permissão, guarda no bucket privado com a
-- chave mestra e registra aqui com a sessão da pessoa. O bucket não tem política para
-- usuários: ninguém lê arquivo direto pelo cliente; o download é por link de 60 s gerado
-- no servidor depois de conferir que a pessoa vê o documento.
--
-- Decisão D3 do proprietário (10/10/2026): o original fica guardado mesmo depois que a
-- plataforma extrai os dados (extrato, nota). O RH continua na guarda dele (rh-documents).

insert into storage.buckets (id, name, public, file_size_limit)
values ('empresa-documentos', 'empresa-documentos', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

create table if not exists public.company_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_code text not null check (module_code ~ '^[a-z]+$'),
  feature_code text not null check (feature_code ~ '^[a-z]+\.[a-z_]+$'),
  title text not null check (length(trim(title)) between 1 and 200),
  category text check (category is null or length(category) <= 60),
  original_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  version integer not null default 1 check (version >= 1),
  previous_id uuid references public.company_documents(id) on delete set null,
  superseded_by uuid references public.company_documents(id) on delete set null,
  source text not null default 'envio' check (source in ('envio', 'extrato', 'nota', 'recebimento', 'coleta')),
  file_intake_id uuid references public.file_intakes(id) on delete set null,
  entity_type text,
  entity_id text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, storage_path),
  check (feature_code like module_code || '.%')
);
create index if not exists idx_company_documents_lista on public.company_documents (organization_id, module_code, created_at desc) where superseded_by is null and archived_at is null;
create index if not exists idx_company_documents_hash on public.company_documents (organization_id, sha256);
create index if not exists idx_company_documents_entidade on public.company_documents (organization_id, entity_type, entity_id) where entity_type is not null;

alter table public.company_documents enable row level security;
drop policy if exists company_documents_read on public.company_documents;
create policy company_documents_read on public.company_documents for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and ((select public.is_owner()) or public.has_feature(feature_code))
);
grant select on public.company_documents to authenticated;

alter table public.file_intakes add column if not exists document_id uuid references public.company_documents(id) on delete set null;

-- Registra um documento já guardado no bucket. Mesmo arquivo (sha256) ativo no mesmo setor
-- não duplica: devolve o existente (e a rota apaga o que acabou de subir).
create or replace function public.company_document_register(
  p_module text, p_feature text, p_title text, p_category text, p_original_name text, p_mime text,
  p_size bigint, p_sha256 text, p_storage_path text, p_source text,
  p_intake uuid default null, p_entity_type text default null, p_entity_id text default null, p_previous uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  anterior public.company_documents%rowtype;
  existente uuid;
  novo uuid;
  versao int := 1;
begin
  if org is null or not (public.is_owner() or public.has_feature(p_feature, 'operar')) then
    raise exception 'Sem permissão para guardar documentos deste setor.' using errcode = '42501';
  end if;
  if p_feature not like p_module || '.%' then raise exception 'Funcionalidade não pertence ao setor.'; end if;
  if p_storage_path not like org::text || '/' || p_module || '/%' then raise exception 'Caminho do arquivo inválido.'; end if;

  if p_previous is not null then
    select * into anterior from public.company_documents where id = p_previous and organization_id = org for update;
    if anterior.id is null then raise exception 'Documento anterior não encontrado.'; end if;
    if anterior.superseded_by is not null then raise exception 'Esta versão já foi substituída; envie sobre a mais recente.'; end if;
    if anterior.module_code <> p_module then raise exception 'A nova versão precisa ser do mesmo setor.'; end if;
    versao := anterior.version + 1;
  else
    select id into existente from public.company_documents
     where organization_id = org and module_code = p_module and sha256 = lower(p_sha256) and superseded_by is null and archived_at is null
     limit 1;
    if existente is not null then
      if p_intake is not null then
        update public.file_intakes set document_id = existente where id = p_intake and organization_id = org and document_id is null;
      end if;
      return jsonb_build_object('id', existente, 'existente', true);
    end if;
  end if;

  insert into public.company_documents (organization_id, module_code, feature_code, title, category, original_name, mime_type, size_bytes,
    sha256, storage_path, version, previous_id, source, file_intake_id, entity_type, entity_id, uploaded_by, uploaded_by_name)
  values (org, p_module, p_feature, left(coalesce(nullif(trim(p_title), ''), p_original_name), 200), nullif(left(trim(coalesce(p_category, '')), 60), ''),
    left(p_original_name, 255), p_mime, p_size, lower(p_sha256), p_storage_path, versao, p_previous, coalesce(p_source, 'envio'), p_intake,
    p_entity_type, p_entity_id, me, (select full_name from public.profiles where id = me))
  returning id into novo;

  if p_previous is not null then update public.company_documents set superseded_by = novo where id = p_previous; end if;
  if p_intake is not null then update public.file_intakes set document_id = novo where id = p_intake and organization_id = org; end if;

  perform public.emit_module_event(org, 'fundacao', 'fundacao.documento.enviado', 'documento', novo::text,
    format('Documento guardado em %s: %s%s', p_module, left(p_original_name, 120), case when versao > 1 then format(' (versão %s)', versao) else '' end),
    jsonb_build_object('setor', p_module, 'origem', coalesce(p_source, 'envio'), 'versao', versao, 'tamanho', p_size));
  return jsonb_build_object('id', novo, 'existente', false, 'versao', versao);
end;
$$;
revoke all on function public.company_document_register(text, text, text, text, text, text, bigint, text, text, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.company_document_register(text, text, text, text, text, text, bigint, text, text, text, uuid, text, text, uuid) to authenticated;

-- Arquivar (some da lista; o arquivo e o histórico ficam).
create or replace function public.company_document_archive(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  doc public.company_documents%rowtype;
begin
  select * into doc from public.company_documents where id = p_id and organization_id = org for update;
  if doc.id is null then raise exception 'Documento não encontrado.'; end if;
  if not (public.is_owner() or public.has_feature(doc.feature_code, 'operar')) then
    raise exception 'Sem permissão para arquivar documentos deste setor.' using errcode = '42501';
  end if;
  update public.company_documents set archived_at = now() where id = doc.id and archived_at is null;
end;
$$;
revoke all on function public.company_document_archive(uuid) from public, anon;
grant execute on function public.company_document_archive(uuid) to authenticated;
