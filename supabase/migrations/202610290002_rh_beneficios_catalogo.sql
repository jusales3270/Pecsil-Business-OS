-- RH: catálogo inicial de benefícios (proprietário, 29/10/2026).
--
--   * A lista "Benefício" da nova movimentação (RH › Benefícios) lê rh_benefit_plans, que estava vazia:
--     a lista aparecia em branco e nenhuma solicitação podia ser feita.
--   * Entram os 5 benefícios pedidos, um registro por empresa, sem fornecedor nem custo (a área completa
--     depois). Reexecutável: o nome é único por empresa e o que já existir não é tocado.

insert into public.rh_benefit_plans (organization_id, name, category, monthly_cost, status, active)
select o.id, b.name, b.category::public.rh_benefit_category, 0, 'active', true
from public.organizations o
cross join (values
  ('Refeição', 'food'),
  ('Seguro de vida', 'protection'),
  ('Vale-transporte', 'mobility'),
  ('Convênio médico', 'health'),
  ('Convênio odontológico', 'health')
) as b(name, category)
on conflict (organization_id, name) do nothing;
