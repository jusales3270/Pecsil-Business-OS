-- RH: jornadas de trabalho padronizadas (proprietário, 28/10/2026).
--
--   * A jornada do colaborador deixa de ser uma lista fixa na tela ("Administrativo", "Turno A"...) e passa a
--     ser o cadastro de horários do Secullum (relógio de ponto): número do horário no Secullum e o texto do
--     horário, por empresa. O número é a chave para a futura integração com o ponto.
--   * employees.jornada_id: a jornada de cada colaborador. A carga inicial (Distribuição de Horários do
--     Secullum de 28/10/2026, 63 colaboradores) é feita por scripts/import-rh-jornadas-secullum.mjs.
--   * Lê quem é da empresa (a jornada aparece na ficha); grava quem opera RH › Colaboradores.

create table if not exists public.rh_jornadas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  numero integer not null check (numero > 0),
  nome text not null check (length(btrim(nome)) between 3 and 120),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, numero)
);
comment on table public.rh_jornadas is 'Jornadas de trabalho (horários do Secullum): número no relógio de ponto e o horário. Uma por número, por empresa.';

drop trigger if exists rh_jornadas_updated_at on public.rh_jornadas;
create trigger rh_jornadas_updated_at before update on public.rh_jornadas for each row execute function public.set_updated_at();

alter table public.rh_jornadas enable row level security;
drop policy if exists rh_jornadas_read on public.rh_jornadas;
create policy rh_jornadas_read on public.rh_jornadas for select to authenticated
using (organization_id = (select public.current_organization_id()));
drop policy if exists rh_jornadas_manage on public.rh_jornadas;
create policy rh_jornadas_manage on public.rh_jornadas for all to authenticated
using (organization_id = (select public.current_organization_id()) and public.has_feature('rh.colaboradores', 'operar'))
with check (organization_id = (select public.current_organization_id()) and public.has_feature('rh.colaboradores', 'operar'));
grant select, insert, update on public.rh_jornadas to authenticated;

alter table public.employees add column if not exists jornada_id uuid references public.rh_jornadas(id) on delete set null;
create index if not exists employees_jornada_idx on public.employees (jornada_id);
comment on column public.employees.jornada_id is 'Jornada de trabalho (rh_jornadas, horário do Secullum).';
