-- Segundo Cérebro, Etapa 5, Entrega A (11/10/2026): buscar DENTRO dos documentos, por palavras.
--
-- D5 do proprietário: a busca roda local, no servidor da PecSil. Esta entrega usa só o próprio
-- banco: acha variações ("fornos" → "forno"), ignora acentos ("manutencao" → "manutenção"),
-- aceita "frase entre aspas" e -excluir, e tolera erro de digitação ("fornesedor").
-- A busca roda com as permissões de quem pesquisa (SECURITY INVOKER): o RLS de documentos e de
-- textos decide, então cada pessoa só acha — e só vê o trecho de — o que pode abrir.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Português sem acento: o mesmo radical para "manutenção" e "manutencao".
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'portugues_sem_acento' and cfgnamespace = 'public'::regnamespace) then
    create text search configuration public.portugues_sem_acento (copy = pg_catalog.portuguese);
    alter text search configuration public.portugues_sem_acento
      alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;
  end if;
end $$;

-- Sem acento e em minúsculas, imutável (o unaccent puro não pode ir em índice).
create or replace function public.sem_acento(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))) $$;

alter table public.company_document_texts add column if not exists busca tsvector;

-- O que se busca de cada documento: título e nome do arquivo (peso maior) e o texto lido.
create or replace function public.company_document_texts_busca()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d public.company_documents%rowtype;
begin
  select * into d from public.company_documents where id = new.document_id;
  new.busca := setweight(to_tsvector('public.portugues_sem_acento', coalesce(d.title, '') || ' ' || coalesce(d.original_name, '')), 'A')
            || setweight(to_tsvector('public.portugues_sem_acento', coalesce(new.content, '')), 'B');
  return new;
end;
$$;
drop trigger if exists company_document_texts_busca on public.company_document_texts;
create trigger company_document_texts_busca before insert or update of content on public.company_document_texts
for each row execute function public.company_document_texts_busca();

update public.company_document_texts set content = content where busca is null;

create index if not exists idx_company_document_texts_busca on public.company_document_texts using gin (busca);
create index if not exists idx_company_document_texts_trgm on public.company_document_texts using gin (public.sem_acento(content) extensions.gin_trgm_ops);
create index if not exists idx_company_documents_nome_trgm on public.company_documents using gin (public.sem_acento(title || ' ' || original_name) extensions.gin_trgm_ops);

-- A busca. Casa por palavra (radical, sem acento, aspas, -excluir) e pelo nome do arquivo. Só
-- quando nada casa — e a busca é simples, sem aspas nem exclusão — entram as PARECIDAS (erro de
-- digitação: "fornesedor" → "fornecedor"), pela semelhança estrita de trigramas (limiar 0,5),
-- que não confunde "forno" com "fornecedor". O trecho vem marcado com [[ ]]: a tela destaca sem HTML.
create or replace function public.company_document_search(p_q text, p_setor text default null, p_limite integer default 30)
returns table (id uuid, title text, original_name text, module_code text, created_at timestamptz, trecho text, rank real, como text)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  q text := left(trim(coalesce(p_q, '')), 200);
  consulta tsquery;
  qn text;
  simples boolean;
  tem_palavra boolean;
begin
  if length(q) < 2 then return; end if;
  consulta := websearch_to_tsquery('public.portugues_sem_acento', q);
  qn := public.sem_acento(q);
  simples := q !~* '"|(^|\s)-\S|\sor\s';
  select exists (
    select 1 from public.company_documents d left join public.company_document_texts t on t.document_id = d.id
     where d.archived_at is null and d.superseded_by is null
       and (p_setor is null or p_setor = '' or d.module_code = p_setor)
       and (coalesce(t.busca @@ consulta, false) or public.sem_acento(d.title || ' ' || d.original_name) like '%' || qn || '%')
  ) into tem_palavra;
  return query
  with achados as (
    select d.id, d.title, d.original_name, d.module_code, d.created_at, t.content,
           (coalesce(t.busca @@ consulta, false) or public.sem_acento(d.title || ' ' || d.original_name) like '%' || qn || '%') as por_palavra,
           coalesce(t.busca @@ consulta, false) as no_texto,
           coalesce(ts_rank(t.busca, consulta), 0)::real as r_fts,
           greatest(strict_word_similarity(qn, public.sem_acento(d.title || ' ' || d.original_name)),
                    strict_word_similarity(qn, public.sem_acento(t.content)))::real as r_sim
      from public.company_documents d
      left join public.company_document_texts t on t.document_id = d.id
     where d.archived_at is null and d.superseded_by is null
       and (p_setor is null or p_setor = '' or d.module_code = p_setor)
       and (
         coalesce(t.busca @@ consulta, false)
         or public.sem_acento(d.title || ' ' || d.original_name) like '%' || qn || '%'
         or (not tem_palavra and simples and (qn <<% public.sem_acento(d.title || ' ' || d.original_name) or qn <<% public.sem_acento(t.content)))
       )
     order by por_palavra desc, r_fts desc, r_sim desc, d.created_at desc
     limit least(greatest(coalesce(p_limite, 30), 1), 50)
  )
  select a.id, a.title, a.original_name, a.module_code, a.created_at,
         case when a.content is null or a.content = '' then null
              when a.no_texto then ts_headline('public.portugues_sem_acento', a.content, consulta,
                     'StartSel=[[, StopSel=]], MaxFragments=2, MaxWords=18, MinWords=6, FragmentDelimiter=" … "')
              else left(regexp_replace(a.content, '\s+', ' ', 'g'), 160) end,
         (case when a.por_palavra then 1 else 0 end + a.r_fts + a.r_sim)::real,
         case when a.por_palavra then 'palavras' else 'parecido' end
    from achados a
   order by a.por_palavra desc, a.r_fts desc, a.r_sim desc, a.created_at desc;
end;
$$;
revoke all on function public.company_document_search(text, text, integer) from public, anon;
grant execute on function public.company_document_search(text, text, integer) to authenticated, service_role;
