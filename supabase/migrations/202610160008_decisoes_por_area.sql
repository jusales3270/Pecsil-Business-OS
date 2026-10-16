-- Decisões vão para quem responde pela área, não para o proprietário (pedido do proprietário,
-- 16/10/2026: "eu sou o dono da plataforma, mas só cuido da construção e do gerenciamento de
-- recursos; decisões e dia a dia da empresa são de responsabilidade de seus membros").
--
-- O proprietário continua com o que é RECURSO e PLATAFORMA: acessos e permissões, infraestrutura,
-- caixas de e-mail conectadas, uso e custo da IA. Decisão do negócio passa a ser da área:
--   * Linha de base: cada indicador é revisado por quem responde pela área dele (Financeiro: quem
--     aprova contas; Compras: quem aprova cotações; Produção: quem lança a entrada de produção), que
--     é avisado para revisar.
--   * Comercial: numeração dos orçamentos e apagar o treino → quem opera os orçamentos.
--   * Fiscal: ligar a emissão em produção → quem aprova NF-e.
--   * Alçadas: sem exceção do proprietário; só o aprovador da regra decide o nível, e ninguém aprova
--     dois níveis do mesmo título.

-- ---------------------------------------------------------------------------------------------
-- 1. Linha de base por área
-- ---------------------------------------------------------------------------------------------
alter table public.indicadores_medicoes
  add column if not exists area text,
  add column if not exists responsavel_feature text,
  add column if not exists responsavel_nivel public.access_level;

-- Quem responde por cada indicador (uma regra só, usada no cálculo, na leitura e na correção).
create or replace function public.indicadores_area(p_chave text)
returns table (area text, feature text, nivel public.access_level)
language sql
immutable
set search_path = public
as $$
  select * from (values
    (case when p_chave like 'receber_%' then 'Financeiro · contas a receber'
          when p_chave like 'pagar_%' or p_chave like 'pagamentos_%' then 'Financeiro · contas a pagar'
          when p_chave = 'custo_por_peca' then 'Financeiro · custo'
          when p_chave like 'compras_%' then 'Compras'
          when p_chave in ('entrega_no_prazo_pct', 'maquina_parada_horas', 'orcamento_a_os_dias') then 'Produção'
          else 'Financeiro' end,
     case when p_chave like 'receber_%' then 'financeiro.receber'
          when p_chave like 'compras_%' then 'compras.aprovacoes'
          when p_chave in ('entrega_no_prazo_pct', 'maquina_parada_horas', 'orcamento_a_os_dias') then 'producao.entrada'
          else 'financeiro.pagar' end,
     case when p_chave like 'compras_%' or p_chave like 'receber_%' or p_chave like 'pagar_%' or p_chave like 'pagamentos_%' or p_chave = 'custo_por_peca'
          then 'aprovar' else 'operar' end::public.access_level)
  ) as x(area, feature, nivel);
$$;

update public.indicadores_medicoes m set
  area = (select a.area from public.indicadores_area(m.chave) a),
  responsavel_feature = (select a.feature from public.indicadores_area(m.chave) a),
  responsavel_nivel = (select a.nivel from public.indicadores_area(m.chave) a)
where m.responsavel_feature is null;

drop function if exists public.indicadores_calcular(uuid, date);
create or replace function public.indicadores_calcular(p_org uuid, p_fim date default current_date)
returns table (chave text, rotulo text, valor numeric, unidade text, periodo_inicio date, fonte text, como text, detalhes jsonb, area text, responsavel_feature text, responsavel_nivel public.access_level)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ini date := (p_fim - interval '12 months')::date;
begin
  return query
  with abertos as (
    select t.direction, t.is_historical, i.due_date, (i.amount - i.settled_amount) as saldo
    from public.finance_titles t
    join public.finance_installments i on i.title_id = t.id
    where t.organization_id = p_org and t.status <> 'cancelled' and not coalesce(t.is_forecast, false) and t.archived_at is null
      and i.status not in ('settled', 'cancelled') and i.amount > i.settled_amount and t.issue_date <= p_fim
  ),
  receber as (
    select coalesce(sum(saldo) filter (where not coalesce(is_historical, false)), 0) as total,
           coalesce(sum(saldo) filter (where not coalesce(is_historical, false) and due_date < p_fim), 0) as vencido,
           coalesce(sum(saldo) filter (where not coalesce(is_historical, false) and due_date < p_fim - 90), 0) as vencido90,
           coalesce(sum(saldo) filter (where coalesce(is_historical, false)), 0) as a_conferir
    from abertos where direction = 'receivable'
  ),
  pagar as (
    select coalesce(sum(saldo) filter (where not coalesce(is_historical, false)), 0) as total,
           coalesce(sum(saldo) filter (where not coalesce(is_historical, false) and due_date < p_fim), 0) as vencido
    from abertos where direction = 'payable'
  ),
  pagamentos as (
    select i.due_date, max(s.settlement_date) as pago_em
    from public.finance_settlements s
    join public.finance_installments i on i.id = s.installment_id
    join public.finance_titles t on t.id = i.title_id
    where t.organization_id = p_org and t.direction = 'payable' and s.reversed_at is null and i.status = 'settled'
      and s.settlement_date > ini and s.settlement_date <= p_fim
    group by i.id, i.due_date
  ),
  pag as (
    select count(*) as n, count(*) filter (where pago_em <= due_date) as em_dia,
           avg(pago_em - due_date) filter (where pago_em > due_date) as atraso_medio
    from pagamentos
  ),
  cot as (
    select count(*) as n, avg(extract(epoch from (c.data_decisao - c.created_at)) / 86400) as dias
    from public.cotacoes c
    where c.organization_id = p_org and c.deleted_at is null and c.data_decisao is not null and coalesce(c.origem, '') <> 'direta'
      and c.created_at::date > ini and c.created_at::date <= p_fim
  ),
  ciclo as (
    select count(*) as n, avg(extract(epoch from (cp.created_at - mr.created_at)) / 86400) as dias
    from public.compras cp
    join public.cotacoes c on c.id = cp.cotacao_id
    join public.material_requests mr on mr.id = c.material_request_id
    where cp.organization_id = p_org and cp.created_at::date > ini and cp.created_at::date <= p_fim
  ),
  compras_mes as (
    select count(*) as n, min(cp.created_at)::date as desde
    from public.compras cp where cp.organization_id = p_org and cp.created_at::date > ini and cp.created_at::date <= p_fim
  )
  select v.*, a.area, a.feature, a.nivel from receber r, pagar p, pag, cot, ciclo, compras_mes cm, lateral (values
    ('receber_em_aberto', 'Contas a receber em aberto', round(r.total, 2), 'R$', null::date, 'Financeiro',
      'Saldo das parcelas a receber não quitadas (sem previsões, canceladas e históricos a conferir).', jsonb_build_object('historico_a_conferir', round(r.a_conferir, 2))),
    ('receber_vencido', 'Contas a receber vencidas', round(r.vencido, 2), 'R$', null::date, 'Financeiro',
      'Parte do em aberto com vencimento antes da data de corte.', jsonb_build_object('mais_de_90_dias', round(r.vencido90, 2))),
    ('receber_vencido_pct', 'Contas a receber vencidas (% do em aberto)', case when r.total > 0 then round(100 * r.vencido / r.total, 1) end, '%', null::date, 'Financeiro',
      'Vencido ÷ em aberto.', '{}'::jsonb),
    ('pagar_em_aberto', 'Contas a pagar em aberto', round(p.total, 2), 'R$', null::date, 'Financeiro',
      'Saldo das parcelas a pagar não quitadas (sem previsões, canceladas e históricos a conferir).', '{}'::jsonb),
    ('pagar_vencido', 'Contas a pagar vencidas', round(p.vencido, 2), 'R$', null::date, 'Financeiro',
      'Parte do a pagar com vencimento antes da data de corte.', '{}'::jsonb),
    ('pagamentos_em_dia_pct', 'Pagamentos feitos até o vencimento', case when pag.n > 0 then round(100.0 * pag.em_dia / pag.n, 1) end, '%', ini, 'Financeiro',
      'Parcelas a pagar quitadas nos 12 meses: data da última baixa até o vencimento.', jsonb_build_object('parcelas', pag.n)),
    ('pagamentos_atraso_medio', 'Atraso médio dos pagamentos atrasados', round(pag.atraso_medio, 1), 'dias', ini, 'Financeiro',
      'Média de dias entre o vencimento e a baixa, só das parcelas pagas depois do vencimento.', '{}'::jsonb),
    ('compras_cotacao_decisao', 'Da cotação lançada à decisão (aprovar ou recusar)', round(cot.dias, 1), 'dias', ini, 'Compras',
      'Média de dias entre lançar a cotação e a decisão do gestor (sem compras diretas).', jsonb_build_object('cotacoes', cot.n)),
    ('compras_pedido_a_compra', 'Do pedido de material à compra registrada', round(ciclo.dias, 1), 'dias', ini, 'Compras',
      'Média de dias entre a solicitação do almoxarifado e a compra. Sem valor enquanto nenhuma compra estiver ligada a um pedido (passa a medir com o A-01).', jsonb_build_object('compras', ciclo.n)),
    ('compras_itens_por_mes', 'Itens comprados por mês', case when cm.n > 0 then round(cm.n / greatest(1, (p_fim - cm.desde) / 30.0), 1) end, 'itens/mês', cm.desde, 'Compras',
      'Itens de compra registrados na plataforma ÷ meses desde o primeiro (cada linha de compra é um item).', jsonb_build_object('itens', cm.n)),
    ('entrega_no_prazo_pct', 'OS entregues no prazo', null::numeric, '%', null::date, 'Sem fonte ainda',
      'Precisa das OS e entregas do GRV (exportação pedida ao Jefferson) ou da Forja em produção (go-live).', '{}'::jsonb),
    ('maquina_parada_horas', 'Tempo de máquina parada', null::numeric, 'horas/mês', null::date, 'Sem fonte ainda',
      'Precisa da Forja em produção (apontamento de paradas no Tótem).', '{}'::jsonb),
    ('custo_por_peca', 'Custo real por peça', null::numeric, 'R$/peça', null::date, 'Sem fonte ainda',
      'Precisa do custo e margem (Marco 2: K-02 a K-05).', '{}'::jsonb),
    ('orcamento_a_os_dias', 'Do orçamento ganho à OS liberada', null::numeric, 'dias', null::date, 'Sem fonte ainda',
      'Orçamentos ainda no GRV; passa a medir quando o comercial virar para a plataforma.', '{}'::jsonb)
  ) as v(chave, rotulo, valor, unidade, periodo_inicio, fonte, como, detalhes)
  cross join lateral public.indicadores_area(v.chave) a;
end;
$$;
revoke all on function public.indicadores_calcular(uuid, date) from public, anon, authenticated;

-- Avisa cada área para revisar a linha de base: um aviso por pessoa e por área (Financeiro,
-- Compras, Produção), para quem tem a permissão que decide aquela área.
create or replace function public.indicadores_avisar(p_org uuid, p_except uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
  select distinct on (g.profile_id, split_part(m.area, ' · ', 1)) p_org, g.profile_id, 'foundation', 'approval',
    format('Revise a linha de base · %s', split_part(m.area, ' · ', 1)),
    'Confira os números de antes da virada da sua área e corrija o que estiver errado no dado de origem (com o motivo).',
    '/?view=Linha%20de%20base'
  from public.indicadores_medicoes m
  join public.user_feature_grants g on g.organization_id = m.organization_id and g.feature_code = m.responsavel_feature and g.level >= m.responsavel_nivel
  join public.profiles p on p.id = g.profile_id and p.status = 'active' and (p.access_expires_at is null or p.access_expires_at > now())
  where m.organization_id = p_org and m.tipo = 'linha_de_base' and m.responsavel_feature is not null
    and (p_except is null or g.profile_id <> p_except);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.indicadores_avisar(uuid, uuid) from public, anon, authenticated;

-- Quem pode registrar uma medição ou recalcular (é conta, não julgamento): quem responde por
-- alguma das áreas.
create or replace function public.indicadores_pode_medir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature('financeiro.pagar', 'aprovar') or public.has_feature('financeiro.receber', 'aprovar')
      or public.has_feature('compras.aprovacoes', 'aprovar') or public.has_feature('producao.entrada', 'operar');
$$;
grant execute on function public.indicadores_pode_medir() to authenticated;

drop policy if exists indicadores_medicoes_read on public.indicadores_medicoes;
create policy indicadores_medicoes_read on public.indicadores_medicoes for select to authenticated
using (organization_id = public.current_organization_id() and (
  public.is_owner() or public.has_feature('financeiro.relatorios') or public.indicadores_pode_medir()
  or (responsavel_feature is not null and public.has_feature(responsavel_feature))
));

create or replace function public.indicadores_registrar(p_tipo text default 'medicao', p_fim date default current_date, p_substituir boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  n int;
begin
  if org is null or not public.indicadores_pode_medir() then
    raise exception 'Registrar indicadores é de quem responde pelas áreas (Financeiro, Compras ou Produção).' using errcode = '42501';
  end if;
  if p_tipo not in ('linha_de_base', 'medicao') then raise exception 'Tipo inválido.'; end if;
  if p_tipo = 'linha_de_base' and exists (select 1 from public.indicadores_medicoes where organization_id = org and tipo = 'linha_de_base') then
    if not p_substituir then raise exception 'A linha de base já foi registrada.'; end if;
    delete from public.indicadores_medicoes where organization_id = org and tipo = 'linha_de_base' and editado_em is null;
  end if;
  insert into public.indicadores_medicoes (organization_id, tipo, chave, rotulo, valor, valor_calculado, unidade, periodo_inicio, periodo_fim, fonte, como, detalhes, medido_por, area, responsavel_feature, responsavel_nivel)
  select org, p_tipo, c.chave, c.rotulo, c.valor, c.valor, c.unidade, c.periodo_inicio, p_fim, c.fonte, c.como, c.detalhes, me, c.area, c.responsavel_feature, c.responsavel_nivel
  from public.indicadores_calcular(org, p_fim) c
  where p_tipo = 'medicao' or not exists (
    select 1 from public.indicadores_medicoes m where m.organization_id = org and m.tipo = 'linha_de_base' and m.chave = c.chave);
  get diagnostics n = row_count;
  perform public.emit_module_event(org, 'foundation', 'indicadores.' || p_tipo || '.registrada', 'indicadores', p_fim::text,
    format('%s registrada com %s indicadores (corte %s)', case when p_tipo = 'linha_de_base' then 'Linha de base' else 'Medição' end, n, to_char(p_fim, 'DD/MM/YYYY')),
    jsonb_build_object('substituiu', p_substituir));
  -- Linha de base nova ou refeita: cada área é avisada para revisar os seus números.
  if p_tipo = 'linha_de_base' then perform public.indicadores_avisar(org, me); end if;
  return n;
end;
$$;

create or replace function public.indicadores_editar(p_id uuid, p_valor numeric, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  m public.indicadores_medicoes%rowtype;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da correção.'; end if;
  select * into m from public.indicadores_medicoes where id = p_id and organization_id = org for update;
  if m.id is null then raise exception 'Indicador não encontrado.'; end if;
  if m.responsavel_feature is null or not public.has_feature(m.responsavel_feature, m.responsavel_nivel) then
    raise exception 'Este indicador é revisado pela área %.', coalesce(m.area, '—') using errcode = '42501';
  end if;
  update public.indicadores_medicoes
  set valor = p_valor, editado_em = now(), editado_por = me, motivo_edicao = left(trim(p_motivo), 500)
  where id = m.id;
  perform public.emit_module_event(org, 'foundation', 'indicadores.valor.corrigido', 'indicadores', m.chave,
    format('Indicador corrigido · %s: %s → %s', m.rotulo, coalesce(m.valor::text, 'sem valor'), coalesce(p_valor::text, 'sem valor')),
    jsonb_build_object('chave', m.chave, 'anterior', m.valor, 'calculado', m.valor_calculado, 'novo', p_valor, 'motivo', trim(p_motivo), 'area', m.area));
end;
$$;

create or replace function public.indicadores_desfazer_edicao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  m public.indicadores_medicoes%rowtype;
begin
  select * into m from public.indicadores_medicoes where id = p_id and organization_id = org for update;
  if m.id is null then raise exception 'Indicador não encontrado.'; end if;
  if m.responsavel_feature is null or not public.has_feature(m.responsavel_feature, m.responsavel_nivel) then
    raise exception 'Este indicador é revisado pela área %.', coalesce(m.area, '—') using errcode = '42501';
  end if;
  update public.indicadores_medicoes set valor = valor_calculado, editado_em = null, editado_por = null, motivo_edicao = null where id = m.id;
  perform public.emit_module_event(org, 'foundation', 'indicadores.valor.corrigido', 'indicadores', m.chave,
    format('Indicador volta ao calculado · %s', m.rotulo), jsonb_build_object('chave', m.chave, 'valor', m.valor_calculado, 'area', m.area));
end;
$$;

-- O aviso às áreas sobre a linha de base já registrada (16/10) sai DEPOIS do deploy da tela de
-- revisão por área (select public.indicadores_avisar(<org>, null)), para o link não chegar quebrado.

-- ---------------------------------------------------------------------------------------------
-- 2. Comercial: numeração e treino são de quem opera os orçamentos
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comercial_orcamento_definir_proximo(p_numero bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_feature('comercial.orcamentos', 'operar') then raise exception 'A numeração dos orçamentos é de quem opera os orçamentos no Comercial.' using errcode = '42501'; end if;
  if p_numero < 1 or exists (select 1 from public.sales_quotes where organization_id = public.current_organization_id() and numero >= p_numero) then
    raise exception 'Use um número maior que o do último orçamento.';
  end if;
  insert into public.sales_quote_numbering (organization_id, proximo) values (public.current_organization_id(), p_numero)
  on conflict (organization_id) do update set proximo = p_numero, updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.comercial_treino_apagar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org uuid := public.current_organization_id();
  quotes uuid[];
  docs uuid[];
  caminhos text[];
  notas uuid[];
  n_quotes int; n_notas int; n_docs int;
begin
  if not public.has_feature('comercial.orcamentos', 'operar') then raise exception 'Apagar o treino é de quem opera os orçamentos no Comercial.' using errcode = '42501'; end if;
  select coalesce(array_agg(id), '{}') into quotes from public.sales_quotes where organization_id = org and treino;
  select coalesce(array_agg(distinct document_id), '{}') into docs from public.sales_quote_attachments where quote_id = any(quotes);
  select coalesce(array_agg(storage_path), '{}') into caminhos from public.company_documents where id = any(docs);
  select coalesce(array_agg(id), '{}') into notas from public.fiscal_nfe where organization_id = org and ambiente = 'treino';
  n_quotes := cardinality(quotes); n_notas := cardinality(notas); n_docs := cardinality(docs);
  -- OS de treino na Forja: a sincronização apaga o rascunho lá (o que nunca chegou só sai da fila).
  update public.forja_os_envios set status = case when forja_os_id is null then 'cancelado' else 'cancelar' end,
         tentativas = 0, proxima_tentativa = now(), ultimo_erro = null, updated_at = now()
   where quote_id = any(quotes) and status <> 'cancelado';
  perform set_config('pecsil.orcamento_situacao', 'on', true);
  delete from public.fiscal_nfe_origens where nfe_id = any(notas) or quote_item_id in (select id from public.sales_quote_items where quote_id = any(quotes));
  delete from public.fiscal_nfe_eventos where nfe_id = any(notas);
  delete from public.fiscal_nfe where id = any(notas);
  delete from public.fiscal_nfe_numeracao where organization_id = org and ambiente = 'treino';
  delete from public.production_entries where organization_id = org and treino;
  delete from public.sales_quote_attachments where quote_id = any(quotes);
  delete from public.sales_quote_notes where quote_id = any(quotes);
  delete from public.sales_quote_items where quote_id = any(quotes);
  delete from public.sales_quotes where id = any(quotes);
  delete from public.company_document_links where document_id = any(docs);
  delete from public.company_document_texts where document_id = any(docs);
  delete from public.company_documents where id = any(docs);
  delete from public.notifications where organization_id = org and title like 'TREINO · %';
  update public.sales_quote_numbering set proximo_treino = 1 where organization_id = org;
  perform set_config('pecsil.orcamento_situacao', 'off', true);
  return jsonb_build_object('orcamentos', n_quotes, 'notas', n_notas, 'documentos', n_docs, 'arquivos', to_jsonb(caminhos));
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Fiscal: ligar a emissão em produção é de quem aprova NF-e
-- ---------------------------------------------------------------------------------------------
create or replace function public.fiscal_config_salvar(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  atual public.fiscal_config%rowtype;
  so_digitos text;
begin
  if org is null or not public.has_feature('fiscal.config', 'operar') then
    raise exception 'Sem permissão para alterar a configuração fiscal.' using errcode = '42501';
  end if;
  insert into public.fiscal_config (organization_id) values (org) on conflict (organization_id) do nothing;
  select * into atual from public.fiscal_config where organization_id = org for update;

  if p ? 'ambiente' and p ->> 'ambiente' = 'producao' and atual.ambiente <> 'producao' and not public.has_feature('fiscal.nfe', 'aprovar') then
    raise exception 'Ligar a emissão em produção é de quem aprova NF-e no Fiscal.' using errcode = '42501';
  end if;

  update public.fiscal_config set
    razao_social = case when p ? 'razao_social' then nullif(upper(trim(p ->> 'razao_social')), '') else razao_social end,
    nome_fantasia = case when p ? 'nome_fantasia' then nullif(trim(p ->> 'nome_fantasia'), '') else nome_fantasia end,
    cnpj = case when p ? 'cnpj' then nullif(regexp_replace(coalesce(p ->> 'cnpj', ''), '\D', '', 'g'), '') else cnpj end,
    ie = case when p ? 'ie' then nullif(case when upper(trim(p ->> 'ie')) = 'ISENTO' then 'ISENTO' else regexp_replace(coalesce(p ->> 'ie', ''), '\D', '', 'g') end, '') else ie end,
    im = case when p ? 'im' then nullif(trim(p ->> 'im'), '') else im end,
    cnae = case when p ? 'cnae' then nullif(regexp_replace(coalesce(p ->> 'cnae', ''), '\D', '', 'g'), '') else cnae end,
    crt = case when p ? 'crt' then nullif(p ->> 'crt', '')::smallint else crt end,
    logradouro = case when p ? 'logradouro' then nullif(trim(p ->> 'logradouro'), '') else logradouro end,
    numero = case when p ? 'numero' then nullif(trim(p ->> 'numero'), '') else numero end,
    complemento = case when p ? 'complemento' then nullif(trim(p ->> 'complemento'), '') else complemento end,
    bairro = case when p ? 'bairro' then nullif(trim(p ->> 'bairro'), '') else bairro end,
    codigo_municipio = case when p ? 'codigo_municipio' then nullif(regexp_replace(coalesce(p ->> 'codigo_municipio', ''), '\D', '', 'g'), '') else codigo_municipio end,
    municipio = case when p ? 'municipio' then nullif(upper(trim(p ->> 'municipio')), '') else municipio end,
    uf = case when p ? 'uf' then nullif(upper(trim(p ->> 'uf')), '') else uf end,
    cep = case when p ? 'cep' then nullif(regexp_replace(coalesce(p ->> 'cep', ''), '\D', '', 'g'), '') else cep end,
    telefone = case when p ? 'telefone' then nullif(regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g'), '') else telefone end,
    email = case when p ? 'email' then nullif(lower(trim(p ->> 'email')), '') else email end,
    ambiente = case when p ? 'ambiente' then p ->> 'ambiente' else ambiente end,
    serie_padrao = case when p ? 'serie_padrao' then (p ->> 'serie_padrao')::int else serie_padrao end,
    dfe_ativo = case when p ? 'dfe_ativo' then (p ->> 'dfe_ativo')::boolean else dfe_ativo end,
    ciencia_automatica = case when p ? 'ciencia_automatica' then (p ->> 'ciencia_automatica')::boolean else ciencia_automatica end,
    doc_telefones = case when p ? 'doc_telefones' then nullif(trim(p ->> 'doc_telefones'), '') else doc_telefones end,
    doc_site = case when p ? 'doc_site' then nullif(lower(trim(p ->> 'doc_site')), '') else doc_site end,
    doc_email_nfe = case when p ? 'doc_email_nfe' then nullif(lower(trim(p ->> 'doc_email_nfe')), '') else doc_email_nfe end,
    doc_notas_ordem_compra = case when p ? 'doc_notas_ordem_compra' then nullif(trim(p ->> 'doc_notas_ordem_compra'), '') else doc_notas_ordem_compra end,
    updated_by = me,
    updated_at = now()
  where organization_id = org;

  -- Próximo número da série padrão (para continuar a numeração do sistema anterior).
  if p ? 'proximo_numero' and nullif(p ->> 'proximo_numero', '') is not null then
    so_digitos := regexp_replace(p ->> 'proximo_numero', '\D', '', 'g');
    insert into public.fiscal_series (organization_id, serie, proximo_numero)
    values (org, (select serie_padrao from public.fiscal_config where organization_id = org), so_digitos::bigint)
    on conflict (organization_id, serie) do update set proximo_numero = excluded.proximo_numero, updated_at = now();
  end if;

  perform public.emit_module_event(org, 'fiscal', 'fiscal.config.alterada', 'fiscal_config', org::text,
    'Configuração fiscal alterada', jsonb_build_object('campos', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Alçadas sem exceção do proprietário
-- ---------------------------------------------------------------------------------------------
create or replace function public.finance_pode_decidir(p_rule public.finance_approval_rules, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_rule.approver_profile_id is not null and p_rule.approver_profile_id = p_profile)
    or (p_rule.approver_role_id is not null and exists (
          select 1 from public.user_roles ur
          where ur.profile_id = p_profile and ur.role_id = p_rule.approver_role_id
            and (ur.valid_from is null or ur.valid_from <= now()) and (ur.valid_until is null or ur.valid_until > now())))
    or (p_rule.approver_profile_id is null and p_rule.approver_role_id is null);
$$;

create or replace function public.finance_aprovar_titulo(p_title uuid, p_decisao text default 'aprovar', p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  titulo public.finance_titles%rowtype;
  regra public.finance_approval_rules%rowtype;
  nivel int;
  niveis int[];
  feitos int[];
  candidata boolean := false;
  restantes int;
  rotulo text;
begin
  if p_decisao not in ('aprovar', 'recusar') then raise exception 'Decisão inválida.'; end if;
  select * into titulo from public.finance_titles where id = p_title and organization_id = org for update;
  if titulo.id is null then raise exception 'Título não encontrado.'; end if;
  if not public.has_feature(public.finance_direction_feature(titulo.direction), 'aprovar') then
    raise exception 'Sem permissão para aprovar.' using errcode = '42501';
  end if;
  if titulo.status <> 'pending_approval' then raise exception 'Este título não está em aprovação.'; end if;
  if p_decisao = 'recusar' and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  rotulo := case when titulo.direction = 'payable' then 'Conta a pagar' else 'Conta a receber' end;

  select array_agg(distinct r.approval_level order by r.approval_level) into niveis
  from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r;

  -- Sem alçada: uma etapa só, como sempre foi.
  if niveis is null then
    if p_decisao = 'recusar' then raise exception 'Sem alçada configurada: para recusar, cancele o título.'; end if;
    perform set_config('pecsil.financeiro_aprovacao', '1', true);
    update public.finance_titles set status = 'approved', approved_at = now(), approved_by_profile_id = me where id = titulo.id;
    perform set_config('pecsil.financeiro_aprovacao', '', true);
    return jsonb_build_object('aprovado', true, 'faltam', 0);
  end if;

  select coalesce(array_agg(approval_level), '{}') into feitos
  from public.finance_approval_requests where title_id = titulo.id and installment_id is null and status = 'approved';
  select min(n) into nivel from unnest(niveis) n where not (n = any(feitos));
  if nivel is null then nivel := niveis[array_length(niveis, 1)]; end if;

  -- A mesma pessoa não decide dois níveis do mesmo título (vale para todos).
  if exists (
    select 1 from public.finance_approval_requests
    where title_id = titulo.id and status = 'approved' and decided_by_profile_id = me
  ) then
    raise exception 'Você já aprovou um nível deste título: o nível % é de outra pessoa.', nivel using errcode = '42501';
  end if;

  for regra in select * from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r where r.approval_level = nivel loop
    if public.finance_pode_decidir(regra, me) then candidata := true; exit; end if;
  end loop;
  if not candidata then
    select * into regra from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r where r.approval_level = nivel limit 1;
    raise exception 'O nível % desta alçada (%) é de %.', nivel, regra.name,
      coalesce((select full_name from public.profiles where id = regra.approver_profile_id),
               (select name from public.roles where id = regra.approver_role_id), 'outra pessoa')
      using errcode = '42501';
  end if;

  insert into public.finance_approval_requests (organization_id, title_id, rule_id, approval_level, status, requested_by_profile_id, decided_by_profile_id, decided_at, reason)
  values (org, titulo.id, regra.id, nivel, case when p_decisao = 'aprovar' then 'approved' else 'rejected' end::public.finance_approval_status,
          titulo.created_by_profile_id, me, now(), nullif(trim(coalesce(p_motivo, '')), ''));

  if p_decisao = 'recusar' then
    perform public.emit_module_event(org, 'financeiro', 'financeiro.titulo.recusado', 'finance_title', titulo.id::text,
      format('%s recusada no nível %s · %s', rotulo, nivel, titulo.counterparty_name), jsonb_build_object('nivel', nivel, 'motivo', p_motivo));
    if titulo.created_by_profile_id is not null and titulo.created_by_profile_id <> me then
      insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
      values (org, titulo.created_by_profile_id, 'financeiro', 'attention', format('%s recusada · %s', rotulo, titulo.counterparty_name),
              format('Nível %s · %s', nivel, p_motivo), '/?module=financeiro');
    end if;
    return jsonb_build_object('aprovado', false, 'recusado', true, 'nivel', nivel);
  end if;

  select count(*) into restantes from unnest(niveis) n where not (n = any(feitos || nivel));
  if restantes = 0 then
    perform set_config('pecsil.financeiro_aprovacao', '1', true);
    update public.finance_titles set status = 'approved', approved_at = now(), approved_by_profile_id = me where id = titulo.id;
    perform set_config('pecsil.financeiro_aprovacao', '', true);
    return jsonb_build_object('aprovado', true, 'faltam', 0, 'nivel', nivel);
  end if;

  -- Avisa quem decide o próximo nível.
  select min(n) into nivel from unnest(niveis) n where not (n = any(feitos || nivel));
  select * into regra from public.finance_regras_do_titulo(org, titulo.direction, titulo.original_amount) r where r.approval_level = nivel limit 1;
  if regra.approver_profile_id is not null then
    insert into public.notifications (organization_id, recipient_profile_id, module_code, severity, title, body, action_url)
    values (org, regra.approver_profile_id, 'financeiro', 'approval', format('%s aguarda o seu nível · %s', rotulo, titulo.counterparty_name),
            format('Nível %s (%s) · R$ %s', nivel, regra.name, public.brl(titulo.original_amount)), '/?module=financeiro');
  else
    perform public.notify_feature(org, public.finance_direction_feature(titulo.direction), 'aprovar', 'financeiro', 'approval',
      format('%s aguarda o nível %s · %s', rotulo, nivel, titulo.counterparty_name),
      format('%s · R$ %s', regra.name, public.brl(titulo.original_amount)), '/?module=financeiro', me);
  end if;
  return jsonb_build_object('aprovado', false, 'faltam', restantes, 'proximoNivel', nivel);
end;
$$;

-- Cadastro das alçadas: da Homologação do Financeiro (o proprietário só dá o acesso).
create or replace function public.finance_alcada_salvar(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_min numeric := coalesce(nullif(p ->> 'min_amount', '')::numeric, 0);
  v_max numeric := nullif(p ->> 'max_amount', '')::numeric;
  v_dir public.finance_title_direction := nullif(p ->> 'direction', '')::public.finance_title_direction;
  v_pessoa uuid := nullif(p ->> 'approver_profile_id', '')::uuid;
  v_papel uuid := nullif(p ->> 'approver_role_id', '')::uuid;
begin
  if org is null or not public.has_feature('financeiro.homologacao', 'operar') then
    raise exception 'Alçadas são da Homologação do Financeiro.' using errcode = '42501';
  end if;
  if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Dê um nome à alçada.'; end if;
  if v_max is not null and v_max <= v_min then raise exception 'O valor até tem de ser maior que o valor a partir de.'; end if;
  if v_pessoa is not null and not exists (select 1 from public.profiles where id = v_pessoa and organization_id = org) then
    raise exception 'Pessoa não encontrada.';
  end if;
  if v_id is null then
    insert into public.finance_approval_rules (organization_id, name, direction, min_amount, max_amount, approval_level, approver_role_id, approver_profile_id, active)
    values (org, trim(p ->> 'name'), v_dir, v_min, v_max, coalesce(nullif(p ->> 'approval_level', '')::int, 1), v_papel, v_pessoa, coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update public.finance_approval_rules set
      name = trim(p ->> 'name'), direction = v_dir, min_amount = v_min, max_amount = v_max,
      approval_level = coalesce(nullif(p ->> 'approval_level', '')::int, approval_level),
      approver_role_id = v_papel, approver_profile_id = v_pessoa,
      active = coalesce((p ->> 'active')::boolean, active)
    where id = v_id and organization_id = org;
    if not found then raise exception 'Alçada não encontrada.'; end if;
  end if;
  perform public.emit_module_event(org, 'financeiro', 'financeiro.alcada.alterada', 'finance_approval_rule', v_id::text,
    format('Alçada %s gravada', trim(p ->> 'name')), p);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Permissão DA ÁREA (sem o atalho do proprietário): has_feature deixa o proprietário passar em
--    tudo, o que é certo para ver e administrar, mas decisão de área exige a permissão dada à
--    pessoa. Usado na linha de base.
-- ---------------------------------------------------------------------------------------------
create or replace function public.tem_permissao_da_area(p_feature text, p_level public.access_level default 'ver')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_feature_grants g
    where g.profile_id = public.current_profile_id() and g.feature_code = p_feature and g.level >= p_level
  );
$$;
grant execute on function public.tem_permissao_da_area(text, public.access_level) to authenticated;

create or replace function public.indicadores_pode_medir()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.tem_permissao_da_area('financeiro.pagar', 'aprovar') or public.tem_permissao_da_area('financeiro.receber', 'aprovar')
      or public.tem_permissao_da_area('compras.aprovacoes', 'aprovar') or public.tem_permissao_da_area('producao.entrada', 'operar');
$$;

create or replace function public.indicadores_editar(p_id uuid, p_valor numeric, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  m public.indicadores_medicoes%rowtype;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da correção.'; end if;
  select * into m from public.indicadores_medicoes where id = p_id and organization_id = org for update;
  if m.id is null then raise exception 'Indicador não encontrado.'; end if;
  if m.responsavel_feature is null or not public.tem_permissao_da_area(m.responsavel_feature, m.responsavel_nivel) then
    raise exception 'Este indicador é revisado pela área %.', coalesce(m.area, '—') using errcode = '42501';
  end if;
  update public.indicadores_medicoes
  set valor = p_valor, editado_em = now(), editado_por = me, motivo_edicao = left(trim(p_motivo), 500)
  where id = m.id;
  perform public.emit_module_event(org, 'foundation', 'indicadores.valor.corrigido', 'indicadores', m.chave,
    format('Indicador corrigido · %s: %s → %s', m.rotulo, coalesce(m.valor::text, 'sem valor'), coalesce(p_valor::text, 'sem valor')),
    jsonb_build_object('chave', m.chave, 'anterior', m.valor, 'calculado', m.valor_calculado, 'novo', p_valor, 'motivo', trim(p_motivo), 'area', m.area));
end;
$$;

create or replace function public.indicadores_desfazer_edicao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  m public.indicadores_medicoes%rowtype;
begin
  select * into m from public.indicadores_medicoes where id = p_id and organization_id = org for update;
  if m.id is null then raise exception 'Indicador não encontrado.'; end if;
  if m.responsavel_feature is null or not public.tem_permissao_da_area(m.responsavel_feature, m.responsavel_nivel) then
    raise exception 'Este indicador é revisado pela área %.', coalesce(m.area, '—') using errcode = '42501';
  end if;
  update public.indicadores_medicoes set valor = valor_calculado, editado_em = null, editado_por = null, motivo_edicao = null where id = m.id;
  perform public.emit_module_event(org, 'foundation', 'indicadores.valor.corrigido', 'indicadores', m.chave,
    format('Indicador volta ao calculado · %s', m.rotulo), jsonb_build_object('chave', m.chave, 'valor', m.valor_calculado, 'area', m.area));
end;
$$;
