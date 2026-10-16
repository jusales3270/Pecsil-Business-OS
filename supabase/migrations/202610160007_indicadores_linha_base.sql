-- K-08 (roadmap) · Visão de produto P3.2: a "linha de base" do antes × depois, registrada ANTES da
-- virada do GRV. Cada medição guarda o número, como foi calculado e de onde veio. Medir de novo
-- depois de cada fase usa a mesma conta (indicadores_calcular), então o antes e o depois comparam
-- igual com igual.
--
-- O que ainda não tem fonte na plataforma (pontualidade de entrega das OS, tempo parado de máquina,
-- custo por peça, tempo do orçamento à OS) fica registrado sem valor, com o motivo: vira número
-- quando a fonte existir (exportações do GRV, go-live da Forja, custo e margem).

create table if not exists public.indicadores_medicoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo text not null check (tipo in ('linha_de_base', 'medicao')),
  chave text not null check (chave ~ '^[a-z0-9_]{3,60}$'),
  rotulo text not null,
  valor numeric,
  unidade text not null,
  periodo_inicio date,
  periodo_fim date not null,
  fonte text not null,
  como text not null,
  detalhes jsonb not null default '{}'::jsonb,
  medido_em timestamptz not null default now(),
  medido_por uuid references public.profiles(id) on delete set null,
  -- Revisão: o proprietário pode corrigir um valor (com motivo). O calculado fica guardado.
  valor_calculado numeric,
  editado_em timestamptz,
  editado_por uuid references public.profiles(id) on delete set null,
  motivo_edicao text check (motivo_edicao is null or length(motivo_edicao) <= 500)
);
create unique index if not exists uq_indicadores_linha_de_base
  on public.indicadores_medicoes (organization_id, chave) where tipo = 'linha_de_base';
create index if not exists idx_indicadores_medicoes_org on public.indicadores_medicoes (organization_id, chave, medido_em);

alter table public.indicadores_medicoes enable row level security;
drop policy if exists indicadores_medicoes_read on public.indicadores_medicoes;
create policy indicadores_medicoes_read on public.indicadores_medicoes for select to authenticated
using (organization_id = public.current_organization_id() and (public.is_owner() or public.has_feature('financeiro.relatorios')));
revoke insert, update, delete on public.indicadores_medicoes from anon, authenticated;

-- A conta de cada indicador, numa data de corte. Estoques (em aberto, vencido) são fotografia do
-- dia; fluxos (pagamentos, compras) olham os 12 meses até o corte.
create or replace function public.indicadores_calcular(p_org uuid, p_fim date default current_date)
returns table (chave text, rotulo text, valor numeric, unidade text, periodo_inicio date, fonte text, como text, detalhes jsonb)
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
  select v.* from receber r, pagar p, pag, cot, ciclo, compras_mes cm, lateral (values
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
  ) as v(chave, rotulo, valor, unidade, periodo_inicio, fonte, como, detalhes);
end;
$$;
revoke all on function public.indicadores_calcular(uuid, date) from public, anon, authenticated;

-- Registrar: só o proprietário. A linha de base é uma só por indicador (registrar de novo exige
-- p_substituir, que fica na trilha); "medicao" pode repetir quantas vezes quiser. Ao substituir a
-- linha de base, o indicador corrigido à mão continua como está (só os calculados são refeitos).
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
  if org is null or not public.is_owner() then raise exception 'Só o proprietário registra indicadores.' using errcode = '42501'; end if;
  if p_tipo not in ('linha_de_base', 'medicao') then raise exception 'Tipo inválido.'; end if;
  if p_tipo = 'linha_de_base' and exists (select 1 from public.indicadores_medicoes where organization_id = org and tipo = 'linha_de_base') then
    if not p_substituir then raise exception 'A linha de base já foi registrada.'; end if;
    delete from public.indicadores_medicoes where organization_id = org and tipo = 'linha_de_base' and editado_em is null;
  end if;
  insert into public.indicadores_medicoes (organization_id, tipo, chave, rotulo, valor, valor_calculado, unidade, periodo_inicio, periodo_fim, fonte, como, detalhes, medido_por)
  select org, p_tipo, c.chave, c.rotulo, c.valor, c.valor, c.unidade, c.periodo_inicio, p_fim, c.fonte, c.como, c.detalhes, me
  from public.indicadores_calcular(org, p_fim) c
  where p_tipo = 'medicao' or not exists (
    select 1 from public.indicadores_medicoes m where m.organization_id = org and m.tipo = 'linha_de_base' and m.chave = c.chave);
  get diagnostics n = row_count;
  perform public.emit_module_event(org, 'foundation', 'indicadores.' || p_tipo || '.registrada', 'indicadores', p_fim::text,
    format('%s registrada com %s indicadores (corte %s)', case when p_tipo = 'linha_de_base' then 'Linha de base' else 'Medição' end, n, to_char(p_fim, 'DD/MM/YYYY')),
    jsonb_build_object('substituiu', p_substituir));
  return n;
end;
$$;
revoke all on function public.indicadores_registrar(text, date, boolean) from public, anon;
grant execute on function public.indicadores_registrar(text, date, boolean) to authenticated;

-- Corrigir o valor de um indicador (revisão do proprietário). Motivo obrigatório; o calculado fica
-- em valor_calculado e a correção vai para a trilha. p_valor nulo = "sem valor".
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
  if org is null or not public.is_owner() then raise exception 'Só o proprietário corrige indicadores.' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da correção.'; end if;
  select * into m from public.indicadores_medicoes where id = p_id and organization_id = org for update;
  if m.id is null then raise exception 'Indicador não encontrado.'; end if;
  update public.indicadores_medicoes
  set valor = p_valor, editado_em = now(), editado_por = me, motivo_edicao = left(trim(p_motivo), 500)
  where id = m.id;
  perform public.emit_module_event(org, 'foundation', 'indicadores.valor.corrigido', 'indicadores', m.chave,
    format('Indicador corrigido · %s: %s → %s', m.rotulo, coalesce(m.valor::text, 'sem valor'), coalesce(p_valor::text, 'sem valor')),
    jsonb_build_object('chave', m.chave, 'anterior', m.valor, 'calculado', m.valor_calculado, 'novo', p_valor, 'motivo', trim(p_motivo)));
end;
$$;
revoke all on function public.indicadores_editar(uuid, numeric, text) from public, anon;
grant execute on function public.indicadores_editar(uuid, numeric, text) to authenticated;

-- Voltar ao calculado: desfaz a correção manual de um indicador.
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
  if org is null or not public.is_owner() then raise exception 'Só o proprietário corrige indicadores.' using errcode = '42501'; end if;
  select * into m from public.indicadores_medicoes where id = p_id and organization_id = org for update;
  if m.id is null then raise exception 'Indicador não encontrado.'; end if;
  update public.indicadores_medicoes set valor = valor_calculado, editado_em = null, editado_por = null, motivo_edicao = null where id = m.id;
  perform public.emit_module_event(org, 'foundation', 'indicadores.valor.corrigido', 'indicadores', m.chave,
    format('Indicador volta ao calculado · %s', m.rotulo), jsonb_build_object('chave', m.chave, 'valor', m.valor_calculado));
end;
$$;
revoke all on function public.indicadores_desfazer_edicao(uuid) from public, anon;
grant execute on function public.indicadores_desfazer_edicao(uuid) to authenticated;
