-- ============================================================================
-- Almoxarifado › Materiais (15/10/2026) — M1 do docs/PLANO-ALMOXARIFADO.md
-- ============================================================================
-- O catálogo de materiais com o código do GRV (2-07-00589, 8-10-00953…): matéria-prima, embalagem,
-- produto intermediário e material de uso e consumo. É a base para pedir, cotar, comprar e receber o
-- mesmo item (M2), para o estoque (M3) e para a lista de materiais da OS na Forja, que busca aqui.
--
-- Regras:
--   · o código não muda depois de criado (é a chave que a Forja e as compras vão guardar);
--   · material novo ganha o código pelo grupo, continuando a numeração do GRV (decisão A6);
--   · não se apaga material: inativa (some da busca do dia a dia, o histórico continua);
--   · lê quem pede, compra, recebe ou entrega EPI; cadastra o Almoxarifado e o Compras (A6);
--   · saldo_grv é só referência do GRV (não é estoque): o estoque abre com contagem (M4).
--   · a carga das planilhas do GRV é feita por scripts/import-almoxarifado-materiais.mjs.
-- ============================================================================

insert into public.access_features (code, module_code, label, levels, sort) values
  ('almoxarifado.materiais', 'almoxarifado', 'Materiais', '{ver,operar}', 30)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

create or replace function public.materiais_pode_ver()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('almoxarifado.materiais', 'ver') or public.has_feature('almoxarifado.solicitacoes', 'ver')
      or public.has_feature('almoxarifado.recebimento', 'ver') or public.has_feature('compras.cotacoes', 'ver')
      or public.has_feature('compras.realizadas', 'ver') or public.has_feature('compras.aprovacoes', 'ver')
      or public.has_feature('fundicao.pedidos', 'ver') or public.has_feature('rh.sst', 'ver');
$$;
revoke all on function public.materiais_pode_ver() from public, anon;
grant execute on function public.materiais_pode_ver() to authenticated;

create or replace function public.materiais_pode_cadastrar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('almoxarifado.materiais', 'operar') or public.has_feature('compras.cotacoes', 'operar');
$$;
revoke all on function public.materiais_pode_cadastrar() from public, anon;
grant execute on function public.materiais_pode_cadastrar() to authenticated;

-- --- Grupos ---------------------------------------------------------------------------------------
-- O código do material é {prefixo}-{grupo}-{sequência}; o mesmo número de grupo aparece em prefixos
-- diferentes (2-01 fixadores, 8-01 escritório), por isso a chave é o par.
create table if not exists public.material_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prefixo text not null check (prefixo ~ '^[0-9A-Z]{1,6}$'),
  codigo text not null check (codigo ~ '^[0-9A-Z]{1,6}$'),
  nome text not null check (length(btrim(nome)) between 1 and 60),
  familia text not null default 'uso_consumo' check (length(btrim(familia)) between 1 and 40),
  proximo int not null default 1 check (proximo between 1 and 99999),
  -- Decisão A2: o grupo controla saldo (matéria-prima, intermediário, embalagem, EPI, produção).
  controla_estoque boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, prefixo, codigo)
);

-- --- Materiais ------------------------------------------------------------------------------------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null check (codigo ~ '^[0-9A-Z][0-9A-Z.\-/]{0,29}$'),
  descricao text not null check (length(btrim(descricao)) between 1 and 200),
  group_id uuid references public.material_groups(id) on delete set null,
  familia text not null default 'uso_consumo' check (length(btrim(familia)) between 1 and 40),
  grupo_nome text check (grupo_nome is null or length(grupo_nome) <= 60),
  subgrupo text check (subgrupo is null or length(subgrupo) <= 60),
  unidade text not null default 'UN' check (length(btrim(unidade)) between 1 and 8),
  unidade_compra text check (unidade_compra is null or length(btrim(unidade_compra)) between 1 and 8),
  ncm text check (ncm is null or ncm ~ '^\d{8}$'),
  plano_contas text check (plano_contas is null or length(plano_contas) <= 60),
  tipo_item text check (tipo_item is null or length(tipo_item) <= 60),
  custo_referencia numeric(14,4) not null default 0 check (custo_referencia >= 0),
  saldo_grv numeric(16,4),
  controla_estoque boolean not null default false,
  ativo boolean not null default true,
  origem text not null default 'plataforma' check (origem in ('grv', 'plataforma')),
  pendencias text[] not null default '{}',
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  -- Busca: código sem traço (20700589 acha 2-07-00589) e descrição sem acento.
  codigo_compacto text generated always as (regexp_replace(upper(codigo), '[^0-9A-Z]', '', 'g')) stored,
  descricao_busca text generated always as (translate(upper(descricao), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN')) stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, codigo)
);
create index if not exists idx_materials_lista on public.materials (organization_id, ativo, familia, codigo);
create index if not exists idx_materials_grupo on public.materials (organization_id, group_id);
create index if not exists idx_materials_alterados on public.materials (organization_id, updated_at);

-- O código não muda (é a chave guardada pela Forja e pelas compras); a data de alteração é do banco.
create or replace function public.materials_protege()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.codigo <> old.codigo then raise exception 'O código do material não muda depois de criado.'; end if;
    if new.organization_id <> old.organization_id then raise exception 'Material de outra empresa.'; end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.origem := old.origem;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists materials_protecao on public.materials;
create trigger materials_protecao before insert or update on public.materials
  for each row execute function public.materials_protege();

-- Próximo código do grupo (pula código que já exista, ex.: criado no GRV depois da carga).
create or replace function public.almoxarifado_material_proximo_codigo(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.material_groups%rowtype;
  v_codigo text;
begin
  if not public.materiais_pode_cadastrar() then
    raise exception 'Sem permissão para cadastrar materiais.' using errcode = '42501';
  end if;
  select * into g from public.material_groups where id = p_group and organization_id = public.current_organization_id() for update;
  if g.id is null then raise exception 'Grupo não encontrado.'; end if;
  loop
    v_codigo := format('%s-%s-%s', g.prefixo, g.codigo, lpad(g.proximo::text, 5, '0'));
    g.proximo := g.proximo + 1;
    exit when not exists (select 1 from public.materials m where m.organization_id = g.organization_id and m.codigo = v_codigo);
  end loop;
  update public.material_groups set proximo = g.proximo, updated_at = now() where id = g.id;
  return v_codigo;
end;
$$;
revoke all on function public.almoxarifado_material_proximo_codigo(uuid) from public, anon;
grant execute on function public.almoxarifado_material_proximo_codigo(uuid) to authenticated;

-- Busca do catálogo (tela Materiais, e depois o pedido, a cotação, o recebimento e a Forja): código que
-- começa com o digitado primeiro, depois código que contém, depois descrição por palavras sem acento.
-- Roda com a permissão de quem chama (RLS).
create or replace function public.almoxarifado_materiais_buscar(p_q text default '', p_familia text default null, p_group uuid default null, p_ativos boolean default true, p_limite int default 100)
returns setof public.materials
language sql
stable
security invoker
set search_path = public
as $$
  with t as (
    select translate(upper(btrim(coalesce(p_q, ''))), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN') as q,
           regexp_replace(upper(coalesce(p_q, '')), '[^0-9A-Z]', '', 'g') as qc
  ), w as (
    select t.q, t.qc, case when t.q = '' then '{}'::text[] else regexp_split_to_array(t.q, '\s+') end as palavras from t
  )
  select m.* from public.materials m, w
   where m.organization_id = public.current_organization_id()
     and (not coalesce(p_ativos, true) or m.ativo)
     and (p_familia is null or m.familia = p_familia)
     and (p_group is null or m.group_id = p_group)
     and (w.q = ''
          or (w.qc <> '' and m.codigo_compacto like w.qc || '%')
          or (length(w.qc) >= 3 and m.codigo_compacto like '%' || w.qc || '%')
          or not exists (select 1 from unnest(w.palavras) x where m.descricao_busca not like '%' || x || '%' and upper(m.codigo) not like '%' || x || '%'))
   order by case when w.qc <> '' and m.codigo_compacto like w.qc || '%' then 0
                 when length(w.qc) >= 3 and m.codigo_compacto like '%' || w.qc || '%' then 1
                 when w.q <> '' and m.descricao_busca like w.q || '%' then 2 else 3 end,
            m.codigo
   limit least(greatest(coalesce(p_limite, 100), 1), 500);
$$;
revoke all on function public.almoxarifado_materiais_buscar(text, text, uuid, boolean, int) from public, anon;
grant execute on function public.almoxarifado_materiais_buscar(text, text, uuid, boolean, int) to authenticated;

-- --- Acesso ---------------------------------------------------------------------------------------
alter table public.material_groups enable row level security;
alter table public.materials enable row level security;

drop policy if exists material_groups_read on public.material_groups;
create policy material_groups_read on public.material_groups for select using (organization_id = (select public.current_organization_id()) and (select public.materiais_pode_ver()));
drop policy if exists material_groups_write on public.material_groups;
create policy material_groups_write on public.material_groups for all
  using (organization_id = (select public.current_organization_id()) and (select public.has_feature('almoxarifado.materiais', 'operar')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_feature('almoxarifado.materiais', 'operar')));

drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select using (organization_id = (select public.current_organization_id()) and (select public.materiais_pode_ver()));
drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials for insert with check (organization_id = (select public.current_organization_id()) and (select public.materiais_pode_cadastrar()));
drop policy if exists materials_update on public.materials;
create policy materials_update on public.materials for update
  using (organization_id = (select public.current_organization_id()) and (select public.materiais_pode_cadastrar()))
  with check (organization_id = (select public.current_organization_id()) and (select public.materiais_pode_cadastrar()));
-- Não se apaga material: inativa.
revoke delete on public.materials from anon, authenticated;
