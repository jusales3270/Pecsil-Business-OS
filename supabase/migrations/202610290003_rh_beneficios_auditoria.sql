-- RH: o catálogo de benefícios passa pela Auditoria (proprietário, 29/10/2026).
--
--   * Os valores de cada benefício (custo mensal, fornecedor, contribuição, elegibilidade) passam a ser
--     digitados pelo RH na tela. Toda inclusão, alteração ou exclusão em rh_benefit_plans vira registro na
--     Auditoria, com quem fez, pelo mesmo gatilho das outras tabelas do RH (audit_rh_mutation).

drop trigger if exists rh_benefit_plans_audit on public.rh_benefit_plans;
create trigger rh_benefit_plans_audit after insert or update or delete on public.rh_benefit_plans
for each row execute function public.audit_rh_mutation();
