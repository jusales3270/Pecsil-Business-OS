-- ============================================================================
-- Comercial (CRM): entrada de e-mail e classificação
-- ============================================================================
-- Caixas monitoradas, mensagens registradas, o julgamento do Jev sobre cada uma
-- e a fila de saída. O e-mail é o canal oficial do Comercial.
--
-- Duas decisões de projeto ficam gravadas no formato das tabelas:
--
-- 1. `mail_accounts.mode` — a caixa comercial entra inteira ('todos'); a caixa
--    do diretor de operações entra filtrada ('remetentes_conhecidos'): só o que
--    vem de e-mail cadastrado em `party_emails`.
-- 2. `mail_accounts.reads_body` — para a caixa do diretor é FALSE, e
--    `mail_messages.body_text` fica nulo. Não é só política: no Exchange o
--    aplicativo recebe apenas `Mail.ReadBasic` naquela caixa, então o corpo
--    nem chega até aqui.
--
-- A classificação fica em tabela própria (não numa coluna da mensagem) para
-- guardar o modelo, as probabilidades e a correção humana — é com isso que se
-- mede se o Jev está acertando.
-- ============================================================================

do $$ begin
  create type public.mail_account_mode as enum ('todos', 'remetentes_conhecidos');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.mail_kind as enum ('pedido', 'cobranca', 'duvida', 'outro');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.mail_outbox_status as enum ('pendente', 'enviado', 'erro');
exception when duplicate_object then null; end $$;

-- --- Caixas monitoradas -----------------------------------------------------
create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  address text not null,
  label text not null,
  provider text not null default 'microsoft',
  -- Identificador da caixa no provedor (no Graph, o UPN ou o id do usuário).
  mailbox_id text not null,
  mode public.mail_account_mode not null default 'todos',
  reads_body boolean not null default true,
  -- Estado da leitura incremental (o @odata.deltaLink da última rodada).
  delta_link text,
  last_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, address),
  constraint mail_accounts_address_lower check (address = lower(btrim(address))),
  -- Caixa filtrada não lê corpo: é a caixa de outra pessoa.
  constraint mail_accounts_corpo_coerente check (mode = 'todos' or reads_body = false)
);

drop trigger if exists mail_accounts_updated_at on public.mail_accounts;
create trigger mail_accounts_updated_at before update on public.mail_accounts
for each row execute function public.set_updated_at();

-- --- Mensagens --------------------------------------------------------------
create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  graph_id text not null,
  -- Chave de deduplicação: a mesma mensagem pode aparecer em duas rodadas do
  -- delta, e a mesma conversa chega nas duas caixas monitoradas.
  internet_message_id text not null,
  conversation_id text,
  from_name text,
  from_address text not null,
  to_addresses text[] not null default '{}',
  subject text,
  received_at timestamptz not null,
  has_attachments boolean not null default false,
  -- Nulo quando a caixa não permite ler o corpo (Mail.ReadBasic).
  body_text text,
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, internet_message_id)
);

create index if not exists idx_mail_messages_recentes on public.mail_messages(organization_id, received_at desc);
create index if not exists idx_mail_messages_customer on public.mail_messages(customer_id);
create index if not exists idx_mail_messages_conversa on public.mail_messages(organization_id, conversation_id);

-- --- Classificação (Jev) ----------------------------------------------------
create table if not exists public.mail_classifications (
  message_id uuid primary key references public.mail_messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.mail_kind not null,
  confidence numeric(4, 3),
  probabilities jsonb not null default '{}'::jsonb,
  model text,
  -- 'jev' quando veio do modelo; 'triagem' quando o modelo não respondeu ou
  -- ficou abaixo do limiar; 'pessoa' quando alguém corrigiu.
  source text not null default 'jev',
  classified_at timestamptz not null default now(),
  reviewed_kind public.mail_kind,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  constraint mail_classifications_revisao_coerente
    check (num_nonnulls(reviewed_kind, reviewed_at) in (0, 2))
);

create index if not exists idx_mail_classifications_kind on public.mail_classifications(organization_id, kind);

-- --- Saída ------------------------------------------------------------------
create table if not exists public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  to_address text not null,
  subject text not null,
  body text not null,
  in_reply_to uuid references public.mail_messages(id) on delete set null,
  status public.mail_outbox_status not null default 'pendente',
  sent_at timestamptz,
  graph_message_id text,
  error text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists mail_outbox_updated_at on public.mail_outbox;
create trigger mail_outbox_updated_at before update on public.mail_outbox
for each row execute function public.set_updated_at();

create index if not exists idx_mail_outbox_fila on public.mail_outbox(organization_id, status, created_at);

-- --- Eventos ----------------------------------------------------------------
create or replace function public.events_comercial_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_module_event(new.organization_id, 'comercial', 'comercial.email.recebido', 'email', new.id::text,
    format('E-mail recebido · %s', coalesce(nullif(btrim(new.subject), ''), '(sem assunto)')),
    jsonb_build_object('de', new.from_address));
  return new;
end;
$$;

revoke all on function public.events_comercial_email() from public;

drop trigger if exists mail_messages_events on public.mail_messages;
create trigger mail_messages_events after insert on public.mail_messages
for each row execute function public.events_comercial_email();

create or replace function public.events_comercial_classificacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assunto text;
begin
  select coalesce(nullif(btrim(m.subject), ''), '(sem assunto)') into assunto
  from public.mail_messages m where m.id = new.message_id;
  perform public.emit_module_event(new.organization_id, 'comercial', 'comercial.email.classificado', 'email', new.message_id::text,
    format('E-mail classificado como %s · %s', coalesce(new.reviewed_kind, new.kind), assunto),
    jsonb_build_object('classe', coalesce(new.reviewed_kind, new.kind), 'origem', new.source, 'confianca', new.confidence));
  return new;
end;
$$;

revoke all on function public.events_comercial_classificacao() from public;

drop trigger if exists mail_classifications_events on public.mail_classifications;
create trigger mail_classifications_events after insert or update of reviewed_kind on public.mail_classifications
for each row execute function public.events_comercial_classificacao();

-- --- RLS --------------------------------------------------------------------
-- Ler e-mail é do CRM (Caixa de entrada). A gravação é da sincronização, que
-- roda no servidor com a chave de serviço — nenhuma policy a libera para
-- usuário comum. Corrigir a classificação é `comercial.caixa` (operar).
alter table public.mail_accounts enable row level security;
drop policy if exists mail_accounts_read on public.mail_accounts;
create policy mail_accounts_read on public.mail_accounts for select to authenticated
using (organization_id = public.current_organization_id()
  and (public.has_feature('comercial.conexao') or public.has_feature('comercial.caixa')));
drop policy if exists mail_accounts_manage on public.mail_accounts;
create policy mail_accounts_manage on public.mail_accounts for all to authenticated
using (organization_id = public.current_organization_id() and public.is_owner())
with check (organization_id = public.current_organization_id() and public.is_owner());

alter table public.mail_messages enable row level security;
drop policy if exists mail_messages_read on public.mail_messages;
create policy mail_messages_read on public.mail_messages for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.caixa'));

alter table public.mail_classifications enable row level security;
drop policy if exists mail_classifications_read on public.mail_classifications;
create policy mail_classifications_read on public.mail_classifications for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.caixa'));
drop policy if exists mail_classifications_review on public.mail_classifications;
create policy mail_classifications_review on public.mail_classifications for update to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('comercial.caixa', 'operar'))
with check (organization_id = public.current_organization_id() and public.has_feature('comercial.caixa', 'operar'));

alter table public.mail_outbox enable row level security;
drop policy if exists mail_outbox_read on public.mail_outbox;
create policy mail_outbox_read on public.mail_outbox for select to authenticated
using (organization_id = public.current_organization_id()
  and (public.has_feature('comercial.caixa') or public.has_feature('comercial.cobranca')));

-- Situação das caixas para a tela de Conexão, sem expor o delta_link (que é
-- estado interno e carrega token do provedor).
create or replace function public.mail_accounts_status()
returns table (
  id uuid, address text, label text, mode public.mail_account_mode, reads_body boolean,
  active boolean, last_sync_at timestamptz, last_error text, last_error_at timestamptz,
  mensagens bigint, ultima_mensagem timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.address, a.label, a.mode, a.reads_body, a.active,
    a.last_sync_at, a.last_error, a.last_error_at,
    (select count(*) from public.mail_messages m where m.account_id = a.id),
    (select max(m.received_at) from public.mail_messages m where m.account_id = a.id)
  from public.mail_accounts a
  where a.organization_id = public.current_organization_id()
    and public.has_feature('comercial.conexao');
$$;

revoke all on function public.mail_accounts_status() from public;
grant execute on function public.mail_accounts_status() to authenticated;
