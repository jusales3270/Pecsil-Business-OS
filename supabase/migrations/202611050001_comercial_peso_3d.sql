-- ============================================================================
-- Comercial › Orçamento: peso das peças pelo STEP do cliente (ROADMAP C-19, 05/11/2026)
-- ============================================================================
-- O Rafael desenhava cada peça no SolidWorks só para tirar o peso do orçamento. O cliente já manda o
-- STEP: anexado ao orçamento (tipo novo "desenho_3d"), o medidor 3D (services/medidor-3d, motor do
-- SolidCraft) mede cada corpo e a plataforma calcula o peso acabado e o bruto.
--
-- Regra do bruto (Rafael, 05/11): sobremetal seguindo o contorno da peça, 2 mm no diâmetro e 4 mm no
-- comprimento; só no Fundo e no Platô; nas demais peças só quando o material é Bronze. A regra e as
-- ligas ficam em tabela (o Comercial ajusta), não no código.
--
-- Piloto (Cortez, SolidWorks 2026): Forma 49,39 · Fundo 8,52 · Bloco 31,39 · Platô 1,46 · Funil 1,98 kg
-- acabados, iguais ao SolidWorks dentro do arredondamento.
-- ============================================================================

-- --- Anexo do tipo desenho 3D ------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.sales_quote_attachments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%'
  loop
    execute format('alter table public.sales_quote_attachments drop constraint %I', c);
  end loop;
end $$;
alter table public.sales_quote_attachments add constraint sales_quote_attachments_tipo_check
  check (tipo in ('pedido', 'cotacao', 'outro', 'desenho_3d'));

-- --- Peso no item do orçamento (vai para a cotação e para a OS) ---------------------------------
alter table public.sales_quote_items add column if not exists peso_kg numeric(12,3)
  check (peso_kg is null or (peso_kg >= 0 and peso_kg < 1000000));
comment on column public.sales_quote_items.peso_kg is 'Peso por peça (kg). Vem da medição do STEP (bruto, pela regra do sobremetal) ou é digitado.';

-- --- Ligas (densidade) ---------------------------------------------------------------------------
create table if not exists public.comercial_ligas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  densidade_g_cm3 numeric(6,3) not null check (densidade_g_cm3 > 0 and densidade_g_cm3 <= 30),
  padrao boolean not null default false,
  ativo boolean not null default true,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, nome)
);
create unique index if not exists comercial_ligas_um_padrao on public.comercial_ligas (organization_id) where padrao;

-- --- Sobremetal por tipo de peça (e liga) --------------------------------------------------------
-- liga_id nulo = vale para qualquer liga. A regra da liga específica vence a geral.
create table if not exists public.comercial_sobremetal (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo_peca text not null check (tipo_peca in ('forma', 'bloco', 'fundo', 'plato', 'funil', 'outro')),
  liga_id uuid references public.comercial_ligas(id) on delete cascade,
  mm_diametro numeric(6,2) not null default 0 check (mm_diametro >= 0 and mm_diametro <= 100),
  mm_comprimento numeric(6,2) not null default 0 check (mm_comprimento >= 0 and mm_comprimento <= 100),
  updated_by_name text,
  updated_at timestamptz not null default now()
);
create unique index if not exists comercial_sobremetal_unico
  on public.comercial_sobremetal (organization_id, tipo_peca, coalesce(liga_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- --- Medições ------------------------------------------------------------------------------------
create table if not exists public.comercial_medicoes_3d (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.sales_quotes(id) on delete cascade,
  attachment_id uuid references public.sales_quote_attachments(id) on delete cascade,
  document_id uuid not null references public.company_documents(id) on delete cascade,
  nome_arquivo text,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'medindo', 'pronto', 'erro')),
  erro text,
  tentativas int not null default 0,
  versao_motor text,
  tempo_ms int,
  -- Saída do medidor: um registro por corpo (nome, componente, ocorrências, volume, áreas, eixo, medidas).
  corpos jsonb not null default '[]'::jsonb,
  -- Corpo → caminho da imagem no bucket comercial-medicoes ("montagem" = a montagem inteira).
  imagens jsonb not null default '{}'::jsonb,
  -- O que o Rafael corrigiu: { "<corpo>": { "tipo": "fundo", "liga_id": "…" } }.
  ajustes jsonb not null default '{}'::jsonb,
  liga_id uuid references public.comercial_ligas(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  medido_em timestamptz
);
create index if not exists comercial_medicoes_3d_quote on public.comercial_medicoes_3d (quote_id, created_at desc);
create index if not exists comercial_medicoes_3d_fila on public.comercial_medicoes_3d (situacao) where situacao in ('pendente', 'medindo');

-- --- Documentos: o STEP de montagem passa de 10 MB (o do piloto tinha 9 MB). 50 MB = teto do armazenamento.
update storage.buckets set file_size_limit = 52428800 where id = 'empresa-documentos' and coalesce(file_size_limit, 0) < 52428800;

-- --- Imagens (privado; sobe e desce só pelo servidor) -------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('comercial-medicoes', 'comercial-medicoes', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- --- RLS -----------------------------------------------------------------------------------------
alter table public.comercial_ligas enable row level security;
alter table public.comercial_sobremetal enable row level security;
alter table public.comercial_medicoes_3d enable row level security;

drop policy if exists comercial_ligas_read on public.comercial_ligas;
create policy comercial_ligas_read on public.comercial_ligas for select
  using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists comercial_ligas_write on public.comercial_ligas;
create policy comercial_ligas_write on public.comercial_ligas for all
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')));

drop policy if exists comercial_sobremetal_read on public.comercial_sobremetal;
create policy comercial_sobremetal_read on public.comercial_sobremetal for select
  using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists comercial_sobremetal_write on public.comercial_sobremetal;
create policy comercial_sobremetal_write on public.comercial_sobremetal for all
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar'))
    and (liga_id is null or exists (select 1 from public.comercial_ligas l where l.id = liga_id and l.organization_id = comercial_sobremetal.organization_id)));

-- Medição: quem vê o orçamento vê; quem opera cria e ajusta (tipo e liga). O resultado do medidor é gravado
-- pelo servidor com a chave de serviço.
drop policy if exists comercial_medicoes_3d_read on public.comercial_medicoes_3d;
create policy comercial_medicoes_3d_read on public.comercial_medicoes_3d for select
  using (organization_id = (select public.current_organization_id()) and (select public.orcamentos_pode_ver()));
drop policy if exists comercial_medicoes_3d_insert on public.comercial_medicoes_3d;
create policy comercial_medicoes_3d_insert on public.comercial_medicoes_3d for insert
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar'))
    and exists (select 1 from public.sales_quotes q where q.id = quote_id and q.organization_id = comercial_medicoes_3d.organization_id));
drop policy if exists comercial_medicoes_3d_update on public.comercial_medicoes_3d;
create policy comercial_medicoes_3d_update on public.comercial_medicoes_3d for update
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('comercial.orcamentos', 'operar')));

-- --- Sementes: ligas e a regra do Rafael ---------------------------------------------------------
insert into public.comercial_ligas (organization_id, nome, densidade_g_cm3, padrao)
select o.id, l.nome, l.dens, l.padrao
from public.organizations o
cross join (values ('Ferro fundido', 7.200, true), ('Bronze', 8.800, false)) as l(nome, dens, padrao)
on conflict (organization_id, nome) do nothing;

-- Fundo e Platô: sempre (qualquer liga). Forma, Bloco e Funil: só em Bronze.
insert into public.comercial_sobremetal (organization_id, tipo_peca, liga_id, mm_diametro, mm_comprimento)
select o.id, t.tipo, null, 2, 4
from public.organizations o cross join (values ('fundo'), ('plato')) as t(tipo)
on conflict do nothing;
insert into public.comercial_sobremetal (organization_id, tipo_peca, liga_id, mm_diametro, mm_comprimento)
select l.organization_id, t.tipo, l.id, 2, 4
from public.comercial_ligas l cross join (values ('forma'), ('bloco'), ('funil')) as t(tipo)
where l.nome = 'Bronze'
on conflict do nothing;
