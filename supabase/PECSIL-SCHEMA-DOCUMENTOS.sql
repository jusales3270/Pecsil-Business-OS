-- ============================================================================
-- PecSil Business OS — Documentos do RH (aplicar sobre a base já existente)
--
-- Acrescenta employee_id e signature_status à tabela documents, cria o bucket
-- privado rh-documents e suas políticas de RLS no Storage.
-- Studio → SQL Editor → New query → cole tudo → Run. Idempotente.
-- ============================================================================

-- ============================================================================
-- Pecsil Business OS — Documentos do RH (reuso da Fundação + Storage)
--
-- Segue o princípio do Blueprint: documentos são um SERVIÇO DA FUNDAÇÃO; o RH
-- não cria tabela própria. Os documentos de RH vivem em public.documents com
-- module_code = 'rh' e storage_bucket = 'rh-documents'. Esta migration só
-- acrescenta o vínculo com o colaborador e o estado de assinatura, e provisiona
-- o bucket privado de Storage com RLS.
-- ============================================================================

-- --- Vínculo e assinatura ---------------------------------------------------
alter table public.documents
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

alter table public.documents
  add column if not exists signature_status text
    check (signature_status in ('signed', 'pending', 'not_required'));

create index if not exists idx_documents_employee
  on public.documents(organization_id, employee_id);

-- --- Bucket privado de Storage ----------------------------------------------
-- Arquivos de RH nunca são públicos. O acesso é sempre por URL assinada, gerada
-- para quem tem permissão. Caminho convencional: {organization_id}/{doc_id}/{arquivo}
insert into storage.buckets (id, name, public)
values ('rh-documents', 'rh-documents', false)
on conflict (id) do nothing;

-- --- RLS do Storage ---------------------------------------------------------
-- O primeiro segmento do caminho é a organização; combina isolamento por org
-- com a permissão core.documents, igual à tabela de metadados.
drop policy if exists rh_docs_objects_read on storage.objects;
drop policy if exists rh_docs_objects_insert on storage.objects;
drop policy if exists rh_docs_objects_update on storage.objects;
drop policy if exists rh_docs_objects_delete on storage.objects;

create policy rh_docs_objects_read on storage.objects for select to authenticated
using (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_permission('core.documents', 'view')
);

create policy rh_docs_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_permission('core.documents', 'edit')
);

create policy rh_docs_objects_update on storage.objects for update to authenticated
using (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_permission('core.documents', 'edit')
)
with check (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_permission('core.documents', 'edit')
);

create policy rh_docs_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'rh-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.has_permission('core.documents', 'edit')
);

comment on column public.documents.employee_id is 'Colaborador vinculado ao documento (RH); nulo para documentos corporativos.';
comment on column public.documents.signature_status is 'Estado de assinatura do documento, quando aplicável.';

do $$ begin raise notice 'Documentos do RH prontos: coluna employee_id, bucket rh-documents e RLS.'; end $$;
