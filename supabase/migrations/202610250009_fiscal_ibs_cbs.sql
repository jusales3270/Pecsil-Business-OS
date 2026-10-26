-- ============================================================================
-- IBS e CBS (Contábil-Fiscal, N-03): as notas lidas para a apuração informativa de 2026
-- (25/10/2026, pedido do proprietário; PLANO-CONTABIL-FISCAL §2.4 e N-03)
-- ============================================================================
-- Em 2026 a CBS (0,9%) e o IBS (0,1%) só são destacados: o recolhimento é dispensado para quem cumpre as
-- obrigações acessórias (LC 214/2025 art. 348). A apuração é informativa: saída gera débito, entrada gera
-- crédito (não-cumulatividade ampla, art. 47). Cada XML de NF-e guardado na plataforma (Fiscal › Enviar
-- arquivos, recebimento do Almoxarifado, notas da SEFAZ, NF-e emitida em produção) é lido UMA vez e fica aqui,
-- ligado ao documento. Só o servidor escreve; lê quem vê o Fiscal.
-- ============================================================================

create table if not exists public.fiscal_ibscbs_notas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid references public.company_documents(id) on delete cascade,
  nfe_id uuid references public.fiscal_nfe(id) on delete cascade,
  chave text check (chave is null or chave ~ '^[0-9]{44}$'),
  numero text,
  lado text not null check (lado in ('entrada', 'saida', 'outra')),
  finalidade text,
  emissao timestamptz,
  competencia text check (competencia is null or competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  emitente_cnpj text,
  emitente_nome text,
  destinatario_cnpj text,
  tem_grupo boolean not null,
  v_bc numeric(15,2) not null default 0,
  v_ibs_uf numeric(15,2) not null default 0,
  v_ibs_mun numeric(15,2) not null default 0,
  v_ibs numeric(15,2) not null default 0,
  v_cbs numeric(15,2) not null default 0,
  v_nf numeric(15,2) not null default 0,
  itens jsonb not null default '[]'::jsonb,
  lido_em timestamptz not null default now(),
  constraint fiscal_ibscbs_notas_origem check (document_id is not null or nfe_id is not null)
);
create unique index if not exists fiscal_ibscbs_notas_documento on public.fiscal_ibscbs_notas (document_id) where document_id is not null;
create unique index if not exists fiscal_ibscbs_notas_nfe on public.fiscal_ibscbs_notas (nfe_id) where nfe_id is not null;
create index if not exists fiscal_ibscbs_notas_competencia on public.fiscal_ibscbs_notas (organization_id, competencia);
comment on table public.fiscal_ibscbs_notas is 'IBS e CBS lidos de cada NF-e guardada (N-03): base, IBS da UF e do município, CBS e os itens com CST e cClassTrib. Uma linha por documento; a apuração informativa de 2026 soma daqui.';

create or replace function public.fiscal_ibscbs_pode_ver() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.icms', 'ver') or public.has_feature('fiscal.config', 'ver') or public.has_feature('fiscal.parametros', 'ver')
    or public.has_feature('fiscal.nfe', 'ver') or public.has_feature('fiscal.escritorio', 'ver') or public.has_feature('fiscal.portal', 'operar');
$$;
revoke all on function public.fiscal_ibscbs_pode_ver() from public, anon;
grant execute on function public.fiscal_ibscbs_pode_ver() to authenticated;

alter table public.fiscal_ibscbs_notas enable row level security;
drop policy if exists fiscal_ibscbs_notas_read on public.fiscal_ibscbs_notas;
create policy fiscal_ibscbs_notas_read on public.fiscal_ibscbs_notas for select to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.fiscal_ibscbs_pode_ver()));
revoke all on public.fiscal_ibscbs_notas from anon;
revoke insert, update, delete on public.fiscal_ibscbs_notas from authenticated;
grant select on public.fiscal_ibscbs_notas to authenticated;
