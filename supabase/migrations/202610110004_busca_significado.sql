-- Segundo Cérebro, Etapa 5, Entrega B (11/10/2026): busca por SIGNIFICADO, local (D5).
--
-- Cada documento lido é dividido em trechos; cada trecho vira um vetor de significado (384
-- números, modelo multilingual-e5-small rodando no servidor da PecSil — nenhum texto sai da
-- empresa). A busca transforma a pergunta em vetor e acha os trechos mais próximos: "fornalha"
-- acha "fornos", "conta de luz" acha "energia elétrica".
-- Os trechos têm a mesma proteção do texto: só quem vê o documento. Só o servidor grava.

create extension if not exists vector with schema extensions;

create table if not exists public.company_document_chunks (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.company_documents(id) on delete cascade,
  ordem integer not null check (ordem >= 0),
  content text not null check (length(content) between 1 and 1200),
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now(),
  unique (document_id, ordem)
);
create index if not exists idx_company_document_chunks_vetor on public.company_document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists idx_company_document_chunks_doc on public.company_document_chunks (document_id);

alter table public.company_document_chunks enable row level security;
drop policy if exists company_document_chunks_read on public.company_document_chunks;
create policy company_document_chunks_read on public.company_document_chunks for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and exists (
    select 1 from public.company_documents d
     where d.id = document_id and ((select public.is_owner()) or public.has_feature(d.feature_code))
  )
);
revoke all on public.company_document_chunks from anon, authenticated;
grant select on public.company_document_chunks to authenticated;

-- Quando os trechos de cada texto foram gerados (refaz quando o texto é relido).
alter table public.company_document_texts add column if not exists embedded_at timestamptz;

-- A busca por significado, com as permissões de quem pesquisa (o RLS de documentos e trechos vale).
-- Recebe o vetor da pergunta como texto "[0.1,…]"; devolve o melhor trecho de cada documento.
create or replace function public.company_document_semantic(p_vetor text, p_setor text default null, p_limite integer default 20)
returns table (id uuid, title text, original_name text, module_code text, created_at timestamptz, trecho text, similaridade real)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with perto as (
    select c.document_id, c.content, (c.embedding <=> p_vetor::extensions.vector(384)) as distancia
      from public.company_document_chunks c
     order by c.embedding <=> p_vetor::extensions.vector(384)
     limit 200
  ),
  melhor as (
    select distinct on (p.document_id) p.document_id, p.content, p.distancia
      from perto p
     order by p.document_id, p.distancia
  )
  select d.id, d.title, d.original_name, d.module_code, d.created_at, left(m.content, 220), (1 - m.distancia)::real
    from melhor m
    join public.company_documents d on d.id = m.document_id
   where d.archived_at is null and d.superseded_by is null
     and (p_setor is null or p_setor = '' or d.module_code = p_setor)
   order by m.distancia
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;
revoke all on function public.company_document_semantic(text, text, integer) from public, anon;
grant execute on function public.company_document_semantic(text, text, integer) to authenticated, service_role;
