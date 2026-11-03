-- Vigia configurável pela tela (proprietário, 03/11/2026): dias e hora da rodada, ligar o envio pelo WhatsApp e a lista de
-- transmissão (só pessoas da empresa, da lista interna). Cada pessoa da lista recebe só os gargalos das áreas que as
-- credenciais dela enxergam; o sino (Decisões para você) segue como antes. Só o proprietário lê; quem grava é o servidor.

create table if not exists public.sara_vigia_config (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  dias smallint[] not null default '{1,2,3,4,5}' check (dias <@ '{0,1,2,3,4,5,6}'::smallint[]),
  hora text not null default '06:30' check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  whatsapp boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_name text
);

create table if not exists public.sara_vigia_transmissao (
  contato_id uuid primary key references public.whatsapp_contatos(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.sara_vigia_config enable row level security;
alter table public.sara_vigia_transmissao enable row level security;
revoke all on public.sara_vigia_config, public.sara_vigia_transmissao from anon, authenticated;
grant select on public.sara_vigia_config, public.sara_vigia_transmissao to authenticated;

drop policy if exists sara_vigia_config_dono on public.sara_vigia_config;
create policy sara_vigia_config_dono on public.sara_vigia_config for select to authenticated
using (organization_id = public.current_organization_id() and public.is_owner());
drop policy if exists sara_vigia_transmissao_dono on public.sara_vigia_transmissao;
create policy sara_vigia_transmissao_dono on public.sara_vigia_transmissao for select to authenticated
using (organization_id = public.current_organization_id() and public.is_owner());

-- Começa como está hoje: segunda a sexta, 6h30, sem WhatsApp.
insert into public.sara_vigia_config (organization_id) select id from public.organizations on conflict do nothing;
