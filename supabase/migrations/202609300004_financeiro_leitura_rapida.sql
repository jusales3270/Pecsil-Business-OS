-- Financeiro: leitura rápida com o volume real.
--
-- As regras de leitura chamavam as funções de acesso (has_feature, can_access_module,
-- current_organization_id) uma vez POR LINHA. Com 657 títulos passava; com a carga do
-- contas a pagar (6.287 títulos, 4.439 baixas) a tela estourava o limite de 8 s do banco
-- e abria vazia.
--
-- A regra é a mesma, só muda a forma: cada função vai dentro de `(select ...)`, o que faz
-- o banco calcular uma vez por consulta e reaproveitar. Quem via continua vendo, quem não
-- via continua sem ver.

alter policy finance_titles_read on public.finance_titles using (
  organization_id = (select public.current_organization_id())
  and (
    (direction = 'payable' and (select public.has_feature('financeiro.pagar')))
    or (direction = 'receivable' and (select public.has_feature('financeiro.receber')))
    or (select public.has_feature('financeiro.fluxo'))
    or (select public.has_feature('financeiro.relatorios'))
    or (select public.has_feature('financeiro.bancos'))
  )
);

alter policy finance_installments_read on public.finance_installments using (
  organization_id = (select public.current_organization_id())
  and (select public.can_access_module('financeiro'))
  and title_id in (select t.id from public.finance_titles t)
);

alter policy finance_settlements_read on public.finance_settlements using (
  organization_id = (select public.current_organization_id())
  and (
    (select public.has_feature('financeiro.bancos'))
    or installment_id in (select i.id from public.finance_installments i)
  )
);

alter policy finance_title_allocations_read on public.finance_title_allocations using (
  organization_id = (select public.current_organization_id())
  and title_id in (select t.id from public.finance_titles t)
);

alter policy finance_approval_requests_read on public.finance_approval_requests using (
  organization_id = (select public.current_organization_id())
  and title_id in (select t.id from public.finance_titles t)
);

-- Plano de contas: lido junto de cada título e de cada linha de rateio.
alter policy finance_chart_accounts_read on public.finance_chart_accounts using (
  organization_id = (select public.current_organization_id())
  and (select public.has_module('financeiro'))
);

-- As baixas são lidas a partir da parcela; faltava o índice desse caminho.
create index if not exists idx_finance_settlements_installment on public.finance_settlements (installment_id);
