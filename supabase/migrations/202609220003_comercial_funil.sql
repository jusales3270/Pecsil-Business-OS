-- ============================================================================
-- Comercial (CRM): funil em Kanban
-- ============================================================================
-- Card é o que se acompanha: um pedido, uma cobrança, uma dúvida. Ele nasce de
-- um e-mail (quando a conexão estiver ligada) ou à mão — o pedido que chega por
-- telefone ou pelo WhatsApp do diretor também precisa entrar na fila.
--
-- A posição dentro da coluna é um número fracionário (1000, 2000, 1500…):
-- mover um card grava UMA linha, não a coluna inteira. `lib/kanban/fractional-indexing.ts`
-- calcula o ponto médio e avisa quando a coluna precisa ser renumerada.
--
-- Fechar é decisão do banco, não da tela: um gatilho carimba `closed_at` e o
-- `status` a partir da etapa. Assim não existe card "ganho" sem data, nem card
-- perdido sem motivo — nem que alguém chame a API na mão.
-- ============================================================================

do $$ begin
  create type public.crm_stage_kind as enum ('aberto', 'ganho', 'perdido');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.crm_card_status as enum ('aberto', 'ganho', 'perdido');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.crm_card_origem as enum ('manual', 'email');
exception when duplicate_object then null; end $$;

-- --- Etapas do funil --------------------------------------------------------
create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  label text not null,
  position integer not null,
  kind public.crm_stage_kind not null default 'aberto',
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- Etapas iniciais, uma vez por organização.
insert into public.crm_stages (organization_id, code, label, position, kind)
select o.id, e.code, e.label, e.position, e.kind::public.crm_stage_kind
from public.organizations o
cross join (values
  ('triagem',    'Triagem',           10, 'aberto'),
  ('analise',    'Em análise',        20, 'aberto'),
  ('proposta',   'Proposta enviada',  30, 'aberto'),
  ('aguardando', 'Aguardando cliente',40, 'aberto'),
  ('ganho',      'Ganho',             50, 'ganho'),
  ('perdido',    'Perdido',           60, 'perdido')
) as e(code, label, position, kind)
on conflict (organization_id, code) do nothing;

-- --- Cards ------------------------------------------------------------------
create table if not exists public.crm_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.crm_stages(id) on delete restrict,
  title text not null,
  -- Mesma classificação dos e-mails: pedido, cobranca, duvida, outro.
  kind public.mail_kind not null default 'pedido',
  customer_id uuid references public.customers(id) on delete set null,
  value_cents bigint,
  due_date date,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  position numeric not null default 1000,
  status public.crm_card_status not null default 'aberto',
  lost_reason text,
  closed_at timestamptz,
  origem public.crm_card_origem not null default 'manual',
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_cards_titulo_preenchido check (btrim(title) <> ''),
  constraint crm_cards_valor_nao_negativo check (value_cents is null or value_cents >= 0),
  -- Fechado tem data; aberto não tem.
  constraint crm_cards_fechamento_coerente
    check ((status = 'aberto' and closed_at is null) or (status <> 'aberto' and closed_at is not null)),
  -- Perder exige dizer por quê; ganhar e abrir não carregam motivo.
  constraint crm_cards_motivo_da_perda
    check ((status = 'perdido' and btrim(coalesce(lost_reason, '')) <> '') or (status <> 'perdido' and lost_reason is null))
);

create index if not exists idx_crm_cards_coluna on public.crm_cards(organization_id, stage_id, position);
create index if not exists idx_crm_cards_customer on public.crm_cards(customer_id);
create index if not exists idx_crm_cards_abertos on public.crm_cards(organization_id, status, updated_at desc);

drop trigger if exists crm_cards_updated_at on public.crm_cards;
create trigger crm_cards_updated_at before update on public.crm_cards
for each row execute function public.set_updated_at();

-- --- Linha do tempo do card -------------------------------------------------
create table if not exists public.crm_card_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  card_id uuid not null references public.crm_cards(id) on delete cascade,
  kind text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_crm_card_activities_card on public.crm_card_activities(card_id, occurred_at desc);

-- Liga e-mails ao card (usado quando a caixa de entrada entrar, etapa seguinte).
create table if not exists public.crm_card_messages (
  card_id uuid not null references public.crm_cards(id) on delete cascade,
  message_id uuid not null references public.mail_messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, message_id)
);

-- --- Status derivado da etapa ----------------------------------------------
-- Quem manda no status é a etapa. A tela só move o card; o banco decide se
-- isso é ganhar, perder ou continuar aberto, e carimba a data.
create or replace function public.crm_cards_sync_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  etapa public.crm_stage_kind;
begin
  select kind into etapa from public.crm_stages where id = new.stage_id;
  if etapa is null then
    raise exception 'Etapa inexistente.';
  end if;

  new.status := etapa::text::public.crm_card_status;
  if etapa = 'aberto' then
    new.closed_at := null;
    new.lost_reason := null;
  else
    new.closed_at := coalesce(
      case when tg_op = 'UPDATE' and old.status <> 'aberto' then old.closed_at end,
      now());
    if etapa = 'ganho' then
      new.lost_reason := null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_cards_sync_status() from public;

drop trigger if exists crm_cards_status on public.crm_cards;
create trigger crm_cards_status before insert or update of stage_id, lost_reason on public.crm_cards
for each row execute function public.crm_cards_sync_status();

-- --- Eventos e linha do tempo ----------------------------------------------
create or replace function public.events_comercial_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := new.organization_id;
  etapa text;
  cliente text;
begin
  select label into etapa from public.crm_stages where id = new.stage_id;
  select name into cliente from public.customers where id = new.customer_id;

  if tg_op = 'INSERT' then
    perform public.emit_module_event(org, 'comercial', 'comercial.card.criado', 'card', new.id::text,
      format('Card criado · %s%s', new.title, coalesce(' · ' || cliente, '')),
      jsonb_build_object('etapa', etapa, 'origem', new.origem, 'tipo', new.kind));
    insert into public.crm_card_activities (organization_id, card_id, kind, summary, actor_profile_id, actor_name)
    select org, new.id, 'criacao', format('Card criado em %s', etapa), p.id, p.full_name
    from (select 1) one left join public.profiles p on p.id = public.current_profile_id();
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    insert into public.crm_card_activities (organization_id, card_id, kind, summary, payload, actor_profile_id, actor_name)
    select org, new.id, 'etapa', format('Movido para %s', etapa),
      jsonb_build_object('de', old.stage_id, 'para', new.stage_id), p.id, p.full_name
    from (select 1) one left join public.profiles p on p.id = public.current_profile_id();

    if new.status = 'ganho' then
      perform public.emit_module_event(org, 'comercial', 'comercial.card.ganho', 'card', new.id::text,
        format('Card ganho · %s', new.title),
        jsonb_build_object('valor', new.value_cents, 'cliente', cliente));
    elsif new.status = 'perdido' then
      perform public.emit_module_event(org, 'comercial', 'comercial.card.perdido', 'card', new.id::text,
        format('Card perdido · %s', new.title),
        jsonb_build_object('motivo', new.lost_reason, 'cliente', cliente));
    else
      perform public.emit_module_event(org, 'comercial', 'comercial.card.movido', 'card', new.id::text,
        format('Card movido para %s · %s', etapa, new.title), jsonb_build_object('etapa', etapa));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.events_comercial_card() from public;

drop trigger if exists crm_cards_events on public.crm_cards;
create trigger crm_cards_events after insert or update of stage_id on public.crm_cards
for each row execute function public.events_comercial_card();

-- --- RLS --------------------------------------------------------------------
-- Ver o funil é `comercial.funil`; criar, mover e fechar é o mesmo em operar.
alter table public.crm_stages enable row level security;
drop policy if exists crm_stages_read on public.crm_stages;
create policy crm_stages_read on public.crm_stages for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.funil'));

alter table public.crm_cards enable row level security;
drop policy if exists crm_cards_read on public.crm_cards;
create policy crm_cards_read on public.crm_cards for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.funil'));
drop policy if exists crm_cards_write on public.crm_cards;
create policy crm_cards_write on public.crm_cards for all to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.funil', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('comercial.funil', 'operar'));

alter table public.crm_card_activities enable row level security;
drop policy if exists crm_card_activities_read on public.crm_card_activities;
create policy crm_card_activities_read on public.crm_card_activities for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.funil'));
drop policy if exists crm_card_activities_write on public.crm_card_activities;
create policy crm_card_activities_write on public.crm_card_activities for insert to authenticated
with check (organization_id = public.current_organization_id() and public.has_feature('comercial.funil', 'operar'));

alter table public.crm_card_messages enable row level security;
drop policy if exists crm_card_messages_read on public.crm_card_messages;
create policy crm_card_messages_read on public.crm_card_messages for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.funil'));
