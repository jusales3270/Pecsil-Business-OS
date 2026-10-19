-- Grafo do Segundo Cérebro, etapas G3 e G4 (docs/PLANO-WAR-ROOM-CEREBRO.md), 19/10/2026.
--
-- G4: mais áreas no grafo, todas por regra a partir do que já existe:
--   - setores (os módulos) e os sistemas (Business OS, Forja, GRV), com o servidor da fábrica e o
--     inventário de TI: equipamento —sustenta→ sistema —sustenta→ setor (o que para se ele parar);
--   - pessoas e o que cada uma aprova ou opera (das permissões dadas em Pessoas e Acessos);
--   - a Cadeia 1 (compra até o pagamento, definida em 01/10): os setores por onde passa e quem
--     alimenta quem; as Cadeias 2 e 3 ainda são rascunho e ficam fora;
--   - documentos e o que eles citam; o cliente que encomendou cada peça (as OS somadas).
-- G3: a ficha do cérebro nas telas dos módulos (cerebro_ficha, com a permissão de cada área) e o
-- histórico de preço por item (cerebro_historico_preco, com o RLS das compras).

-- --- G4: mais áreas no grafo ------------------------------------------------------------------------
-- Chamada por cerebro_montar, nas mesmas tabelas temporárias (_nos, _lig). Tudo por regra, a partir de
-- dados que já existem: permissões (quem aprova e quem opera), a Cadeia 1 de processos (definida pelo
-- proprietário em 01/10), os sistemas, o inventário e as quedas da TI, os documentos e as OS.
create or replace function public.cerebro_montar_mais(p_org uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  servidor_chave text;
begin
  -- Setores = os módulos (Fundição e Usinagem já entram pela compra).
  insert into _nos (tipo, chave, nome, termos, setor, resumo, exige, origem_tabela, origem_id, link)
  select 'setor', s.chave, s.nome, array['setor', s.modulo], s.modulo, '{}'::jsonb, '{}', null, null, '/?module=' || s.modulo
    from (values ('COMPRAS', 'Compras', 'compras'), ('FINANCEIRO', 'Financeiro', 'financeiro'), ('COMERCIAL', 'Comercial', 'comercial'),
                 ('ALMOXARIFADO', 'Almoxarifado', 'almoxarifado'), ('FISCAL', 'Fiscal', 'fiscal'), ('RH', 'Recursos Humanos', 'rh'),
                 ('PORTARIA', 'Portaria', 'portaria'), ('PRODUCAO', 'Produção', 'producao'), ('TI', 'TI', 'ti')) s(chave, nome, modulo)
   where not exists (select 1 from _nos n where n.tipo = 'setor' and n.chave = s.chave);
  -- A OS em aberto fica no resumo da Produção.
  update _nos set resumo = jsonb_build_object('os_em_aberto', (select count(*) from public.production_orders o
      where o.organization_id = p_org and o.removed_from_source_at is null and o.status not in ('finalizada', 'cancelada', 'entregue')))
   where tipo = 'setor' and chave = 'PRODUCAO';
  insert into _lig values ('setor', 'USINAGEM', 'setor', 'PRODUCAO', 'pertence_a', 'estrutura', null, null, null, null, '{}'::jsonb, null, '{}');

  -- Sistemas, e de que setores cada um é a base.
  insert into _nos values
    ('sistema', 'BUSINESS_OS', 'Business OS', '{sistema,plataforma}', 'ti',
      jsonb_strip_nulls(jsonb_build_object('onde', 'servidor da fábrica, publicado pelo Coolify')), '{ti.saude,ti.ativos}', null, null, '/?module=ti'),
    ('sistema', 'FORJA', 'Forja', '{sistema,producao}', 'ti', jsonb_build_object('onde', 'servidor da fábrica, publicado pelo Coolify'), '{ti.saude,ti.ativos}', null, null, '/?module=producao'),
    ('sistema', 'GRV', 'GRV (sistema antigo)', '{sistema,legado}', 'ti', jsonb_build_object('situacao', 'em uso no orçamento, sendo substituído (PLANO-ORCAMENTO)'), '{ti.saude,ti.ativos}', null, null, null);
  insert into _lig
  select 'sistema', 'BUSINESS_OS', 'setor', s, 'sustenta', 'dependencia', null, null, null, null, '{}'::jsonb, null, '{}'
    from unnest(array['COMPRAS', 'FINANCEIRO', 'COMERCIAL', 'ALMOXARIFADO', 'FISCAL', 'RH', 'PORTARIA', 'PRODUCAO', 'FUNDICAO', 'TI']) s;
  insert into _lig values
    ('sistema', 'FORJA', 'setor', 'PRODUCAO', 'sustenta', 'dependencia', null, null, null, null, jsonb_build_object('por', 'as OS e os lotes vêm da Forja'), null, '{}'),
    ('sistema', 'FORJA', 'setor', 'FUNDICAO', 'sustenta', 'dependencia', null, null, null, null, jsonb_build_object('por', 'o andamento dos lotes na fundição vem da Forja'), null, '{}'),
    ('sistema', 'GRV', 'setor', 'COMERCIAL', 'sustenta', 'dependencia', null, null, null, null, jsonb_build_object('por', 'o orçamento ainda é feito no GRV'), null, '{}');

  -- O servidor: o do inventário que o vigia acompanha, ou o do próprio vigia enquanto o inventário não tiver.
  select a.id::text into servidor_chave from public.ti_ativos a
   where a.organization_id = p_org and a.vigia_alvo = 'servidor-pecsil' and a.situacao <> 'baixado' limit 1;
  if servidor_chave is null then
    servidor_chave := 'vigia:servidor-pecsil';
    insert into _nos values ('ativo_ti', servidor_chave, 'Servidor da fábrica', '{servidor,critico}', 'ti', '{}'::jsonb, '{ti.saude,ti.ativos}', null, null, '/?module=ti&secao=Painel');
  end if;
  insert into _lig values
    ('ativo_ti', servidor_chave, 'sistema', 'BUSINESS_OS', 'sustenta', 'dependencia', null, null, null, null, '{}'::jsonb, null, '{}'),
    ('ativo_ti', servidor_chave, 'sistema', 'FORJA', 'sustenta', 'dependencia', null, null, null, null, '{}'::jsonb, null, '{}');
  -- Inventário de TI.
  insert into _nos
  select 'ativo_ti', a.id::text, a.nome, array_remove(array['ti', a.tipo, case when a.critico then 'critico' end], null), 'ti',
         jsonb_strip_nulls(jsonb_build_object('numero', a.numero, 'tipo', a.tipo, 'local', a.local, 'situacao', a.situacao, 'critico', a.critico, 'ip', a.ip)),
         '{ti.ativos,ti.saude,ti.chamados}', 'ti_ativos', a.id::text, '/?module=ti&secao=Invent%C3%A1rio'
    from public.ti_ativos a where a.organization_id = p_org and a.situacao <> 'baixado';
  insert into _lig
  select 'ativo_ti', a.id::text, 'setor', 'PRODUCAO', 'sustenta', 'dependencia', null, null, null, null, jsonb_build_object('por', 'coletor das CNCs'), null, '{}'
    from public.ti_ativos a where a.organization_id = p_org and a.situacao <> 'baixado' and a.tipo = 'coletor_cnc';
  insert into _lig
  select 'ativo_ti', a.id::text, 'sistema', case when a.nome ilike '%grv%' then 'GRV' when a.nome ilike '%forja%' then 'FORJA' else 'BUSINESS_OS' end, 'e', 'estrutura',
         null, null, null, null, '{}'::jsonb, null, '{}'
    from public.ti_ativos a where a.organization_id = p_org and a.situacao <> 'baixado' and a.tipo = 'sistema'
     and (a.nome ilike '%grv%' or a.nome ilike '%forja%' or a.nome ilike '%business%');
  -- As quedas dos últimos 30 dias no resumo do servidor (alarme falso não conta).
  update _nos set resumo = resumo || jsonb_strip_nulls(jsonb_build_object(
      'quedas_30d', (select count(*) from public.ti_incidentes i where i.organization_id = p_org and coalesce(i.categoria, '') <> 'alarme_falso'
                      and i.inicio > now() - interval '30 days' and (i.alvo = 'servidor-pecsil' or i.ativo_id::text = servidor_chave)),
      'ultima_queda', (select max(i.inicio)::date from public.ti_incidentes i where i.organization_id = p_org and coalesce(i.categoria, '') <> 'alarme_falso'
                        and (i.alvo = 'servidor-pecsil' or i.ativo_id::text = servidor_chave))))
   where tipo = 'ativo_ti' and chave = servidor_chave;

  -- Pessoas e o que cada uma aprova ou opera (das permissões; o proprietário passa em tudo e não vira ligação).
  insert into _nos
  select 'pessoa', p.id::text, p.full_name,
         array_remove(array['pessoa', case when p.is_owner then 'proprietario' end, nullif(p.job_title, ''), p.account_type], null), null,
         jsonb_strip_nulls(jsonb_build_object('cargo', nullif(p.job_title, ''), 'conta', p.account_type, 'proprietario', case when p.is_owner then true end)),
         '{}', 'profiles', p.id::text, null
    from public.profiles p
   where p.organization_id = p_org and p.status = 'active' and p.email not like '%@pecsil-teste.local'
     and (p.is_owner or exists (select 1 from public.user_feature_grants g where g.profile_id = p.id));
  insert into _lig
  select 'pessoa', g.profile_id::text, 'setor', upper(f.module_code),
         case when max(g.level) = 'aprovar' then 'aprova' else 'opera' end, 'responsabilidade', count(*)::int, null, null, null,
         jsonb_build_object('funcionalidades', jsonb_agg(f.label || ' (' || g.level::text || ')' order by f.sort)), 'user_feature_grants', '{}'
    from public.user_feature_grants g
    join public.access_features f on f.code = g.feature_code
    join public.profiles p on p.id = g.profile_id
   where g.organization_id = p_org and p.status = 'active' and p.email not like '%@pecsil-teste.local'
     and g.level in ('operar', 'aprovar') and f.code !~ '\.(sara|coleta)$'
     and f.module_code in ('compras', 'financeiro', 'comercial', 'almoxarifado', 'fiscal', 'rh', 'portaria', 'producao', 'fundicao', 'ti')
   group by g.profile_id, f.module_code;

  -- Cadeia 1: compra até o pagamento (docs/PROCESSOS-PECSIL.md, definida pelo proprietário em 01/10/2026).
  insert into _nos values ('processo', 'CADEIA_1', 'Compra até o pagamento (Cadeia 1)', '{processo,cadeia,compras}', null,
    jsonb_build_object('definida_em', '2026-10-01', 'passos', 6), '{}', null, null, null);
  insert into _lig
  select 'processo', 'CADEIA_1', 'setor', s.setor, 'passa_por', 'estrutura', null, null, null, null, jsonb_build_object('passos', s.passos), null, '{}'
    from (values ('ALMOXARIFADO', '1. pede o material · 5. confere e lança a nota'), ('FUNDICAO', '1b. pede o material da Fundição'),
                 ('COMPRAS', '2. cota · 3. o gestor aprova · 4. aviso de compra'), ('FINANCEIRO', '6. paga'), ('FISCAL', 'a nota entra no Painel do ICMS')) s(setor, passos);
  insert into _lig
  select 'setor', d.de, 'setor', d.para, 'alimenta', 'dependencia', null, null, null, null, jsonb_build_object('por', d.por, 'processo', 'Cadeia 1'), null, '{}'
    from (values ('COMPRAS', 'ALMOXARIFADO', 'o material comprado chega para o Almoxarifado receber'),
                 ('ALMOXARIFADO', 'FINANCEIRO', 'a conta a pagar real nasce do recebimento da nota'),
                 ('ALMOXARIFADO', 'FISCAL', 'a nota recebida entra no Painel do ICMS'),
                 ('ALMOXARIFADO', 'FUNDICAO', 'o material da Fundição chega pelo Almoxarifado')) d(de, para, por);

  -- Documentos e o que eles citam.
  insert into _nos
  select 'documento', d.id::text, d.title, array_remove(array['documento', d.module_code, lower(nullif(d.category, ''))], null), d.module_code,
         jsonb_strip_nulls(jsonb_build_object('arquivo', d.original_name, 'enviado_em', d.created_at::date, 'por', d.uploaded_by_name)),
         array[d.feature_code], 'company_documents', d.id::text, '/?view=Documentos'
    from public.company_documents d where d.organization_id = p_org and d.archived_at is null;
  insert into _lig
  select 'documento', d.id::text, 'setor', upper(d.module_code), 'pertence_a', 'estrutura', null, null, null, null, '{}'::jsonb, null, '{}'
    from public.company_documents d where d.organization_id = p_org and d.archived_at is null
     and upper(d.module_code) in ('COMPRAS', 'FINANCEIRO', 'COMERCIAL', 'ALMOXARIFADO', 'FISCAL', 'RH', 'PORTARIA', 'PRODUCAO', 'FUNDICAO', 'TI');
  insert into _lig
  select 'documento', x.documento, 'fornecedor', x.fornecedor, 'cita', 'mencao', count(*)::int, null, null, null,
         jsonb_build_object('como', string_agg(distinct x.rule, ', ')), null, '{}'
    from (select l.document_id::text documento, l.rule,
                 case when l.target_type = 'fornecedor' then l.target_id::text
                      else (select e.supplier_id::text from public.fiscal_icms_entries e where e.id::text = l.target_id::text) end fornecedor
            from public.company_document_links l join public.company_documents d on d.id = l.document_id and d.archived_at is null
           where l.organization_id = p_org and l.status in ('ativa', 'confirmada') and l.target_type in ('fornecedor', 'nota_icms')) x
   where x.fornecedor is not null
   group by x.documento, x.fornecedor;

  -- Produção: o cliente encomendou a peça (as OS somadas).
  insert into _lig
  select 'cliente', o.customer_id::text, 'produto', p.id::text, 'encomendou', 'transacao', count(*)::int, null, min(o.opened_at)::date, max(o.opened_at)::date,
         jsonb_strip_nulls(jsonb_build_object('pecas', sum(o.quantity), 'em_producao', nullif(count(*) filter (where o.status = 'em_producao'), 0),
           'abertas', nullif(count(*) filter (where o.status = 'aberta'), 0), 'rascunho', nullif(count(*) filter (where o.status = 'rascunho'), 0))), 'production_orders',
         (array_agg(o.id::text order by o.opened_at desc nulls last))[1:50]
    from public.production_orders o
    join public.products p on p.organization_id = o.organization_id and p.codigo = o.article_code and p.customer_id = o.customer_id
   where o.organization_id = p_org and o.removed_from_source_at is null and o.customer_id is not null
   group by o.customer_id, p.id;
end;
$$;
revoke all on function public.cerebro_montar_mais(uuid) from public, anon, authenticated;

-- --- Montagem: a mesma da G1, agora chamando a G4 e limpando os tipos novos -----------------------
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

  -- G4: setores, sistemas, servidor e inventário de TI, pessoas e permissões, Cadeia 1, documentos, OS.
  perform public.cerebro_montar_mais(p_org);

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
       and c.tipo in ('fornecedor', 'cliente', 'item', 'material', 'produto', 'conta', 'setor', 'pessoa', 'documento', 'ativo_ti', 'sistema', 'processo')
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

-- --- Registros de origem: agora também as OS ----------------------------------------------------
create or replace function public.cerebro_registros(p_tabela text, p_ids text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  if p_tabela = 'compras' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', 'compra', 'data', c.data_compra, 'titulo', c.produto,
        'detalhe', concat_ws(' · ', trim_scale(c.quantidade)::text || ' ' || coalesce(c.unidade, ''), 'NF ' || nullif(c.nf, '')), 'valor', c.total, 'valor_unit', c.valor_unit,
        'link', '/?module=compras&secao=Realizadas') order by c.data_compra desc)
      from public.compras c where c.organization_id = public.current_organization_id() and c.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'cotacoes' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'tipo', 'cotação', 'data', k.created_at::date, 'titulo', k.produto,
        'detalhe', concat_ws(' · ', case k.status when 'PENDENTE' then 'pendente' when 'APROVADO' then 'aprovada' when 'REJEITADO' then 'rejeitada' when 'COMPRADO' then 'comprada' else lower(k.status) end,
          case k.divisao when 'FUNDICAO' then 'Fundição' when 'USINAGEM' then 'Usinagem' else k.divisao end, nullif(k.prazo, '')), 'valor_unit', k.valor_unit, 'link', '/?module=compras&secao=Cota%C3%A7%C3%B5es') order by k.created_at desc)
      from public.cotacoes k where k.organization_id = public.current_organization_id() and k.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'finance_titles' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'tipo', case when t.direction::text = 'payable' then 'conta a pagar' else 'conta a receber' end,
        'data', t.issue_date, 'titulo', coalesce(nullif(t.description, ''), t.counterparty_name), 'detalhe', concat_ws(' · ', nullif(t.document_number, ''), case t.status::text when 'settled' then 'quitado' when 'approved' then 'em aberto'
          when 'pending_approval' then 'em aprovação' when 'partially_settled' then 'pago em parte' when 'overdue' then 'vencido' when 'cancelled' then 'cancelado'
          when 'draft' then 'rascunho' else t.status::text end),
        'valor', t.original_amount, 'link', case when t.direction::text = 'payable' then '/?module=financeiro&secao=Contas%20a%20pagar' else '/?module=financeiro&secao=Contas%20a%20receber' end)
        order by t.issue_date desc)
      from public.finance_titles t where t.organization_id = public.current_organization_id() and t.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'production_orders' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'tipo', 'OS', 'data', o.opened_at::date, 'titulo', coalesce(o.code, '') || ' · ' || coalesce(o.article_description, o.article_code, ''),
        'detalhe', concat_ws(' · ', trim_scale(o.quantity)::text || ' peça(s)', case o.status when 'aberta' then 'aberta' when 'em_producao' then 'em produção' when 'rascunho' then 'rascunho' else o.status end,
          case when o.due_date is not null then 'prazo ' || to_char(o.due_date, 'DD/MM/YYYY') end),
        'link', '/?module=producao&secao=Ordens%20de%20servi%C3%A7o') order by o.opened_at desc)
      from public.production_orders o where o.organization_id = public.current_organization_id() and o.id::text = any (p_ids)), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
revoke all on function public.cerebro_registros(text, text[]) from public, anon;
grant execute on function public.cerebro_registros(text, text[]) to authenticated;

-- --- G3: a ficha do cérebro nas telas dos módulos --------------------------------------------------
-- Fora do War Room, a ficha segue a permissão de cada módulo: aparece para quem pode ver o registro
-- de origem (coluna exige do nó), e cada número e cada ligação só para quem tem a permissão da área
-- dele (o que foi pago e o que está em aberto, só com o Financeiro; compras e preços, com o Compras
-- ou o Almoxarifado). Quem tem o War Room vê tudo (W2).
create or replace function public.cerebro_pode_ver(p_exige text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('warroom.cerebro') or exists (select 1 from unnest(coalesce(p_exige, '{}')) f where public.has_feature(f))
$$;

create or replace function public.cerebro_ficha(p_tipo text, p_chave text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  n public.cerebro_nos;
  tudo boolean := public.has_feature('warroom.cerebro');
  fin_pagar boolean := tudo or public.has_feature('financeiro.pagar');
  fin_receber boolean := tudo or public.has_feature('financeiro.receber') or public.has_feature('comercial.cobranca');
  compras boolean := tudo or public.has_feature('compras.cotacoes') or public.has_feature('compras.realizadas') or public.has_feature('compras.fornecedores')
                     or public.has_feature('compras.aprovacoes') or public.has_feature('almoxarifado.materiais') or public.has_feature('almoxarifado.recebimento');
  fora text[] := '{}';
begin
  if org is null then return null; end if;
  select * into n from public.cerebro_nos where organization_id = org and tipo = p_tipo and chave = p_chave;
  if n.id is null or not public.cerebro_pode_ver(n.exige) then return null; end if;
  if not fin_pagar and n.tipo = 'fornecedor' then fora := fora || array['titulos', 'lancado', 'pago', 'em_aberto', 'primeiro_lancamento', 'ultimo_lancamento']; end if;
  if not fin_receber and n.tipo = 'cliente' then fora := fora || array['titulos', 'faturado', 'recebido', 'em_aberto', 'vencido', 'atraso_medio_dias', 'ultimo_lancamento']; end if;
  if not compras and n.tipo in ('fornecedor', 'item', 'material') then
    fora := fora || array['compras', 'comprado', 'ultima_compra', 'cotacoes', 'ultimo_preco', 'menor_preco', 'maior_preco', 'fornecedores'];
  end if;
  return jsonb_build_object(
    'no', jsonb_build_object('id', n.id, 'tipo', n.tipo, 'chave', n.chave, 'nome', n.nome, 'termos', n.termos, 'resumo', n.resumo - fora, 'grau', n.grau),
    'ligacoes', coalesce((
      select jsonb_agg(x.j order by x.peso desc nulls last) from (
        select jsonb_build_object('tipo', l.tipo, 'familia', l.familia, 'de_origem', l.origem = n.id,
                 'outro', jsonb_build_object('tipo', o.tipo, 'chave', o.chave, 'nome', o.nome, 'link', o.link),
                 'quantidade', l.quantidade, 'total', l.total, 'primeira', l.primeira, 'ultima', l.ultima, 'resumo', l.resumo) j,
               coalesce(l.total, l.quantidade, 0) peso
          from public.cerebro_ligacoes l
          join public.cerebro_nos o on o.id = case when l.origem = n.id then l.destino else l.origem end
         where (l.origem = n.id or l.destino = n.id)
           and public.cerebro_pode_ver(o.exige)
           and (l.tipo <> 'lancado_em' or (n.tipo = 'fornecedor' and fin_pagar) or (n.tipo = 'cliente' and fin_receber) or tudo)
           and (l.tipo not in ('vendeu', 'cotou') or compras)
         order by coalesce(l.total, l.quantidade, 0) desc nulls last
         limit 200) x), '[]'::jsonb));
end $$;
revoke all on function public.cerebro_ficha(text, text) from public, anon;
grant execute on function public.cerebro_ficha(text, text) to authenticated;
revoke all on function public.cerebro_pode_ver(text[]) from public, anon;
grant execute on function public.cerebro_pode_ver(text[]) to authenticated;

-- Histórico de preço de um item (para a SARA e as telas): lê as compras com a sessão de quem pergunta
-- (o RLS das compras vale), junta os nomes iguais do mesmo item e traz cada fornecedor com o preço.
create or replace function public.cerebro_historico_preco(p_termo text, p_desde date default null, p_limite integer default 8)
returns jsonb
language sql stable security invoker set search_path = public, extensions as $$
  with c as (
    select public.cerebro_item_chave(c.produto) item, c.produto, s.name fornecedor, c.valor_unit, c.unidade, c.quantidade, c.total, c.data_compra
      from public.compras c join public.suppliers s on s.id = c.supplier_id
     where public.sem_acento(c.produto) ilike '%' || public.sem_acento(trim(coalesce(p_termo, ''))) || '%'
       and length(trim(coalesce(p_termo, ''))) >= 2 and (p_desde is null or c.data_compra >= p_desde)),
  itens as (
    select item, (array_agg(produto order by data_compra desc nulls last))[1] nome, count(*) compras, round(sum(total), 2) comprado, max(data_compra) ultima from c group by item
     order by count(*) desc, max(data_compra) desc limit least(greatest(coalesce(p_limite, 8), 1), 30))
  select coalesce(jsonb_agg(jsonb_build_object(
           'item', i.nome, 'compras', i.compras, 'comprado', i.comprado, 'ultima_compra', i.ultima,
           'por_fornecedor', (select jsonb_agg(jsonb_build_object('fornecedor', f.fornecedor, 'compras', f.n, 'menor', f.menor, 'maior', f.maior,
                                'ultimo', f.ultimo, 'unidade', f.unidade, 'ultima_compra', f.ultima) order by f.ultimo)
                                from (select fornecedor, count(*) n, min(valor_unit) menor, max(valor_unit) maior, max(unidade) unidade, max(data_compra) ultima,
                                             (array_agg(valor_unit order by data_compra desc nulls last))[1] ultimo
                                        from c where c.item = i.item group by fornecedor) f),
           'compras_recentes', (select jsonb_agg(jsonb_build_object('data', r.data_compra, 'fornecedor', r.fornecedor, 'preco', r.valor_unit, 'quantidade', trim_scale(r.quantidade), 'unidade', r.unidade) order by r.data_compra desc)
                                  from (select * from c where c.item = i.item order by data_compra desc nulls last limit 12) r))
         order by i.compras desc), '[]'::jsonb)
    from itens i
$$;
revoke all on function public.cerebro_historico_preco(text, date, integer) from public, anon;
grant execute on function public.cerebro_historico_preco(text, date, integer) to authenticated;

-- Achar o nó pelo nome (para a SARA): só entre os que a pessoa pode ver.
create or replace function public.cerebro_ficha_buscar(p_tipo text, p_termo text)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('chave', x.chave, 'nome', x.nome) order by x.r desc, x.grau desc), '[]'::jsonb)
    from (select n.chave, n.nome, n.grau,
                 (case when public.sem_acento(n.nome) = public.sem_acento(trim(p_termo)) then 3 when public.sem_acento(n.nome) like public.sem_acento(trim(p_termo)) || '%' then 2 else 0 end
                  + similarity(public.sem_acento(trim(p_termo)), public.sem_acento(n.nome))) r
            from public.cerebro_nos n
           where n.organization_id = public.current_organization_id() and n.tipo = p_tipo and length(trim(coalesce(p_termo, ''))) >= 2
             and (public.sem_acento(n.nome) like '%' || public.sem_acento(trim(p_termo)) || '%' or public.sem_acento(trim(p_termo)) <<% public.sem_acento(n.nome))
             and public.cerebro_pode_ver(n.exige)
           order by r desc, n.grau desc limit 5) x
$$;
revoke all on function public.cerebro_ficha_buscar(text, text) from public, anon;
grant execute on function public.cerebro_ficha_buscar(text, text) to authenticated;

-- --- Pulsos do Segundo Cérebro (War Room) ------------------------------------------------------------
-- O que acontece na empresa acende o grafo: cada evento de um módulo, cada consulta de uma SARA e cada
-- ligação nova ou alterada viram um "pulso" no setor (ou na ligação) correspondente. Só para o War Room.
create or replace function public.cerebro_no_json(n public.cerebro_nos) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', n.id, 'tipo', n.tipo, 'chave', n.chave, 'nome', n.nome, 'termos', n.termos, 'setor', n.setor, 'resumo', n.resumo,
    'grau', n.grau, 'link', n.link, 'x', n.x, 'y', n.y)
$$;

create or replace function public.cerebro_pulsos(p_desde timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  desde timestamptz := greatest(coalesce(p_desde, now() - interval '2 hours'), now() - interval '7 days');
begin
  if org is null or not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(p order by (p->>'em') desc) from (
    (select jsonb_build_object('em', e.occurred_at, 'tipo', 'evento', 'setor', upper(e.module_code), 'texto', e.summary) p
       from public.module_events e
      where e.organization_id = org and e.occurred_at > desde
        and e.module_code in ('compras', 'financeiro', 'comercial', 'almoxarifado', 'fiscal', 'rh', 'portaria', 'producao', 'fundicao', 'ti')
      order by e.occurred_at desc limit 60)
    union all
    (select jsonb_build_object('em', m.created_at, 'tipo', 'sara', 'setor', upper(c.modulo),
             'texto', 'SARA ' || c.modulo || ' consultou ' || coalesce((select string_agg(distinct u->>'nome', ', ')
                        from jsonb_array_elements(coalesce(m.ferramentas -> 'usadas', '[]'::jsonb)) u
                       where u->>'nome' not in ('abrir_tela', 'mostrar', 'registrar_lacuna', 'propor_habilidade')), 'o próprio conhecimento')) p
       from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
      where c.organization_id = org and m.papel = 'sara' and m.created_at > desde
      order by m.created_at desc limit 40)
    union all
    (select jsonb_build_object('em', greatest(l.created_at, l.updated_at), 'tipo', 'ligacao', 'ligacao', l.id, 'origem', l.origem, 'destino', l.destino,
             'texto', o.nome || ' → ' || d.nome || ' (' || l.tipo || ')') p
       from public.cerebro_ligacoes l join public.cerebro_nos o on o.id = l.origem join public.cerebro_nos d on d.id = l.destino
      where l.organization_id = org and greatest(l.created_at, l.updated_at) > desde
      order by greatest(l.created_at, l.updated_at) desc limit 40)
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.cerebro_pulsos(timestamptz) from public, anon;
grant execute on function public.cerebro_pulsos(timestamptz) to authenticated;

-- A vizinhança cabe as peças de um cliente grande (o catálogo interno tem 3,9 mil): limite de 6 mil pontos.
-- Vizinhança de um nó, até 3 passos, isolando por tipo de nó, tipo e família de ligação e período.
create or replace function public.cerebro_vizinhanca(p_no uuid, p_profundidade integer default 1, p_tipos_no text[] default null,
  p_tipos_ligacao text[] default null, p_familias text[] default null, p_desde date default null, p_limite integer default 400)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  prof int := least(greatest(coalesce(p_profundidade, 1), 1), 3);
  lim int := least(greatest(coalesce(p_limite, 400), 1), 6000);
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
