-- Bancos e conciliação: leitura rápida com o volume real do extrato.
--
-- As regras de acesso de contas bancárias, lançamentos do extrato e conciliações
-- chamavam as funções de permissão uma vez POR LINHA. Com o extrato do Itaú
-- (1.800+ lançamentos) a tela estourava o limite de 8 s do banco e abria vazia —
-- o mesmo problema que o contas a pagar teve (202609300004).
--
-- A regra é a mesma, só muda a forma: cada função vai dentro de `(select ...)`,
-- calculada uma vez por consulta. Quem via continua vendo, quem não via continua sem ver.

alter policy finance_bank_accounts_read on public.finance_bank_accounts using (
  organization_id = (select public.current_organization_id())
  and (select public.can_access_module('financeiro'))
  and (select public.has_permission('financeiro', 'view'))
);
alter policy finance_bank_accounts_manage on public.finance_bank_accounts
  using (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')));

alter policy finance_bank_entries_read on public.finance_bank_entries using (
  organization_id = (select public.current_organization_id())
  and (select public.can_access_module('financeiro'))
  and (select public.has_permission('financeiro', 'view'))
);
alter policy finance_bank_entries_create on public.finance_bank_entries
  with check (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')));
alter policy finance_bank_entries_update on public.finance_bank_entries
  using (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')));

alter policy finance_reconciliations_read on public.finance_reconciliations using (
  organization_id = (select public.current_organization_id())
  and (select public.can_access_module('financeiro'))
  and (select public.has_permission('financeiro', 'view'))
);
alter policy finance_reconciliations_create on public.finance_reconciliations
  with check (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')));
alter policy finance_reconciliations_update on public.finance_reconciliations
  using (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')))
  with check (organization_id = (select public.current_organization_id()) and (select public.has_permission('financeiro', 'reconcile')));
