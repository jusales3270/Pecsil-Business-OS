-- ============================================================================
-- Trilha de eventos entre módulos (base do ecossistema)
-- ============================================================================
-- Cada módulo ANUNCIA o que acontece: "cotação aprovada", "colaborador
-- desligado", "visita encerrada". Por enquanto ninguém reage — as reações
-- entre departamentos (quem escuta o quê e faz o quê) vêm quando cada processo
-- for mapeado (docs/PROCESSOS-PECSIL.md). Registrar desde já dá histórico à
-- camada analítica e à SARA e evita reabrir módulos depois.
--
-- A emissão é por gatilho no banco: Compras e Portaria gravam direto do
-- navegador, então só o banco garante o registro qualquer que seja a origem.
-- Os gatilhos só disparam em transições com significado, não em todo update.
--
-- Tipos de evento: catálogo em modules/event-catalog.ts (o teste
-- tests/event-catalog.test.mjs confere que batem com os gatilhos abaixo).
-- ============================================================================

-- Funcionalidades novas do catálogo de acesso (modules/access-catalog.ts).
insert into public.access_features (code, module_code, label, levels, sort) values
  ('fundacao.cadastros', 'fundacao', 'Cadastros', '{ver,operar}', 30),
  ('fundacao.eventos',   'fundacao', 'Eventos',   '{ver}',        40)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

-- Valor em reais no formato brasileiro (1.234,56), independente da localidade.
create or replace function public.brl(amount numeric)
returns text
language sql
immutable
as $$
  select translate(to_char(coalesce(amount, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

create table if not exists public.module_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_code text not null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  -- Nome de quem fez, gravado na hora: a trilha é lida por quem não tem acesso a perfis.
  actor_name text,
  occurred_at timestamptz not null default now()
);

alter table public.module_events add column if not exists actor_name text;

create index if not exists idx_module_events_org_time on public.module_events(organization_id, occurred_at desc);
create index if not exists idx_module_events_type on public.module_events(organization_id, event_type, occurred_at desc);

alter table public.module_events enable row level security;

-- Leitura: proprietário ou quem tem Fundação › Eventos. Ninguém grava direto
-- (só os gatilhos, via emit_module_event), e o que foi registrado não muda.
drop policy if exists module_events_read on public.module_events;
create policy module_events_read on public.module_events for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('fundacao.eventos'));

-- --- Emissor ------------------------------------------------------------------
create or replace function public.emit_module_event(
  target_org uuid,
  module text,
  event text,
  entity text,
  entity_key text,
  sentence text,
  details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.module_events
    (organization_id, module_code, event_type, entity_type, entity_id, summary, payload, actor_profile_id, actor_name)
  select
    target_org, module, event, entity, entity_key, sentence, coalesce(details, '{}'::jsonb), p.id, p.full_name
  from (select 1) one
  left join public.profiles p on p.id = public.current_profile_id();
$$;

revoke all on function public.emit_module_event(uuid, text, text, text, text, text, jsonb) from public;

-- --- Compras -----------------------------------------------------------------
create or replace function public.events_compras_cotacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.criada', 'cotacao', new.id::text,
      format('Cotação #%s lançada · %s', new.id, coalesce(new.fornecedor, 'fornecedor não informado')),
      jsonb_build_object('fornecedor', new.fornecedor, 'divisao', new.divisao));
  elsif new.status is distinct from old.status then
    if new.status = 'APROVADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.aprovada', 'cotacao', new.id::text,
        format('Cotação #%s aprovada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'aprovado_por', new.aprovado_por, 'de', old.status));
    elsif new.status = 'REJEITADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.rejeitada', 'cotacao', new.id::text,
        format('Cotação #%s rejeitada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'motivo', new.motivo_rejeicao, 'de', old.status));
    elsif new.status = 'COMPRADO' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.comprada', 'cotacao', new.id::text,
        format('Cotação #%s comprada · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'de', old.status));
    elsif new.status = 'PENDENTE' then
      perform public.emit_module_event(new.organization_id, 'compras', 'compras.cotacao.reaberta', 'cotacao', new.id::text,
        format('Cotação #%s voltou para aprovação · %s', new.id, coalesce(new.fornecedor, '')),
        jsonb_build_object('fornecedor', new.fornecedor, 'de', old.status));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cotacoes_events on public.cotacoes;
create trigger cotacoes_events after insert or update of status on public.cotacoes
for each row execute function public.events_compras_cotacao();

create or replace function public.events_compras_compra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_module_event(new.organization_id, 'compras', 'compras.compra.registrada', 'compra', new.id::text,
    format('Compra registrada · %s · NF %s · R$ %s', coalesce(new.fornecedor, ''), coalesce(new.nf, 's/n'),
      public.brl(new.total)),
    jsonb_build_object('cotacao_id', new.cotacao_id, 'fornecedor', new.fornecedor, 'nf', new.nf, 'total', new.total));
  return new;
end;
$$;

drop trigger if exists compras_events on public.compras;
create trigger compras_events after insert on public.compras
for each row execute function public.events_compras_compra();

-- --- RH ------------------------------------------------------------------------
create or replace function public.events_rh_colaborador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'rh', 'rh.colaborador.admitido', 'colaborador', new.id::text,
      format('Colaborador cadastrado · %s', new.full_name),
      jsonb_build_object('employee_id', new.id, 'department_id', new.department_id));
  elsif old.active and not new.active then
    perform public.emit_module_event(new.organization_id, 'rh', 'rh.colaborador.desligado', 'colaborador', new.id::text,
      format('Colaborador desligado · %s', new.full_name),
      jsonb_build_object('employee_id', new.id, 'profile_id', new.profile_id));
  elsif not old.active and new.active then
    perform public.emit_module_event(new.organization_id, 'rh', 'rh.colaborador.reativado', 'colaborador', new.id::text,
      format('Colaborador reativado · %s', new.full_name),
      jsonb_build_object('employee_id', new.id, 'profile_id', new.profile_id));
  end if;
  return new;
end;
$$;

drop trigger if exists employees_events on public.employees;
create trigger employees_events after insert or update of active on public.employees
for each row execute function public.events_rh_colaborador();

create or replace function public.events_rh_ausencia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  person text;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  select e.full_name into person from public.employees e where e.id = new.employee_id;
  perform public.emit_module_event(new.organization_id, 'rh',
    case new.status when 'approved' then 'rh.ausencia.aprovada' else 'rh.ausencia.reprovada' end,
    'ausencia', new.id::text,
    format('%s %s · %s · %s a %s',
      case new.type when 'vacation' then 'Férias' when 'time_bank' then 'Banco de horas'
        when 'medical_certificate' then 'Atestado' else 'Licença' end,
      case new.status when 'approved' then 'aprovadas' else 'reprovadas' end,
      coalesce(person, 'colaborador'), to_char(new.start_date, 'DD/MM/YYYY'), to_char(new.end_date, 'DD/MM/YYYY')),
    jsonb_build_object('employee_id', new.employee_id, 'type', new.type, 'start', new.start_date, 'end', new.end_date));
  return new;
end;
$$;

drop trigger if exists rh_absences_events on public.rh_absences;
create trigger rh_absences_events after update of status on public.rh_absences
for each row execute function public.events_rh_ausencia();

-- --- Financeiro ------------------------------------------------------------------
create or replace function public.events_financeiro_titulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := case new.direction when 'payable' then 'a pagar' else 'a receber' end;
begin
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.criado', 'titulo', new.id::text,
      format('Título %s criado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount,
        'source_module', new.source_module, 'source_entity_id', new.source_entity_id));
  elsif new.status is distinct from old.status and new.status = 'settled' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.baixado', 'titulo', new.id::text,
      format('Título %s quitado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  elsif new.status is distinct from old.status and new.status = 'approved' then
    perform public.emit_module_event(new.organization_id, 'financeiro', 'financeiro.titulo.aprovado', 'titulo', new.id::text,
      format('Título %s aprovado · %s · R$ %s', kind, new.counterparty_name, public.brl(new.original_amount)),
      jsonb_build_object('direction', new.direction, 'amount', new.original_amount));
  end if;
  return new;
end;
$$;

drop trigger if exists finance_titles_events on public.finance_titles;
create trigger finance_titles_events after insert or update of status on public.finance_titles
for each row execute function public.events_financeiro_titulo();

-- --- Portaria --------------------------------------------------------------------
create or replace function public.events_portaria_visita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'portaria', 'portaria.visita.entrada', 'visita', new.id::text,
      format('Entrada de visita · %s%s', coalesce(new.visitante, 'visitante'),
        case when coalesce(new.empresa, '') <> '' then ' (' || new.empresa || ')' else '' end),
      jsonb_build_object('empresa', new.empresa, 'responsavel', new.responsavel, 'descricao', new.descricao));
  elsif old.horario_saida is null and new.horario_saida is not null then
    perform public.emit_module_event(new.organization_id, 'portaria', 'portaria.visita.saida', 'visita', new.id::text,
      format('Saída de visita · %s', coalesce(new.visitante, 'visitante')),
      jsonb_build_object('empresa', new.empresa, 'entrada', new.horario_entrada, 'saida', new.horario_saida));
  end if;
  return new;
end;
$$;

drop trigger if exists visitas_events on public.visitas;
create trigger visitas_events after insert or update of horario_saida on public.visitas
for each row execute function public.events_portaria_visita();

create or replace function public.events_portaria_recebido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_module_event(new.organization_id, 'portaria', 'portaria.recebido.registrado', 'recebido', new.id::text,
    format('Recebimento na portaria · de %s para %s', coalesce(new.remetente, 'remetente'), coalesce(new.destinatario, 'destinatário')),
    jsonb_build_object('remetente', new.remetente, 'destinatario', new.destinatario, 'descricao', new.descricao));
  return new;
end;
$$;

drop trigger if exists encomendas_events on public.encomendas;
create trigger encomendas_events after insert on public.encomendas
for each row execute function public.events_portaria_recebido();

-- --- Acesso ------------------------------------------------------------------------
create or replace function public.events_acesso_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_module_event(new.organization_id, 'acesso', 'acesso.usuario.criado', 'usuario', new.id::text,
      format('Acesso criado · %s%s', new.full_name,
        case when new.account_type = 'terceiro' then ' (terceiro · ' || coalesce(new.company_name, '') || ')' else '' end),
      jsonb_build_object('account_type', new.account_type, 'company_name', new.company_name));
  elsif new.status is distinct from old.status and new.status in ('blocked', 'disabled') then
    perform public.emit_module_event(new.organization_id, 'acesso', 'acesso.usuario.bloqueado', 'usuario', new.id::text,
      format('Acesso bloqueado · %s', new.full_name), jsonb_build_object('status', new.status));
  elsif new.status is distinct from old.status and new.status = 'active' then
    perform public.emit_module_event(new.organization_id, 'acesso', 'acesso.usuario.reativado', 'usuario', new.id::text,
      format('Acesso reativado · %s', new.full_name), '{}'::jsonb);
  elsif new.access_expires_at is distinct from old.access_expires_at then
    perform public.emit_module_event(new.organization_id, 'acesso', 'acesso.usuario.validade_alterada', 'usuario', new.id::text,
      format('Validade do acesso alterada · %s · %s', new.full_name,
        coalesce(to_char(new.access_expires_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), 'sem prazo')),
      jsonb_build_object('antes', old.access_expires_at, 'depois', new.access_expires_at));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_events on public.profiles;
create trigger profiles_events after insert or update of status, access_expires_at on public.profiles
for each row execute function public.events_acesso_usuario();

-- Funções de gatilho não são chamadas por usuários.
revoke all on function public.events_compras_cotacao() from public;
revoke all on function public.events_compras_compra() from public;
revoke all on function public.events_rh_colaborador() from public;
revoke all on function public.events_rh_ausencia() from public;
revoke all on function public.events_financeiro_titulo() from public;
revoke all on function public.events_portaria_visita() from public;
revoke all on function public.events_portaria_recebido() from public;
revoke all on function public.events_acesso_usuario() from public;
