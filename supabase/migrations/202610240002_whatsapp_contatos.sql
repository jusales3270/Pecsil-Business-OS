-- WhatsApp: os números (canais) da Pecsil e as listas de quem fala com cada um (PLANO-WHATSAPP, W2; decisões do
-- proprietário em 24/10/2026).
--
-- Canal: um número de WhatsApp da plataforma (uma instância da Evolution), com nome, departamento, a descrição do
-- que ele atende e a SARA responsável por ele (ex.: um número só para o Comercial, outro para o atendimento a
-- clientes, outro para o Fiscal). O primeiro canal é o chip interno já conectado (instância pecsil-interno).
--
-- Listas de cada canal:
--   interna: o número de alguém da empresa, ligado ao usuário da plataforma. A SARA do canal responde com a
--            credencial desse usuário. Usuário desativado ou com acesso vencido: o número para de valer sozinho.
--   externa: fornecedores, clientes e outros, para os envios e as respostas autorizadas (API oficial, W5).
-- Número fora da lista do canal é ignorado em silêncio (W3). Cadastro à mão, só pelo proprietário.

create table if not exists public.whatsapp_canais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Nome da instância na Evolution (fixo depois de criado).
  instancia text not null check (instancia ~ '^pecsil-[a-z0-9-]{2,40}$'),
  nome text not null check (length(btrim(nome)) between 2 and 60),
  departamento text check (departamento is null or length(btrim(departamento)) between 2 and 60),
  descricao text check (descricao is null or length(descricao) <= 400),
  -- A SARA responsável (o módulo; "warroom" = SARA central). Sem SARA, o canal não responde ninguém.
  sara_modulo text check (sara_modulo is null or sara_modulo ~ '^[a-z_]{2,30}$'),
  -- whatsapp_web: chip pelo QR Code (Evolution/Baileys). api_oficial: número na API da Meta (W5).
  conexao text not null default 'whatsapp_web' check (conexao in ('whatsapp_web', 'api_oficial')),
  ativo boolean not null default true,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_canais_instancia_unica unique (instancia)
);

comment on table public.whatsapp_canais is 'Números de WhatsApp da plataforma (instâncias da Evolution), com departamento, descrição e a SARA responsável. Só o proprietário. PLANO-WHATSAPP.';

create table if not exists public.whatsapp_contatos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  canal_id uuid not null references public.whatsapp_canais(id) on delete cascade,
  lista text not null check (lista in ('interna', 'externa')),
  -- Formato do WhatsApp: 55 + DDD + número, só dígitos.
  numero text not null check (numero ~ '^55[1-9][0-9][0-9]{8,9}$'),
  -- Interna: o usuário da plataforma.
  profile_id uuid references public.profiles(id) on delete cascade,
  -- Externa: quem é e, se houver, o vínculo com o cadastro.
  nome text check (nome is null or length(btrim(nome)) between 2 and 120),
  categoria text check (categoria is null or categoria in ('fornecedor', 'cliente', 'outro')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  ativo boolean not null default true,
  observacao text check (observacao is null or length(observacao) <= 300),
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- No mesmo canal, um número está numa lista só.
  constraint whatsapp_contatos_numero_unico unique (canal_id, numero),
  constraint whatsapp_contatos_interna check (lista <> 'interna' or (profile_id is not null and supplier_id is null and customer_id is null and categoria is null)),
  constraint whatsapp_contatos_externa check (lista <> 'externa' or (profile_id is null and nome is not null and categoria is not null)),
  constraint whatsapp_contatos_vinculo check (supplier_id is null or customer_id is null)
);

comment on table public.whatsapp_contatos is 'Listas de cada número de WhatsApp (interna: usuários que falam com a SARA do canal; externa: fornecedores, clientes e outros). Só o proprietário. PLANO-WHATSAPP.';

create index if not exists whatsapp_contatos_canal on public.whatsapp_contatos (canal_id, lista);
create index if not exists whatsapp_contatos_profile on public.whatsapp_contatos (profile_id) where profile_id is not null;

drop trigger if exists whatsapp_canais_updated_at on public.whatsapp_canais;
create trigger whatsapp_canais_updated_at before update on public.whatsapp_canais
  for each row execute function public.set_updated_at();
drop trigger if exists whatsapp_contatos_updated_at on public.whatsapp_contatos;
create trigger whatsapp_contatos_updated_at before update on public.whatsapp_contatos
  for each row execute function public.set_updated_at();

alter table public.whatsapp_canais enable row level security;
alter table public.whatsapp_contatos enable row level security;

drop policy if exists whatsapp_canais_dono on public.whatsapp_canais;
create policy whatsapp_canais_dono on public.whatsapp_canais for all to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()))
  with check (organization_id = (select public.current_organization_id()) and (select public.is_owner()));

drop policy if exists whatsapp_contatos_dono on public.whatsapp_contatos;
create policy whatsapp_contatos_dono on public.whatsapp_contatos for all to authenticated
  using (organization_id = (select public.current_organization_id()) and (select public.is_owner()))
  with check (organization_id = (select public.current_organization_id()) and (select public.is_owner()));

revoke all on public.whatsapp_canais, public.whatsapp_contatos from anon;
grant select, insert, update, delete on public.whatsapp_canais, public.whatsapp_contatos to authenticated;

-- O chip interno já conectado (W1) vira o primeiro canal. A SARA responsável fica para o proprietário escolher.
insert into public.whatsapp_canais (organization_id, instancia, nome, departamento, descricao, sara_modulo, conexao)
select o.id, 'pecsil-interno', 'Chip interno', 'Comunicação interna', 'Primeiro número da plataforma, conectado em 24/10/2026.', null, 'whatsapp_web'
  from public.organizations o
 where not exists (select 1 from public.whatsapp_canais c where c.instancia = 'pecsil-interno')
 order by o.created_at
 limit 1;
