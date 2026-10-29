-- RH: valor do benefício em cada movimentação (proprietário, 29/10/2026).
--
--   * Na nova movimentação de benefícios, o RH digita o valor mensal de cada benefício do colaborador
--     (ex.: Refeição R$ 600,00) e pode lançar vários benefícios no mesmo formulário: cada benefício vira
--     uma solicitação, com o seu valor.
--   * Vazio quando não se aplica (cancelamento) e nas solicitações antigas.

alter table public.rh_benefit_requests
  add column if not exists monthly_value numeric(18,2);

alter table public.rh_benefit_requests
  drop constraint if exists rh_benefit_requests_monthly_value_ck;
alter table public.rh_benefit_requests
  add constraint rh_benefit_requests_monthly_value_ck check (monthly_value is null or monthly_value >= 0);

comment on column public.rh_benefit_requests.monthly_value is
  'Valor mensal do benefício para o colaborador, digitado pelo RH na movimentação (R$). Nulo no cancelamento.';
