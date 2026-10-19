-- Grafo do Segundo Cérebro, etapa G1 (docs/PLANO-WAR-ROOM-CEREBRO.md), 19/10/2026.
--
-- Decisões do proprietário (19/10):
--   W1: só o proprietário entra no War Room por enquanto (ninguém recebe permissão aqui);
--   W2: quem tiver o War Room vê o grafo inteiro (o acesso é que é restrito);
--   W3: os lançamentos ficam somados dentro da ligação, com expansão;
--   W4: os valores aparecem para quem tiver o War Room.
--
-- O grafo é DERIVADO: montado por regra a partir das tabelas dos módulos (Compras, Financeiro,
-- Clientes nesta etapa) e pode ser refeito a qualquer hora. A verdade continua nos módulos.
-- Nunca entra dado sensível: sem CNPJ/CPF, contato, endereço, salário, saúde.

-- --- Permissão ---------------------------------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('warroom.cerebro', 'warroom', 'Segundo Cérebro (grafo)', '{ver}', 10)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- --- Tabelas -------------------------------------------------------------------------------
create table if not exists public.cerebro_nos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tipo            text not null check (tipo in ('fornecedor', 'cliente', 'item', 'material', 'produto', 'conta', 'setor', 'pessoa', 'documento', 'ativo_ti', 'sistema', 'processo')),
  -- Chave natural dentro do tipo (o id do registro, ou o nome normalizado do item comprado).
  chave           text not null,
  nome            text not null,
  termos          text[] not null default '{}',
  setor           text,
  resumo          jsonb not null default '{}'::jsonb,
  -- Funcionalidades que dão acesso ao registro de origem (para as fichas nas telas, etapa G3).
  exige           text[] not null default '{}',
  origem_tabela   text,
  origem_id       text,
  link            text,
  grau            integer not null default 0,
  x               real,
  y               real,
  busca           tsvector,
  procedencia     text not null default 'regra' check (procedencia in ('regra', 'pessoa', 'modelo')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, tipo, chave)
);
comment on table public.cerebro_nos is 'Nós do grafo do Segundo Cérebro (derivado dos módulos; refeito por cerebro_montar). Sem dado sensível.';
create index if not exists cerebro_nos_tipo on public.cerebro_nos (organization_id, tipo);
create index if not exists cerebro_nos_setor on public.cerebro_nos (organization_id, setor);
create index if not exists cerebro_nos_termos on public.cerebro_nos using gin (termos);
create index if not exists cerebro_nos_busca on public.cerebro_nos using gin (busca);
create index if not exists cerebro_nos_nome_trgm on public.cerebro_nos using gin (public.sem_acento(nome) extensions.gin_trgm_ops);

create table if not exists public.cerebro_ligacoes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  origem          uuid not null references public.cerebro_nos (id) on delete cascade,
  destino         uuid not null references public.cerebro_nos (id) on delete cascade,
  -- vendeu, cotou, lancado_em, abastece, pertence_a, tem_peca, e = (item é o material), …
  tipo            text not null check (tipo ~ '^[a-z_]{2,30}$'),
  -- Nas ligações de dependência, a seta vai de quem SUSTENTA para quem DEPENDE.
  familia         text not null check (familia in ('transacao', 'dependencia', 'responsabilidade', 'mencao', 'estrutura')),
  quantidade      integer,
  total           numeric,
  primeira        date,
  ultima          date,
  resumo          jsonb not null default '{}'::jsonb,
  -- Até 50 registros de origem (os mais recentes), para expandir a ligação.
  fonte_tabela    text,
  fontes          text[] not null default '{}',
  procedencia     text not null default 'regra' check (procedencia in ('regra', 'pessoa', 'modelo')),
  confianca       numeric check (confianca between 0 and 1),
  situacao        text not null default 'valendo' check (situacao in ('valendo', 'proposta')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (origem <> destino),
  unique (origem, destino, tipo)
);
comment on table public.cerebro_ligacoes is 'Ligações do grafo. Família dependencia: a seta vai de quem sustenta para quem depende. Lançamentos somados (W3).';
create index if not exists cerebro_ligacoes_origem on public.cerebro_ligacoes (origem, tipo);
create index if not exists cerebro_ligacoes_destino on public.cerebro_ligacoes (destino, tipo);
create index if not exists cerebro_ligacoes_familia on public.cerebro_ligacoes (organization_id, familia);
create index if not exists cerebro_ligacoes_ultima on public.cerebro_ligacoes (organization_id, ultima);

create table if not exists public.cerebro_execucoes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  inicio          timestamptz not null default now(),
  fim             timestamptz,
  ms              integer,
  nos             jsonb,
  ligacoes        jsonb,
  erro            text
);
create index if not exists cerebro_execucoes_inicio on public.cerebro_execucoes (organization_id, inicio desc);

-- --- Leitura: quem tem o War Room vê tudo (W2) ------------------------------------------------
alter table public.cerebro_nos enable row level security;
alter table public.cerebro_ligacoes enable row level security;
alter table public.cerebro_execucoes enable row level security;
drop policy if exists cerebro_nos_read on public.cerebro_nos;
create policy cerebro_nos_read on public.cerebro_nos for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('warroom.cerebro')));
drop policy if exists cerebro_ligacoes_read on public.cerebro_ligacoes;
create policy cerebro_ligacoes_read on public.cerebro_ligacoes for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('warroom.cerebro')));
drop policy if exists cerebro_execucoes_read on public.cerebro_execucoes;
create policy cerebro_execucoes_read on public.cerebro_execucoes for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('warroom.cerebro')));
revoke insert, update, delete on public.cerebro_nos, public.cerebro_ligacoes, public.cerebro_execucoes from anon, authenticated;
grant select on public.cerebro_nos, public.cerebro_ligacoes, public.cerebro_execucoes to authenticated;

-- --- Nome do item comprado ----------------------------------------------------------------------
-- Maiúsculas, sem acento, espaços simples, e sem a unidade repetida no fim
-- ("… TB 210 KG - 210 kg" = "… TB 210 KG"). Nomes só parecidos NÃO se fundem por regra.
create or replace function public.cerebro_item_chave(p text) returns text
language plpgsql immutable as $$
declare
  s text := trim(regexp_replace(upper(public.sem_acento(coalesce(p, ''))), '\s+', ' ', 'g'));
  m text[];
begin
  m := regexp_match(s, '^(.*?)\s*-\s*([0-9]+(?:[.,][0-9]+)?)\s*([A-Z]{1,3})$');
  if m is not null and position(replace(m[2] || m[3], ' ', '') in replace(m[1], ' ', '')) > 0 then
    s := trim(m[1]);
  end if;
  return nullif(s, '');
end $$;

-- --- Contas de pagamento a pessoas: nunca entram no grafo --------------------------------------------
-- O financeiro antigo lança a folha pessoa por pessoa (salário, adiantamento, 13º, férias, rescisão,
-- pensão alimentícia) e a remuneração dos sócios (retirada, pró-labore). É remuneração de pessoa:
-- fica fora do grafo inteiro, com todas as subcontas (o ramo "Gastos com funcionários" e os demais).
create or replace function public.cerebro_contas_pessoais(p_org uuid) returns setof uuid
language sql stable as $$
  with recursive ramo(id) as (
      select a.id from public.finance_chart_accounts a
       where a.organization_id = p_org
         and public.sem_acento(a.name) ~* '(gastos com funcionarios|socios|pro.?labore|comissao|salari|folha de pagamento|ferias|rescis|pensao|abono salarial|adiantamento)'
      union
      select f.id from public.finance_chart_accounts f join ramo r on f.parent_id = r.id)
  select id from ramo
$$;

-- --- Montagem ----------------------------------------------------------------------------------
-- Monta os nós e as ligações por regra numa área temporária e aplica só a diferença: insere o que
-- é novo, atualiza o que mudou e apaga o que sumiu (só o que veio de regra). Devolve as contagens.
create or replace function public.cerebro_montar(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t0 timestamptz := clock_timestamp();
  exec_id uuid;
  n_ins int; n_upd int; n_del int; l_ins int; l_upd int; l_del int;
begin
  if p_org is null then raise exception 'Informe a empresa.'; end if;
  insert into public.cerebro_execucoes (organization_id) values (p_org) returning id into exec_id;

  drop table if exists _nos, _lig, _compras, _cotacoes, _titulos, _parcelas, _lig_ids;
  create temp table _nos (tipo text, chave text, nome text, termos text[], setor text, resumo jsonb, exige text[], origem_tabela text, origem_id text, link text) on commit drop;
  create temp table _lig (tipo_o text, chave_o text, tipo_d text, chave_d text, tipo text, familia text, quantidade int, total numeric,
    primeira date, ultima date, resumo jsonb, fonte_tabela text, fontes text[]) on commit drop;

  -- Base: o que foi comprado e cotado, com o item normalizado.
  create temp table _compras on commit drop as
    select c.id, c.supplier_id, public.cerebro_item_chave(c.produto) item, c.produto, c.quantidade, c.unidade, c.valor_unit, c.total,
           c.data_compra, c.material_id, k.divisao
      from public.compras c left join public.cotacoes k on k.id = c.cotacao_id
     where c.organization_id = p_org and c.supplier_id is not null and public.cerebro_item_chave(c.produto) is not null;
  create temp table _cotacoes on commit drop as
    select k.id, k.supplier_id, public.cerebro_item_chave(k.produto) item, k.produto, k.valor_unit, k.status, k.divisao, k.created_at::date dia
      from public.cotacoes k
     where k.organization_id = p_org and k.deleted_at is null and k.supplier_id is not null and public.cerebro_item_chave(k.produto) is not null;
  create temp table _titulos on commit drop as
    select t.id, t.direction, t.supplier_id, t.customer_id, t.chart_account_id, t.original_amount, t.issue_date, t.status
      from public.finance_titles t
     -- Os arquivados entram: são o histórico pago do sistema antigo ("Pago antes de 2026"), não exclusões.
     -- Ficam de fora os cancelados e as previsões (ainda não aconteceram).
     -- E nada de pagamento a pessoa (folha, sócios): cerebro_contas_pessoais.
     where t.organization_id = p_org and t.status <> 'cancelled' and coalesce(t.is_forecast, false) = false
       and (t.chart_account_id is null or t.chart_account_id not in (select public.cerebro_contas_pessoais(p_org)));
  create temp table _parcelas on commit drop as
    select i.title_id, i.due_date, i.amount, coalesce(i.settled_amount, 0) pago, i.status::text status, s.pago_em
      from public.finance_installments i join _titulos t on t.id = i.title_id
      left join (select installment_id, max(settlement_date) pago_em from public.finance_settlements
                  where organization_id = p_org and reversed_at is null group by installment_id) s on s.installment_id = i.id;
  create index on _compras (supplier_id); create index on _compras (item);
  create index on _cotacoes (supplier_id); create index on _cotacoes (item);
  create index on _titulos (supplier_id); create index on _titulos (customer_id); create index on _titulos (chart_account_id);
  create index on _parcelas (title_id);
  analyze _compras; analyze _cotacoes; analyze _titulos; analyze _parcelas;

  -- Setores (as duas divisões que recebem material).
  insert into _nos values
    ('setor', 'FUNDICAO', 'Fundição', '{setor,producao}', 'fundicao', '{}'::jsonb, '{}', null, null, '/?module=fundicao'),
    ('setor', 'USINAGEM', 'Usinagem', '{setor,producao}', 'producao', '{}'::jsonb, '{}', null, null, '/?module=producao');

  -- Fornecedores com alguma ligação (compra, cotação ou título).
  insert into _nos
  select 'fornecedor', s.id::text, s.name,
         array_remove(array['fornecedor', lower(nullif(s.category, ''))] || coalesce((select array_agg(lower(d)) from unnest(s.divisions) d), '{}'), null),
         'compras',
         jsonb_strip_nulls(jsonb_build_object(
           'razao_social', nullif(s.legal_name, ''), 'cidade', nullif(s.city, ''), 'uf', nullif(s.state, ''), 'categoria', nullif(s.category, ''),
           'condicao_pagamento', nullif(s.payment_terms, ''), 'ativo', s.active,
           'compras', (select count(*) from _compras c where c.supplier_id = s.id),
           'comprado', (select round(sum(c.total), 2) from _compras c where c.supplier_id = s.id),
           'ultima_compra', (select max(c.data_compra) from _compras c where c.supplier_id = s.id),
           'cotacoes', (select count(*) from _cotacoes k where k.supplier_id = s.id),
           'titulos', (select count(*) from _titulos t where t.supplier_id = s.id),
           'lancado', (select round(sum(t.original_amount), 2) from _titulos t where t.supplier_id = s.id),
           'pago', (select round(sum(p.pago), 2) from _parcelas p join _titulos t on t.id = p.title_id where t.supplier_id = s.id),
           'em_aberto', (select round(sum(p.amount - p.pago), 2) from _parcelas p join _titulos t on t.id = p.title_id where t.supplier_id = s.id and p.amount > p.pago),
           'primeiro_lancamento', (select min(t.issue_date) from _titulos t where t.supplier_id = s.id),
           'ultimo_lancamento', (select max(t.issue_date) from _titulos t where t.supplier_id = s.id))),
         '{compras.fornecedores,compras.cotacoes,financeiro.pagar,fundacao.cadastros}', 'suppliers', s.id::text, '/?module=compras&secao=Fornecedores'
    from public.suppliers s
   where s.organization_id = p_org and s.merged_into is null
     and (exists (select 1 from _compras c where c.supplier_id = s.id) or exists (select 1 from _cotacoes k where k.supplier_id = s.id)
          or exists (select 1 from _titulos t where t.supplier_id = s.id));

  -- Clientes (todos), com o comportamento de pagamento.
  insert into _nos
  select 'cliente', c.id::text, c.name, '{cliente}', 'comercial',
         jsonb_strip_nulls(jsonb_build_object(
           'municipio', nullif(c.municipio, ''), 'uf', nullif(c.uf, ''), 'ativo', c.active,
           'pecas', (select count(*) from public.products p where p.customer_id = c.id),
           'os', (select count(*) from public.production_orders o where o.customer_id = c.id and o.removed_from_source_at is null),
           'titulos', (select count(*) from _titulos t where t.customer_id = c.id),
           'faturado', (select round(sum(t.original_amount), 2) from _titulos t where t.customer_id = c.id),
           'recebido', (select round(sum(p.pago), 2) from _parcelas p join _titulos t on t.id = p.title_id where t.customer_id = c.id),
           'em_aberto', (select round(sum(p.amount - p.pago), 2) from _parcelas p join _titulos t on t.id = p.title_id where t.customer_id = c.id and p.amount > p.pago),
           'vencido', (select round(sum(p.amount - p.pago), 2) from _parcelas p join _titulos t on t.id = p.title_id where t.customer_id = c.id and p.amount > p.pago and p.due_date < current_date),
           -- Atraso médio, em dias, das parcelas pagas (pago depois do vencimento conta; antes, zero).
           'atraso_medio_dias', (select round(avg(greatest(p.pago_em - p.due_date, 0)), 1) from _parcelas p join _titulos t on t.id = p.title_id
                                  where t.customer_id = c.id and p.pago_em is not null),
           'ultimo_lancamento', (select max(t.issue_date) from _titulos t where t.customer_id = c.id))),
         '{comercial.clientes,financeiro.receber,fundacao.cadastros}', 'customers', c.id::text, '/?module=comercial&secao=clientes'
    from public.customers c
   where c.organization_id = p_org and c.merged_into is null;

  -- Peças (produtos) dos clientes.
  insert into _nos
  select 'produto', p.id::text, coalesce(nullif(p.codigo, '') || ' · ', '') || p.descricao,
         array_remove(array['peca', lower(nullif(p.tipo_peca, '')), lower(nullif(p.material, ''))], null), 'comercial',
         jsonb_strip_nulls(jsonb_build_object('codigo', p.codigo, 'tipo_peca', p.tipo_peca, 'material', p.material, 'desenho', p.desenho_codigo, 'ncm', p.ncm, 'ativo', p.ativo)),
         '{comercial.produtos,comercial.orcamentos}', 'products', p.id::text, '/?module=comercial&secao=produtos'
    from public.products p
   where p.organization_id = p_org and p.customer_id is not null;

  -- Itens comprados ou cotados (o nome normalizado; vira ponte para o material).
  insert into _nos
  select 'item', i.item,
         (select x.produto from (select produto, data_compra d from _compras where item = i.item union all select produto, dia from _cotacoes where item = i.item) x order by x.d desc nulls last limit 1),
         array_remove(array['item comprado',
           case when bool_or(i.divisao = 'FUNDICAO') then 'fundicao' end, case when bool_or(i.divisao = 'USINAGEM') then 'usinagem' end], null),
         'compras',
         jsonb_strip_nulls(jsonb_build_object(
           'compras', (select count(*) from _compras c where c.item = i.item),
           'comprado', (select round(sum(c.total), 2) from _compras c where c.item = i.item),
           'fornecedores', (select count(distinct supplier_id) from (select supplier_id from _compras where item = i.item union select supplier_id from _cotacoes where item = i.item) f),
           'menor_preco', (select round(min(c.valor_unit), 4) from _compras c where c.item = i.item),
           'maior_preco', (select round(max(c.valor_unit), 4) from _compras c where c.item = i.item),
           'ultimo_preco', (select c.valor_unit from _compras c where c.item = i.item order by c.data_compra desc nulls last limit 1),
           'unidade', (select c.unidade from _compras c where c.item = i.item and c.unidade is not null order by c.data_compra desc nulls last limit 1),
           'ultima_compra', (select max(c.data_compra) from _compras c where c.item = i.item),
           'nomes', (select count(distinct produto) from (select produto from _compras where item = i.item union select produto from _cotacoes where item = i.item) n))),
         '{compras.cotacoes,compras.realizadas}', null, i.item, '/?module=compras'
    from (select item, divisao from _compras union all select item, divisao from _cotacoes) i
   group by i.item;

  -- Materiais do catálogo que já têm compra ligada.
  insert into _nos
  select 'material', m.id::text, coalesce(nullif(m.codigo, '') || ' · ', '') || m.descricao, array_remove(array['material', lower(nullif(m.familia, ''))], null), 'almoxarifado',
         jsonb_strip_nulls(jsonb_build_object('codigo', m.codigo, 'unidade', m.unidade, 'grupo', m.grupo_nome, 'ncm', m.ncm)),
         '{almoxarifado.materiais}', 'materials', m.id::text, '/?module=almoxarifado&secao=Materiais'
    from public.materials m
   where m.organization_id = p_org and m.id in (select material_id from _compras where material_id is not null);

  -- Contas do plano com lançamento, e as contas pai delas.
  insert into _nos
  with recursive usadas as (
      select a.id, a.parent_id from public.finance_chart_accounts a where a.organization_id = p_org and a.id in (select chart_account_id from _titulos where chart_account_id is not null)
      union
      select p.id, p.parent_id from public.finance_chart_accounts p join usadas u on u.parent_id = p.id)
  select 'conta', a.id::text, coalesce(nullif(a.code, '') || ' · ', '') || a.name, array['conta', lower(a.account_type::text)], 'financeiro',
         jsonb_strip_nulls(jsonb_build_object('codigo', a.code, 'tipo', a.account_type::text,
           'titulos', (select count(*) from _titulos t where t.chart_account_id = a.id),
           'lancado', (select round(sum(t.original_amount), 2) from _titulos t where t.chart_account_id = a.id))),
         '{financeiro.plano,financeiro.pagar,financeiro.receber}', 'finance_chart_accounts', a.id::text, '/?module=financeiro&secao=Plano%20de%20contas'
    from public.finance_chart_accounts a where a.id in (select id from usadas);

  -- Ligações ---------------------------------------------------------------------------------
  -- fornecedor —vendeu→ item (as compras somadas)
  insert into _lig
  select 'fornecedor', c.supplier_id::text, 'item', c.item, 'vendeu', 'transacao', count(*)::int, round(sum(c.total), 2), min(c.data_compra), max(c.data_compra),
         jsonb_strip_nulls(jsonb_build_object('ultimo_preco', (array_agg(c.valor_unit order by c.data_compra desc nulls last))[1], 'menor_preco', min(c.valor_unit),
           'maior_preco', max(c.valor_unit), 'quantidade_total', sum(c.quantidade), 'unidade', max(c.unidade))),
         'compras', (array_agg(c.id::text order by c.data_compra desc nulls last))[1:50]
    from _compras c group by c.supplier_id, c.item;
  -- fornecedor —cotou→ item (as cotações somadas)
  insert into _lig
  select 'fornecedor', k.supplier_id::text, 'item', k.item, 'cotou', 'transacao', count(*)::int, null, min(k.dia), max(k.dia),
         jsonb_build_object('aprovadas', count(*) filter (where k.status in ('APROVADO', 'COMPRADO')), 'rejeitadas', count(*) filter (where k.status = 'REJEITADO'),
           'pendentes', count(*) filter (where k.status = 'PENDENTE'), 'ultimo_valor', (array_agg(k.valor_unit order by k.dia desc))[1]),
         'cotacoes', (array_agg(k.id::text order by k.dia desc))[1:50]
    from _cotacoes k group by k.supplier_id, k.item;
  -- item —abastece→ setor (dependência: o setor depende do item)
  insert into _lig
  select 'item', x.item, 'setor', x.divisao, 'abastece', 'dependencia', count(*)::int, null, min(x.dia), max(x.dia), '{}'::jsonb, null, '{}'
    from (select item, divisao, data_compra dia from _compras union all select item, divisao, dia from _cotacoes) x
   where x.divisao in ('FUNDICAO', 'USINAGEM') group by x.item, x.divisao;
  -- item —e→ material (quando a compra foi ligada ao catálogo)
  insert into _lig
  select 'item', c.item, 'material', c.material_id::text, 'e', 'estrutura', count(*)::int, null, null, null, '{}'::jsonb, null, '{}'
    from _compras c where c.material_id is not null group by c.item, c.material_id;
  -- fornecedor/cliente —lancado_em→ conta (os títulos somados)
  insert into _lig
  select case when t.direction::text = 'payable' then 'fornecedor' else 'cliente' end, coalesce(t.supplier_id, t.customer_id)::text, 'conta', t.chart_account_id::text,
         'lancado_em', 'transacao', count(*)::int, round(sum(t.original_amount), 2), min(t.issue_date), max(t.issue_date),
         jsonb_build_object('direcao', case when t.direction::text = 'payable' then 'a pagar' else 'a receber' end),
         'finance_titles', (array_agg(t.id::text order by t.issue_date desc nulls last))[1:50]
    from _titulos t where t.chart_account_id is not null and coalesce(t.supplier_id, t.customer_id) is not null
   group by t.direction, coalesce(t.supplier_id, t.customer_id), t.chart_account_id;
  -- conta —pertence_a→ conta pai
  insert into _lig
  select 'conta', a.id::text, 'conta', a.parent_id::text, 'pertence_a', 'estrutura', null, null, null, null, '{}'::jsonb, null, '{}'
    from public.finance_chart_accounts a
   where a.organization_id = p_org and a.parent_id is not null and a.id::text in (select chave from _nos where tipo = 'conta') and a.parent_id::text in (select chave from _nos where tipo = 'conta');
  -- cliente —tem_peca→ produto
  insert into _lig
  select 'cliente', p.customer_id::text, 'produto', p.id::text, 'tem_peca', 'estrutura', null, null, null, null, '{}'::jsonb, null, '{}'
    from public.products p where p.organization_id = p_org and p.customer_id is not null;

  -- Aplicar a diferença: nós ----------------------------------------------------------------------
  with novos as (
    insert into public.cerebro_nos (organization_id, tipo, chave, nome, termos, setor, resumo, exige, origem_tabela, origem_id, link, busca)
    select p_org, n.tipo, n.chave, n.nome, n.termos, n.setor, n.resumo, n.exige, n.origem_tabela, n.origem_id, n.link,
           setweight(to_tsvector('public.portugues_sem_acento', coalesce(n.nome, '')), 'A') || setweight(to_tsvector('public.portugues_sem_acento', array_to_string(n.termos, ' ')), 'B')
      from _nos n
     where not exists (select 1 from public.cerebro_nos c where c.organization_id = p_org and c.tipo = n.tipo and c.chave = n.chave)
    returning 1)
  select count(*) into n_ins from novos;
  with mudou as (
    update public.cerebro_nos c set nome = n.nome, termos = n.termos, setor = n.setor, resumo = n.resumo, exige = n.exige, origem_tabela = n.origem_tabela,
           origem_id = n.origem_id, link = n.link, updated_at = now(),
           busca = setweight(to_tsvector('public.portugues_sem_acento', coalesce(n.nome, '')), 'A') || setweight(to_tsvector('public.portugues_sem_acento', array_to_string(n.termos, ' ')), 'B')
      from _nos n
     where c.organization_id = p_org and c.tipo = n.tipo and c.chave = n.chave
       and (c.nome, c.termos, c.setor, c.resumo, c.exige, c.link) is distinct from (n.nome, n.termos, n.setor, n.resumo, n.exige, n.link)
    returning 1)
  select count(*) into n_upd from mudou;
  with sumiu as (
    delete from public.cerebro_nos c
     where c.organization_id = p_org and c.procedencia = 'regra'
       and c.tipo in ('fornecedor', 'cliente', 'item', 'material', 'produto', 'conta', 'setor')
       and not exists (select 1 from _nos n where n.tipo = c.tipo and n.chave = c.chave)
    returning 1)
  select count(*) into n_del from sumiu;

  -- Aplicar a diferença: ligações ------------------------------------------------------------------
  create temp table _lig_ids on commit drop as
    select o.id origem, d.id destino, l.* from _lig l
      join public.cerebro_nos o on o.organization_id = p_org and o.tipo = l.tipo_o and o.chave = l.chave_o
      join public.cerebro_nos d on d.organization_id = p_org and d.tipo = l.tipo_d and d.chave = l.chave_d
     where o.id <> d.id;
  with novas as (
    insert into public.cerebro_ligacoes (organization_id, origem, destino, tipo, familia, quantidade, total, primeira, ultima, resumo, fonte_tabela, fontes)
    select p_org, l.origem, l.destino, l.tipo, l.familia, l.quantidade, l.total, l.primeira, l.ultima, l.resumo, l.fonte_tabela, coalesce(l.fontes, '{}')
      from _lig_ids l
     where not exists (select 1 from public.cerebro_ligacoes c where c.origem = l.origem and c.destino = l.destino and c.tipo = l.tipo)
    returning 1)
  select count(*) into l_ins from novas;
  with mudou as (
    update public.cerebro_ligacoes c set familia = l.familia, quantidade = l.quantidade, total = l.total, primeira = l.primeira, ultima = l.ultima,
           resumo = l.resumo, fonte_tabela = l.fonte_tabela, fontes = coalesce(l.fontes, '{}'), updated_at = now()
      from _lig_ids l
     where c.origem = l.origem and c.destino = l.destino and c.tipo = l.tipo and c.procedencia = 'regra'
       and (c.quantidade, c.total, c.primeira, c.ultima, c.resumo, c.fontes) is distinct from (l.quantidade, l.total, l.primeira, l.ultima, l.resumo, coalesce(l.fontes, '{}'))
    returning 1)
  select count(*) into l_upd from mudou;
  with sumiu as (
    delete from public.cerebro_ligacoes c
     where c.organization_id = p_org and c.procedencia = 'regra'
       and not exists (select 1 from _lig_ids l where l.origem = c.origem and l.destino = c.destino and l.tipo = c.tipo)
    returning 1)
  select count(*) into l_del from sumiu;

  -- Grau (tamanho do nó no desenho).
  update public.cerebro_nos n set grau = g.grau
    from (select x.id, ((select count(*) from public.cerebro_ligacoes l where l.origem = x.id)
                      + (select count(*) from public.cerebro_ligacoes l where l.destino = x.id))::int grau
            from public.cerebro_nos x where x.organization_id = p_org) g
   where n.id = g.id and n.grau is distinct from g.grau;

  update public.cerebro_execucoes set fim = clock_timestamp(), ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int,
    nos = jsonb_build_object('novos', n_ins, 'alterados', n_upd, 'removidos', n_del, 'total', (select count(*) from public.cerebro_nos where organization_id = p_org)),
    ligacoes = jsonb_build_object('novas', l_ins, 'alteradas', l_upd, 'removidas', l_del, 'total', (select count(*) from public.cerebro_ligacoes where organization_id = p_org))
   where id = exec_id;
  return (select jsonb_build_object('ms', ms, 'nos', nos, 'ligacoes', ligacoes) from public.cerebro_execucoes where id = exec_id);
end;
$$;
revoke all on function public.cerebro_montar(uuid) from public, anon, authenticated;
grant execute on function public.cerebro_montar(uuid) to service_role;

-- O proprietário pode mandar refazer (botão no War Room).
create or replace function public.cerebro_refazer()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Só o proprietário refaz o grafo.' using errcode = '42501'; end if;
  return public.cerebro_montar(public.current_organization_id());
end $$;
revoke all on function public.cerebro_refazer() from public, anon;
grant execute on function public.cerebro_refazer() to authenticated;

-- --- Consultas (com a sessão de quem pergunta: o RLS das tabelas vale) ---------------------------
create or replace function public.cerebro_no_json(n public.cerebro_nos) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', n.id, 'tipo', n.tipo, 'nome', n.nome, 'termos', n.termos, 'setor', n.setor, 'resumo', n.resumo,
    'grau', n.grau, 'link', n.link, 'x', n.x, 'y', n.y)
$$;
create or replace function public.cerebro_ligacao_json(l public.cerebro_ligacoes) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', l.id, 'origem', l.origem, 'destino', l.destino, 'tipo', l.tipo, 'familia', l.familia, 'quantidade', l.quantidade,
    'total', l.total, 'primeira', l.primeira, 'ultima', l.ultima, 'resumo', l.resumo, 'procedencia', l.procedencia, 'situacao', l.situacao)
$$;

-- Busca por termo (com e sem acento, parcial; parecidos quando nada casa).
create or replace function public.cerebro_buscar(p_termo text, p_tipos text[] default null, p_limite integer default 30)
returns jsonb
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  q text := trim(coalesce(p_termo, ''));
  qn text := public.sem_acento(q);
  consulta tsquery;
begin
  if length(q) < 2 then return '[]'::jsonb; end if;
  consulta := websearch_to_tsquery('public.portugues_sem_acento', q);
  return coalesce((
    select jsonb_agg(public.cerebro_no_json(n) order by a.r desc, n.grau desc)
      from (select x.id, (case when public.sem_acento(x.nome) like qn || '%' then 3 when public.sem_acento(x.nome) like '%' || qn || '%' then 2 else 0 end
                         + coalesce(ts_rank(x.busca, consulta), 0) + similarity(qn, public.sem_acento(x.nome))) r
              from public.cerebro_nos x
             where (p_tipos is null or x.tipo = any (p_tipos))
               and (x.busca @@ consulta or public.sem_acento(x.nome) like '%' || qn || '%' or qn <<% public.sem_acento(x.nome))
             order by r desc, x.grau desc
             limit least(greatest(coalesce(p_limite, 30), 1), 200)) a
      join public.cerebro_nos n on n.id = a.id), '[]'::jsonb);
end $$;

-- Vizinhança de um nó, até 3 passos, isolando por tipo de nó, tipo e família de ligação e período.
create or replace function public.cerebro_vizinhanca(p_no uuid, p_profundidade integer default 1, p_tipos_no text[] default null,
  p_tipos_ligacao text[] default null, p_familias text[] default null, p_desde date default null, p_limite integer default 400)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  prof int := least(greatest(coalesce(p_profundidade, 1), 1), 3);
  lim int := least(greatest(coalesce(p_limite, 400), 1), 3000);
  ids uuid[];
begin
  with recursive passo(id, d) as (
      select p_no, 0
      union
      select case when l.origem = p.id then l.destino else l.origem end, p.d + 1
        from passo p join public.cerebro_ligacoes l on (l.origem = p.id or l.destino = p.id)
        join public.cerebro_nos o on o.id = case when l.origem = p.id then l.destino else l.origem end
       where p.d < prof
         and (p_tipos_ligacao is null or l.tipo = any (p_tipos_ligacao))
         and (p_familias is null or l.familia = any (p_familias))
         and (p_desde is null or l.ultima is null or l.ultima >= p_desde)
         and (p_tipos_no is null or o.tipo = any (p_tipos_no)))
  select array_agg(id) into ids from (select id, min(d) d from passo group by id order by min(d) limit lim) x;
  if ids is null or not exists (select 1 from public.cerebro_nos where id = p_no) then return jsonb_build_object('nos', '[]'::jsonb, 'ligacoes', '[]'::jsonb); end if;
  return jsonb_build_object(
    'centro', p_no,
    'nos', (select coalesce(jsonb_agg(public.cerebro_no_json(n)), '[]'::jsonb) from public.cerebro_nos n where n.id = any (ids)),
    'ligacoes', (select coalesce(jsonb_agg(public.cerebro_ligacao_json(l)), '[]'::jsonb) from public.cerebro_ligacoes l
                  where l.origem = any (ids) and l.destino = any (ids)
                    and (p_tipos_ligacao is null or l.tipo = any (p_tipos_ligacao)) and (p_familias is null or l.familia = any (p_familias))
                    and (p_desde is null or l.ultima is null or l.ultima >= p_desde)));
end $$;

-- Caminho mais curto entre dois nós (até 5 passos). Busca em largura com os já visitados
-- (os nós centrais, como uma conta pai, ligam centenas de outros: listar caminhos explodiria).
create or replace function public.cerebro_caminho(p_de uuid, p_para uuid, p_max integer default 4)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  mx int := least(greatest(coalesce(p_max, 4), 1), 5);
  nivel int := 0;
  novos int;
  caminho uuid[] := '{}'; arestas uuid[] := '{}';
  atual uuid; v record;
begin
  if p_de is null or p_para is null or p_de = p_para then return jsonb_build_object('achou', false, 'nos', '[]'::jsonb, 'ligacoes', '[]'::jsonb); end if;
  drop table if exists _vis;
  create temp table _vis (id uuid primary key, pai uuid, aresta uuid, d int) on commit drop;
  insert into _vis values (p_de, null, null, 0);
  while nivel < mx and not exists (select 1 from _vis where id = p_para) loop
    nivel := nivel + 1;
    insert into _vis (id, pai, aresta, d)
    select distinct on (viz) viz, f.id, l.id, nivel
      from _vis f
      join public.cerebro_ligacoes l on l.origem = f.id or l.destino = f.id
      cross join lateral (select case when l.origem = f.id then l.destino else l.origem end viz) z
     where f.d = nivel - 1
    on conflict (id) do nothing;
    get diagnostics novos = row_count;
    exit when novos = 0;
  end loop;
  if not exists (select 1 from _vis where id = p_para) then return jsonb_build_object('achou', false, 'nos', '[]'::jsonb, 'ligacoes', '[]'::jsonb); end if;
  atual := p_para;
  loop
    select * into v from _vis where id = atual;
    caminho := atual || caminho;
    exit when v.pai is null;
    arestas := v.aresta || arestas;
    atual := v.pai;
  end loop;
  return jsonb_build_object('achou', true, 'passos', cardinality(arestas),
    'nos', (select jsonb_agg(public.cerebro_no_json(n) order by array_position(caminho, n.id)) from public.cerebro_nos n where n.id = any (caminho)),
    'ligacoes', (select jsonb_agg(public.cerebro_ligacao_json(l) order by array_position(arestas, l.id)) from public.cerebro_ligacoes l where l.id = any (arestas)));
end $$;

-- Dependências: jusante = o que depende deste nó (segue a seta); montante = do que ele depende.
create or replace function public.cerebro_dependencias(p_no uuid, p_sentido text default 'jusante', p_profundidade integer default 3)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  prof int := least(greatest(coalesce(p_profundidade, 3), 1), 6);
  ids uuid[];
begin
  if p_sentido not in ('jusante', 'montante') then raise exception 'Sentido: jusante ou montante.'; end if;
  with recursive passo(id, d) as (
      select p_no, 0
      union
      select case when p_sentido = 'jusante' then l.destino else l.origem end, p.d + 1
        from passo p join public.cerebro_ligacoes l
          on l.familia = 'dependencia' and (case when p_sentido = 'jusante' then l.origem else l.destino end) = p.id
       where p.d < prof)
  select array_agg(distinct id) into ids from passo;
  return jsonb_build_object('centro', p_no, 'sentido', p_sentido,
    'nos', (select coalesce(jsonb_agg(public.cerebro_no_json(n)), '[]'::jsonb) from public.cerebro_nos n where n.id = any (ids)),
    'ligacoes', (select coalesce(jsonb_agg(public.cerebro_ligacao_json(l)), '[]'::jsonb) from public.cerebro_ligacoes l
                  where l.familia = 'dependencia' and l.origem = any (ids) and l.destino = any (ids)));
end $$;

-- Visão geral: os nós (opcionalmente só alguns tipos e com grau mínimo) e as ligações entre eles.
create or replace function public.cerebro_visao(p_tipos text[] default null, p_min_grau integer default 1, p_limite integer default 6000)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  ids uuid[];
begin
  select array_agg(id) into ids from (
    select id from public.cerebro_nos
     where (p_tipos is null or tipo = any (p_tipos)) and grau >= coalesce(p_min_grau, 0)
     order by grau desc limit least(greatest(coalesce(p_limite, 6000), 1), 20000)) x;
  return jsonb_build_object(
    'nos', (select coalesce(jsonb_agg(public.cerebro_no_json(n)), '[]'::jsonb) from public.cerebro_nos n where n.id = any (coalesce(ids, '{}'))),
    'ligacoes', (select coalesce(jsonb_agg(public.cerebro_ligacao_json(l)), '[]'::jsonb) from public.cerebro_ligacoes l
                  where l.origem = any (coalesce(ids, '{}')) and l.destino = any (coalesce(ids, '{}'))));
end $$;

-- Expandir uma ligação somada: os registros de origem (até 50), com o que a tela precisa.
create or replace function public.cerebro_expandir(p_ligacao uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  l public.cerebro_ligacoes;
begin
  select * into l from public.cerebro_ligacoes where id = p_ligacao;
  if l.id is null then return '[]'::jsonb; end if;
  -- As tabelas de origem são lidas pelo dono da função (security definer abaixo), só pelos ids da ligação visível.
  return public.cerebro_registros(l.fonte_tabela, l.fontes);
end $$;

create or replace function public.cerebro_registros(p_tabela text, p_ids text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  -- Só para quem tem o War Room (W2: vê tudo do grafo, inclusive os valores, W4).
  if not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  if p_tabela = 'compras' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', 'compra', 'data', c.data_compra, 'titulo', c.produto,
        'detalhe', concat_ws(' · ', c.quantidade || ' ' || coalesce(c.unidade, ''), 'NF ' || nullif(c.nf, '')), 'valor', c.total, 'valor_unit', c.valor_unit,
        'link', '/?module=compras&secao=Realizadas') order by c.data_compra desc)
      from public.compras c where c.organization_id = public.current_organization_id() and c.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'cotacoes' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'tipo', 'cotação', 'data', k.created_at::date, 'titulo', k.produto,
        'detalhe', concat_ws(' · ', k.status, k.divisao, nullif(k.prazo, '')), 'valor_unit', k.valor_unit, 'link', '/?module=compras&secao=Cota%C3%A7%C3%B5es') order by k.created_at desc)
      from public.cotacoes k where k.organization_id = public.current_organization_id() and k.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'finance_titles' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'tipo', case when t.direction::text = 'payable' then 'conta a pagar' else 'conta a receber' end,
        'data', t.issue_date, 'titulo', coalesce(nullif(t.description, ''), t.counterparty_name), 'detalhe', concat_ws(' · ', nullif(t.document_number, ''), t.status::text),
        'valor', t.original_amount, 'link', case when t.direction::text = 'payable' then '/?module=financeiro&secao=Contas%20a%20pagar' else '/?module=financeiro&secao=Contas%20a%20receber' end)
        order by t.issue_date desc)
      from public.finance_titles t where t.organization_id = public.current_organization_id() and t.id::text = any (p_ids)), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
revoke all on function public.cerebro_registros(text, text[]) from public, anon;
grant execute on function public.cerebro_registros(text, text[]) to authenticated;
