-- ============================================================================
-- Comercial (CRM): anexos dos e-mails (ROADMAP C-15, 16/11/2026)
-- ============================================================================
-- Decisão do proprietário (16/11/2026): a plataforma lê os e-mails por inteiro, com os anexos, nas duas
-- caixas (comercial@ e a do diretor de operações) — é nos anexos que chegam os desenhos dos pedidos
-- (PDF, DWG, STEP) para fazer o orçamento. A caixa do diretor deixa de entrar só com remetente, assunto
-- e data; o modo 'remetentes_conhecidos' segue existindo como opção, mas não é mais o caminho dela.
--
-- O arquivo vai para Documentos › Comercial pelo caminho central (origem nova "email"): o mesmo
-- desenho mandado duas vezes não duplica, e ligar ao orçamento é só apontar para o documento. Aqui fica
-- a ligação anexo ↔ mensagem, com o motivo quando o anexo não é guardado (link do OneDrive, e-mail
-- anexado, logotipo da assinatura, acima de 50 MB).
-- ============================================================================

-- --- Origem "email" nos documentos -----------------------------------------
alter table public.company_documents drop constraint if exists company_documents_source_check;
alter table public.company_documents add constraint company_documents_source_check
  check (source in ('envio', 'extrato', 'nota', 'recebimento', 'coleta', 'sefaz', 'emissao', 'escritorio', 'email'));

-- Igual à de 202610270005, com "email" entre as origens do sistema.
create or replace function public.company_document_register_sistema(p_org uuid, p_module text, p_feature text, p_title text, p_original_name text, p_mime text, p_size bigint, p_sha256 text, p_storage_path text, p_source text, p_autor text, p_entity_type text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  existente uuid;
  novo uuid;
begin
  if p_org is null or not exists (select 1 from public.organizations where id = p_org) then raise exception 'Organização inválida.'; end if;
  if p_source not in ('sefaz', 'emissao', 'escritorio', 'email') then raise exception 'Origem não permitida para o sistema.'; end if;
  if p_feature not like p_module || '.%' then raise exception 'Funcionalidade não pertence ao setor.'; end if;
  if p_storage_path not like p_org::text || '/' || p_module || '/%' then raise exception 'Caminho do arquivo inválido.'; end if;

  select id into existente from public.company_documents
   where organization_id = p_org and module_code = p_module and sha256 = lower(p_sha256) and superseded_by is null and archived_at is null
   limit 1;
  if existente is not null then return jsonb_build_object('id', existente, 'existente', true); end if;

  insert into public.company_documents (organization_id, module_code, feature_code, title, original_name, mime_type, size_bytes,
    sha256, storage_path, version, source, entity_type, entity_id, uploaded_by, uploaded_by_name)
  values (p_org, p_module, p_feature, left(coalesce(nullif(trim(p_title), ''), p_original_name), 200), left(p_original_name, 255), p_mime, p_size,
    lower(p_sha256), p_storage_path, 1, p_source, p_entity_type, p_entity_id, null, left(coalesce(p_autor, 'Sistema'), 120))
  returning id into novo;

  perform public.emit_module_event(p_org, 'fundacao', 'fundacao.documento.enviado', 'documento', novo::text,
    format('Documento guardado em %s: %s', p_module, left(p_original_name, 120)),
    jsonb_build_object('setor', p_module, 'origem', p_source, 'versao', 1, 'tamanho', p_size));
  return jsonb_build_object('id', novo, 'existente', false, 'versao', 1);
end;
$function$;

-- --- Situação dos anexos de cada mensagem -----------------------------------
-- Nulo em attachments_synced_at = anexos ainda por baixar. A rodada conta a tentativa antes do trabalho
-- (duas rodadas ao mesmo tempo não pegam a mesma mensagem) e desiste na terceira, com o erro guardado.
alter table public.mail_messages add column if not exists attachments_synced_at timestamptz;
alter table public.mail_messages add column if not exists attachments_tries smallint not null default 0;
alter table public.mail_messages add column if not exists attachments_error text;
alter table public.mail_messages drop constraint if exists mail_messages_attachments_error_tamanho;
alter table public.mail_messages add constraint mail_messages_attachments_error_tamanho
  check (attachments_error is null or length(attachments_error) <= 500);

create index if not exists idx_mail_messages_anexos_pendentes on public.mail_messages(account_id, received_at desc)
  where has_attachments and attachments_synced_at is null;

-- --- Anexos ------------------------------------------------------------------
create table if not exists public.mail_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  graph_attachment_id text not null,
  name text not null check (length(name) between 1 and 255),
  content_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  inline boolean not null default false,
  -- 'arquivo' = arquivo de verdade; 'mensagem' = e-mail anexado; 'link' = link do OneDrive/SharePoint.
  especie text not null check (especie in ('arquivo', 'mensagem', 'link')),
  -- O arquivo guardado em Documentos › Comercial; nulo quando não foi guardado (o motivo diz por quê).
  document_id uuid references public.company_documents(id) on delete set null,
  motivo text check (motivo is null or length(motivo) <= 200),
  created_at timestamptz not null default now(),
  unique (message_id, graph_attachment_id)
);

comment on table public.mail_attachments is 'Anexos dos e-mails do Comercial: o arquivo fica em Documentos › Comercial (document_id); o que não é guardado traz o motivo. Gravação só pela sincronização (chave de serviço). ROADMAP C-15.';

create index if not exists idx_mail_attachments_mensagem on public.mail_attachments(message_id);
create index if not exists idx_mail_attachments_documento on public.mail_attachments(document_id) where document_id is not null;

-- Ler é de quem lê a caixa de entrada; gravar é só da sincronização.
alter table public.mail_attachments enable row level security;
drop policy if exists mail_attachments_read on public.mail_attachments;
create policy mail_attachments_read on public.mail_attachments for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.caixa')));
revoke all on public.mail_attachments from anon;
revoke insert, update, delete on public.mail_attachments from authenticated;
grant select on public.mail_attachments to authenticated;
