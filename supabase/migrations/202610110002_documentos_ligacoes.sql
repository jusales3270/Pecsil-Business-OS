-- Segundo Cérebro, Etapa 4 (11/10/2026): ligações por regra — cada documento ligado ao que já
-- existe no banco, sem IA.
--
-- Exatas (aparecem direto): chave de acesso → nota (Painel do ICMS / recebimento); CNPJ + nº da
-- NF → nota; CNPJ → fornecedor/cliente (menos o CNPJ da própria PecSil); a origem do documento
-- (nota ou recebimento de onde veio); e, pela nota encontrada, o fornecedor, a cotação e o título.
-- Prováveis (a confirmar): cotação/OC e OS citadas por número com prefixo — o fornecedor tem
-- numeração própria, então número nunca é tratado como exato.
--
-- Ninguém vê ligação para algo que não pode abrir: a ligação só aparece para quem vê o documento
-- E o alvo. Quem grava é só o servidor; a pessoa confirma ou descarta (descartada não volta).

-- Quem abre cada tipo de alvo.
create or replace function public.ligacao_visivel(p_tipo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_owner() or case p_tipo
    when 'fornecedor' then public.has_feature('compras.fornecedores') or public.has_feature('fundacao.cadastros')
    when 'cliente' then public.has_feature('comercial.clientes') or public.has_feature('fundacao.cadastros')
    when 'nota_icms' then public.has_feature('fiscal.icms')
    when 'recebimento' then public.has_feature('almoxarifado.recebimento')
    when 'titulo' then public.has_feature('financeiro.pagar') or public.has_feature('financeiro.receber')
    when 'cotacao' then public.has_feature('compras.cotacoes') or public.has_feature('compras.aprovacoes')
    when 'os' then public.has_feature('producao.os')
    else false
  end;
$$;
revoke all on function public.ligacao_visivel(text) from public, anon;
grant execute on function public.ligacao_visivel(text) to authenticated;

create table if not exists public.company_document_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.company_documents(id) on delete cascade,
  target_type text not null check (target_type in ('fornecedor', 'cliente', 'nota_icms', 'recebimento', 'titulo', 'cotacao', 'os')),
  target_id text not null check (length(target_id) between 1 and 80),
  target_label text check (target_label is null or length(target_label) <= 200),
  rule text not null check (rule in ('origem', 'chave_acesso', 'cnpj', 'nf_cnpj', 'pela_nota', 'cotacao', 'os')),
  evidence text check (evidence is null or length(evidence) <= 120),
  confidence text not null check (confidence in ('exata', 'provavel')),
  status text not null default 'ativa' check (status in ('ativa', 'confirmada', 'descartada')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, target_type, target_id)
);
create index if not exists idx_company_document_links_alvo on public.company_document_links (organization_id, target_type, target_id);

alter table public.company_document_links enable row level security;
drop policy if exists company_document_links_read on public.company_document_links;
create policy company_document_links_read on public.company_document_links for select to authenticated using (
  organization_id = (select public.current_organization_id())
  and public.ligacao_visivel(target_type)
  and exists (
    select 1 from public.company_documents d
     where d.id = document_id and ((select public.is_owner()) or public.has_feature(d.feature_code))
  )
);
revoke all on public.company_document_links from anon, authenticated;
grant select on public.company_document_links to authenticated;

alter table public.company_document_texts add column if not exists linked_at timestamptz;

-- Candidatos de ligação de um documento (só o servidor chama, com o que achou no texto).
create or replace function public.company_document_link_candidates(
  p_document uuid, p_cnpjs text[], p_chaves text[], p_nfs text[], p_cotacoes bigint[], p_os text[]
)
returns table (target_type text, target_id text, target_label text, rule text, evidence text, confidence text)
language sql
stable
security definer
set search_path = public
as $$
  with doc as (
    select d.id, d.organization_id as org, d.entity_type, d.entity_id from public.company_documents d where d.id = p_document
  ),
  proprio as (
    select regexp_replace(coalesce(o.tax_id, ''), '\D', '', 'g') as cnpj from public.organizations o join doc on o.id = doc.org
  ),
  cnpjs as (
    select distinct c from unnest(coalesce(p_cnpjs, '{}')) c where c ~ '^\d{14}$' and c <> (select cnpj from proprio)
  ),
  nfs as (select distinct n from unnest(coalesce(p_nfs, '{}')) n),
  -- Notas do Painel do ICMS: pela chave, por CNPJ + nº, ou de onde o documento veio.
  icms as (
    select e.*, 'chave_acesso'::text as regra, e.chave as prova
      from public.fiscal_icms_entries e join doc on e.organization_id = doc.org
     where e.chave = any (coalesce(p_chaves, '{}'))
    union all
    select e.*, 'nf_cnpj', 'NF ' || e.nfe || ' · CNPJ ' || e.cnpj
      from public.fiscal_icms_entries e join doc on e.organization_id = doc.org
     where regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g') in (select c from cnpjs)
       and ltrim(regexp_replace(coalesce(e.nfe, ''), '\D', '', 'g'), '0') in (select n from nfs)
    union all
    select e.*, 'origem', null
      from public.fiscal_icms_entries e join doc on e.organization_id = doc.org
     where doc.entity_type = 'fiscal_icms_entry' and e.id::text = doc.entity_id
  ),
  -- Recebimentos do Almoxarifado: idem.
  rec as (
    select r.*, 'chave_acesso'::text as regra, r.nf_chave as prova
      from public.receipts r join doc on r.organization_id = doc.org
     where r.nf_chave = any (coalesce(p_chaves, '{}'))
    union all
    select r.*, 'nf_cnpj', 'NF ' || r.nf_numero || ' · CNPJ ' || r.cnpj
      from public.receipts r join doc on r.organization_id = doc.org
     where regexp_replace(coalesce(r.cnpj, ''), '\D', '', 'g') in (select c from cnpjs)
       and ltrim(regexp_replace(coalesce(r.nf_numero, ''), '\D', '', 'g'), '0') in (select n from nfs)
    union all
    select r.*, 'origem', null
      from public.receipts r join doc on r.organization_id = doc.org
     where doc.entity_type = 'receipt' and r.id::text = doc.entity_id
  ),
  fornecedor_por_cnpj as (
    select s.id, s.name, regexp_replace(s.tax_id, '\D', '', 'g') as cnpj
      from public.suppliers s join doc on s.organization_id = doc.org
     where s.merged_into is null and s.tax_id is not null
  ),
  todos as (
    -- exatas
    select 'nota_icms'::text as t, i.id::text as id, 'NF ' || coalesce(i.nfe, '?') || coalesce(' · ' || coalesce(i.fantasia, i.fornecedor), '') as rotulo,
           i.regra as regra, i.prova as prova, 'exata'::text as conf from icms i
    union all
    select 'recebimento', r.id::text, 'Recebimento #' || r.numero || coalesce(' · NF ' || r.nf_numero, '') || coalesce(' · ' || r.fornecedor, ''),
           r.regra, r.prova, 'exata' from rec r
    union all
    select 'fornecedor', f.id::text, f.name, 'cnpj', 'CNPJ ' || f.cnpj, 'exata'
      from fornecedor_por_cnpj f where f.cnpj in (select c from cnpjs)
    union all
    select 'cliente', c.id::text, c.name, 'cnpj', 'CNPJ ' || regexp_replace(c.tax_id, '\D', '', 'g'), 'exata'
      from public.customers c join doc on c.organization_id = doc.org
     where c.merged_into is null and c.tax_id is not null and regexp_replace(c.tax_id, '\D', '', 'g') in (select x.c from cnpjs x)
    union all
    -- pela nota encontrada: fornecedor, cotação e título
    select 'fornecedor', coalesce(i.supplier_id::text, f.id::text), coalesce(s.name, f.name), 'pela_nota', 'NF ' || coalesce(i.nfe, '?'), 'exata'
      from icms i
      left join public.suppliers s on s.id = i.supplier_id
      left join fornecedor_por_cnpj f on i.supplier_id is null and f.cnpj = regexp_replace(coalesce(i.cnpj, ''), '\D', '', 'g')
     where coalesce(i.supplier_id::text, f.id::text) is not null
    union all
    select 'fornecedor', coalesce(r.supplier_id::text, f.id::text), coalesce(s.name, f.name), 'pela_nota', 'NF ' || coalesce(r.nf_numero, '?'), 'exata'
      from rec r
      left join public.suppliers s on s.id = r.supplier_id
      left join fornecedor_por_cnpj f on r.supplier_id is null and f.cnpj = regexp_replace(coalesce(r.cnpj, ''), '\D', '', 'g')
     where coalesce(r.supplier_id::text, f.id::text) is not null
    union all
    select 'cotacao', c.id::text, 'Cotação/OC #' || c.id || coalesce(' · ' || c.fornecedor, ''), 'pela_nota', 'NF ' || coalesce(r.nf_numero, '?'), 'exata'
      from rec r join public.cotacoes c on c.id = r.cotacao_id
    union all
    select 'titulo', t.id::text, 'Título ' || coalesce(t.document_number, '') || coalesce(' · ' || t.counterparty_name, ''), 'pela_nota', 'NF ' || coalesce(r.nf_numero, '?'), 'exata'
      from rec r join public.finance_titles t on t.id = r.finance_title_id
    union all
    -- prováveis: número citado com prefixo
    select 'cotacao', c.id::text, 'Cotação/OC #' || c.id || coalesce(' · ' || c.fornecedor, ''), 'cotacao', 'nº ' || c.id, 'provavel'
      from public.cotacoes c join doc on c.organization_id = doc.org
     where c.id = any (coalesce(p_cotacoes, '{}')) and c.deleted_at is null
    union all
    select 'os', p.id::text, 'OS ' || p.code || coalesce(' · ' || p.customer_name, ''), 'os', 'OS ' || p.code, 'provavel'
      from public.production_orders p join doc on p.organization_id = doc.org
     where p.code = any (coalesce(p_os, '{}')) and p.removed_from_source_at is null
  )
  -- Um alvo, uma ligação: fica a mais forte (exata antes de provável; origem e chave antes do resto).
  select distinct on (t, id) t, id, left(rotulo, 200), regra, left(prova, 120), conf
    from todos
   where id is not null
   order by t, id, (conf = 'exata') desc,
            array_position(array['origem', 'chave_acesso', 'nf_cnpj', 'cnpj', 'pela_nota', 'cotacao', 'os'], regra);
$$;
revoke all on function public.company_document_link_candidates(uuid, text[], text[], text[], bigint[], text[]) from public, anon, authenticated;
grant execute on function public.company_document_link_candidates(uuid, text[], text[], text[], bigint[], text[]) to service_role;

-- Confirmar ou descartar uma ligação: quem vê a ligação e opera no setor do documento.
create or replace function public.company_document_link_decide(p_id uuid, p_decisao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  l public.company_document_links%rowtype;
  setor_feature text;
begin
  if p_decisao not in ('confirmada', 'descartada') then raise exception 'Decisão inválida.'; end if;
  select * into l from public.company_document_links where id = p_id and organization_id = org for update;
  if l.id is null then raise exception 'Ligação não encontrada.'; end if;
  select feature_code into setor_feature from public.company_documents where id = l.document_id;
  if not (public.is_owner() or (public.has_feature(setor_feature, 'operar') and public.ligacao_visivel(l.target_type))) then
    raise exception 'Sem permissão para decidir esta ligação.' using errcode = '42501';
  end if;
  update public.company_document_links
     set status = p_decisao, decided_by = public.current_profile_id(),
         decided_by_name = (select full_name from public.profiles where id = public.current_profile_id()), decided_at = now()
   where id = l.id;
end;
$$;
revoke all on function public.company_document_link_decide(uuid, text) from public, anon;
grant execute on function public.company_document_link_decide(uuid, text) to authenticated;
