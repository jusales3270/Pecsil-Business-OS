-- RH: tipo de contrato e período de experiência no cadastro do colaborador (proprietário, 28/10/2026).
--
--   * O cadastro passa a guardar o tipo de contrato: CLT (efetivo; a admissão é a data em que efetivou) ou
--     Experiência (ainda não é efetivo da empresa: período de 60 ou 90 dias contado do início, sem data de
--     admissão até virar CLT). Cadastros antigos ficam sem tipo ("Não informado") até alguém editar.
--   * O fim do período é calculado (início + dias − 1: o primeiro dia conta).
--   * Dois dias antes do fim, quem decide no RH (sara_responsaveis) recebe o aviso no sino; o mesmo aviso
--     entra no Bom dia (sino e WhatsApp) pela SARA do RH. rh_experiencia_avisos guarda o que já foi avisado
--     para o sino não repetir; só o servidor grava e lê.

alter table public.employees
  add column if not exists contract_type text,
  add column if not exists experiencia_inicio date,
  add column if not exists experiencia_dias smallint;

alter table public.employees drop constraint if exists employees_contract_type_ck;
alter table public.employees add constraint employees_contract_type_ck check (contract_type in ('clt', 'experiencia'));
alter table public.employees drop constraint if exists employees_experiencia_dias_ck;
alter table public.employees add constraint employees_experiencia_dias_ck check (experiencia_dias in (60, 90));
-- Experiência exige início e período. Quem efetivou (virou CLT) guarda o período que cumpriu, como histórico.
alter table public.employees drop constraint if exists employees_experiencia_ck;
alter table public.employees add constraint employees_experiencia_ck check (
  contract_type is distinct from 'experiencia' or (experiencia_inicio is not null and experiencia_dias is not null));

alter table public.employees add column if not exists experiencia_fim date
  generated always as (experiencia_inicio + (experiencia_dias - 1)) stored;

comment on column public.employees.contract_type is 'clt (efetivo) ou experiencia (período de 60/90 dias, ainda não efetivo). Nulo = cadastro antigo, não informado.';
comment on column public.employees.experiencia_fim is 'Último dia do período de experiência (início + dias − 1).';

create index if not exists employees_experiencia_fim_idx on public.employees (experiencia_fim) where contract_type = 'experiencia';

create table if not exists public.rh_experiencia_avisos (
  employee_id uuid not null references public.employees(id) on delete cascade,
  vence date not null,
  avisado_em timestamptz not null default now(),
  primary key (employee_id, vence)
);
comment on table public.rh_experiencia_avisos is 'Avisos de fim de experiência já enviados ao sino (um por colaborador e data de fim). Só o servidor.';
alter table public.rh_experiencia_avisos enable row level security;
