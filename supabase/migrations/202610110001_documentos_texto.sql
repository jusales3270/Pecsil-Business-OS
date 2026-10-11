-- Segundo Cérebro, Etapa 3 (10–11/10/2026): o texto de cada documento guardado.
--
-- O dono decidiu ler antes de ligar: o texto lido de cada documento fica aqui, e é a base das
-- ligações (Etapa 4) e da busca (Etapa 5). Decisão D4: o OCR (escaneado e foto) roda NO
-- SERVIDOR da PecSil; nenhum documento sai da empresa.
--
-- Quem lê o texto: só quem vê o documento (a mesma regra de company_documents). Quem grava:
-- só o servidor, com a chave de serviço — o texto é sempre relido a partir do original, nunca
-- aceito do navegador.

create table if not exists public.company_document_texts (
  document_id uuid primary key references public.company_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null check (status in ('lido', 'sem_texto', 'pendente_ocr', 'erro')),
  method text check (method is null or method in ('pdf', 'docx', 'xlsx', 'xls', 'xml', 'ofx', 'txt', 'ocr')),
  content text check (content is null or length(content) <= 200000),
  pages integer check (pages is null or pages >= 0),
  chars integer check (chars is null or chars >= 0),
  error text check (error is null or length(error) <= 300),
  attempts integer not null default 0,
  read_at timestamptz not null default now()
);
create index if not exists idx_company_document_texts_fila on public.company_document_texts (organization_id, status) where status in ('pendente_ocr', 'erro');

alter table public.company_document_texts enable row level security;
drop policy if exists company_document_texts_read on public.company_document_texts;
create policy company_document_texts_read on public.company_document_texts for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and exists (
    select 1 from public.company_documents d
     where d.id = document_id and ((select public.is_owner()) or public.has_feature(d.feature_code))
  )
);
revoke all on public.company_document_texts from anon, authenticated;
grant select on public.company_document_texts to authenticated;

-- Fila de leitura (só para o servidor): documentos ainda sem leitura e os que esperam o OCR ou
-- falharam (até 3 tentativas). Os sem leitura primeiro (inclui os guardados antes desta etapa).
create or replace function public.company_document_texts_pendentes(p_limite integer default 10)
returns table (id uuid, organization_id uuid, storage_path text, original_name text, status text, attempts integer)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.organization_id, d.storage_path, d.original_name, t.status, coalesce(t.attempts, 0)
    from public.company_documents d
    left join public.company_document_texts t on t.document_id = d.id
   where d.archived_at is null
     and (t.document_id is null or (t.status in ('pendente_ocr', 'erro') and t.attempts < 3))
   order by (t.document_id is null) desc, d.created_at
   limit least(greatest(coalesce(p_limite, 10), 1), 50);
$$;
revoke all on function public.company_document_texts_pendentes(integer) from public, anon, authenticated;
grant execute on function public.company_document_texts_pendentes(integer) to service_role;
