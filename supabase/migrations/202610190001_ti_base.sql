-- Módulo de TI no Business OS (T-06, docs/PLANO-TI.md §5), 19/10/2026.
--
-- O que entra (escopo do debate, §5):
--   1. Inventário de ativos: servidores, estações, rede, coletores das CNCs, GRV…
--   2. Painel de saúde: lido do vigia externo na nuvem (T-03) e do backup (T-02);
--      o nobreak entra quando o T-01 existir.
--   3. Incidentes: as quedas que o vigia registra são copiadas para cá (ti_incidentes),
--      com a causa provável pela regra do vigia; a TI confirma a causa e registra à mão
--      o que o vigia não vê (uma estação, um coletor, a impressora). É o histórico de
--      energia e de rede que hoje não existe.
--   4. Chamados internos: QUALQUER pessoa abre e acompanha os próprios chamados (menu da
--      conta); a TI (ti.chamados operar) atende; quem aprova muda as regras.
--   5. Acessos remotos auditados: dependem da ferramenta do T-05 (RustDesk ou MeshCentral),
--      ainda não escolhida — ficam para depois.
--
-- Quem decide (§ "Quem decide" do PLANO-TI): o supervisor de TI, Cesar Augusto Santos,
-- decide as categorias e os prazos dos chamados. Os valores semeados aqui são PROVISÓRIOS
-- até ele revisar (ti_regras.revisado_em fica vazio, e a tela mostra isso).
-- Ninguém recebe permissão aqui: quem libera é o proprietário.

-- --- Permissões e registro do módulo ----------------------------------------------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('ti.saude', 'ti', 'Saúde e incidentes', '{ver,operar}', 10),
  ('ti.ativos', 'ti', 'Inventário', '{ver,operar}', 20),
  ('ti.chamados', 'ti', 'Chamados', '{ver,operar,aprovar}', 30),
  ('ti.sara', 'ti', 'SARA (assistente do módulo)', '{ver}', 95)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('ti', 'TI', '1.0.0', '/modules/ti', 'ti.view', 'integrated', 48)
on conflict (code) do update set status = 'integrated', name = 'TI', route = excluded.route, menu_order = excluded.menu_order;

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'ti', true, true from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- --- Inventário ----------------------------------------------------------------------------
create table if not exists public.ti_ativos (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  numero              integer not null,
  tipo                text not null check (tipo in ('servidor', 'estacao', 'notebook', 'rede', 'coletor_cnc', 'impressora', 'nobreak', 'camera', 'sistema', 'outro')),
  nome                text not null check (length(trim(nome)) between 2 and 120),
  local               text,
  responsavel         text,
  fabricante          text,
  modelo              text,
  numero_serie        text,
  patrimonio          text,
  ip                  text,
  sistema_operacional text,
  critico             boolean not null default false,
  situacao            text not null default 'em_uso' check (situacao in ('em_uso', 'reserva', 'manutencao', 'baixado')),
  -- Alvo do vigia externo que acompanha este ativo (ex.: servidor-pecsil).
  vigia_alvo          text,
  observacao          text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id) on delete set null,
  unique (organization_id, numero)
);
comment on table public.ti_ativos is 'Inventário de TI (T-06): servidores, estações, rede, coletores das CNCs, sistemas. Sem dado pessoal: o responsável é só o nome.';
create index if not exists ti_ativos_org_tipo on public.ti_ativos (organization_id, tipo, situacao);

-- --- Incidentes ----------------------------------------------------------------------------
create table if not exists public.ti_incidentes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  origem              text not null check (origem in ('vigia', 'manual')),
  -- Incidente do vigia na nuvem (vigia_incidentes.id): a cópia é atualizada, nunca duplicada.
  vigia_id            uuid unique,
  alvo                text,
  alvo_nome           text,
  ativo_id            uuid references public.ti_ativos (id) on delete set null,
  inicio              timestamptz not null,
  fim                 timestamptz,
  -- Vazio = a confirmar. Vem da regra do vigia até a TI confirmar.
  categoria           text check (categoria in ('energia', 'internet', 'rede', 'servidor', 'estacao', 'sistema', 'backup', 'alarme_falso', 'outro')),
  causa_vigia         text,
  causa               text,
  descricao           text,
  confirmado_por      uuid references public.profiles (id) on delete set null,
  confirmado_por_nome text,
  confirmado_em       timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles (id) on delete set null,
  updated_at          timestamptz not null default now(),
  check (fim is null or fim >= inicio),
  check (origem <> 'vigia' or vigia_id is not null)
);
comment on table public.ti_incidentes is 'Quedas e falhas de TI (T-06): cópia dos incidentes do vigia externo (origem vigia) e os registrados pela TI (manual).';
create index if not exists ti_incidentes_org_inicio on public.ti_incidentes (organization_id, inicio desc);

-- --- Regras dos chamados (do supervisor de TI) ----------------------------------------------
create table if not exists public.ti_regras (
  organization_id   uuid primary key references public.organizations (id) on delete cascade,
  categorias        text[] not null,
  -- Prazo para resolver, em horas corridas, por prioridade.
  prazos_h          jsonb not null,
  revisado_por      uuid references public.profiles (id) on delete set null,
  revisado_por_nome text,
  revisado_em       timestamptz,
  updated_at        timestamptz not null default now(),
  check (cardinality(categorias) between 1 and 30),
  check (prazos_h ?& array['urgente', 'alta', 'normal', 'baixa'])
);
comment on table public.ti_regras is 'Categorias e prazos dos chamados de TI. Semeados como provisórios (revisado_em vazio) até o supervisor de TI revisar.';

insert into public.ti_regras (organization_id, categorias, prazos_h)
select o.id,
       array['Computador ou notebook', 'Impressora', 'Internet ou rede', 'E-mail', 'Acesso e senha', 'Business OS', 'Forja', 'GRV', 'Coletor das CNCs', 'Outro'],
       '{"urgente": 4, "alta": 8, "normal": 24, "baixa": 72}'::jsonb
from public.organizations o
on conflict (organization_id) do nothing;

-- --- Chamados ------------------------------------------------------------------------------
create table if not exists public.ti_chamados (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  numero               integer not null,
  titulo               text not null check (length(trim(titulo)) between 3 and 140),
  descricao            text not null check (length(trim(descricao)) between 3 and 4000),
  categoria            text not null,
  prioridade           text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  situacao             text not null default 'aberto' check (situacao in ('aberto', 'em_atendimento', 'aguardando', 'resolvido', 'cancelado')),
  ativo_id             uuid references public.ti_ativos (id) on delete set null,
  local                text,
  solicitante_id       uuid references public.profiles (id) on delete set null,
  solicitante_nome     text not null,
  responsavel_id       uuid references public.profiles (id) on delete set null,
  responsavel_nome     text,
  prazo                timestamptz not null,
  primeira_resposta_em timestamptz,
  resolvido_em         timestamptz,
  solucao              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (organization_id, numero)
);
create index if not exists ti_chamados_org_situacao on public.ti_chamados (organization_id, situacao, prazo);
create index if not exists ti_chamados_solicitante on public.ti_chamados (solicitante_id, created_at desc);

create table if not exists public.ti_chamado_andamentos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  chamado_id      uuid not null references public.ti_chamados (id) on delete cascade,
  autor_id        uuid references public.profiles (id) on delete set null,
  autor_nome      text not null,
  tipo            text not null check (tipo in ('abertura', 'comentario', 'atribuicao', 'situacao', 'reclassificacao')),
  texto           text not null,
  created_at      timestamptz not null default now()
);
create index if not exists ti_chamado_andamentos_chamado on public.ti_chamado_andamentos (chamado_id, created_at);

-- --- Leitura (RLS). Escrita só pelas funções abaixo. -----------------------------------------
alter table public.ti_ativos enable row level security;
alter table public.ti_incidentes enable row level security;
alter table public.ti_regras enable row level security;
alter table public.ti_chamados enable row level security;
alter table public.ti_chamado_andamentos enable row level security;

drop policy if exists ti_ativos_read on public.ti_ativos;
create policy ti_ativos_read on public.ti_ativos for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('ti.ativos')) or (select public.has_feature('ti.saude')) or (select public.has_feature('ti.chamados')))
);
drop policy if exists ti_incidentes_read on public.ti_incidentes;
create policy ti_incidentes_read on public.ti_incidentes for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('ti.saude'))
);
-- As categorias aparecem para quem abre chamado (qualquer pessoa da empresa).
drop policy if exists ti_regras_read on public.ti_regras;
create policy ti_regras_read on public.ti_regras for select using (organization_id = (select public.current_organization_id()));
-- O chamado: a TI vê todos; quem abriu vê os seus.
drop policy if exists ti_chamados_read on public.ti_chamados;
create policy ti_chamados_read on public.ti_chamados for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('ti.chamados')) or solicitante_id = (select public.current_profile_id()))
);
drop policy if exists ti_chamado_andamentos_read on public.ti_chamado_andamentos;
create policy ti_chamado_andamentos_read on public.ti_chamado_andamentos for select using (
  organization_id = (select public.current_organization_id())
  and exists (select 1 from public.ti_chamados c where c.id = chamado_id
              and ((select public.has_feature('ti.chamados')) or c.solicitante_id = (select public.current_profile_id())))
);

revoke insert, update, delete on public.ti_ativos, public.ti_incidentes, public.ti_regras, public.ti_chamados, public.ti_chamado_andamentos from anon, authenticated;
grant select on public.ti_ativos, public.ti_incidentes, public.ti_regras, public.ti_chamados, public.ti_chamado_andamentos to authenticated;

-- --- Utilidades -----------------------------------------------------------------------------
create or replace function public.ti_texto(p text, p_max integer) returns text
language sql immutable as $$ select nullif(left(trim(coalesce(p, '')), p_max), '') $$;

create or replace function public.ti_meu_nome() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = public.current_profile_id()), 'Alguém')
$$;
revoke all on function public.ti_meu_nome() from public, anon;
grant execute on function public.ti_meu_nome() to authenticated;

-- --- Inventário: salvar ativo ------------------------------------------------------------------
-- p: { id?, tipo, nome, local, responsavel, fabricante, modelo, numero_serie, patrimonio, ip,
--      sistema_operacional, critico, situacao, vigia_alvo, observacao }
create or replace function public.ti_salvar_ativo(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  a public.ti_ativos%rowtype;
  novo boolean := nullif(p ->> 'id', '') is null;
  n integer;
begin
  if org is null or not public.has_feature('ti.ativos', 'operar') then
    raise exception 'Sem permissão para alterar o inventário de TI.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p ->> 'nome', ''))) < 2 then raise exception 'Informe o nome do equipamento.'; end if;
  if coalesce(p ->> 'tipo', '') not in ('servidor', 'estacao', 'notebook', 'rede', 'coletor_cnc', 'impressora', 'nobreak', 'camera', 'sistema', 'outro') then
    raise exception 'Tipo de equipamento inválido.';
  end if;
  if coalesce(p ->> 'situacao', 'em_uso') not in ('em_uso', 'reserva', 'manutencao', 'baixado') then
    raise exception 'Situação inválida.';
  end if;

  if novo then
    perform pg_advisory_xact_lock(hashtext('ti_ativo:' || org::text));
    select coalesce(max(numero), 0) + 1 into n from public.ti_ativos where organization_id = org;
    insert into public.ti_ativos (organization_id, numero, tipo, nome, local, responsavel, fabricante, modelo, numero_serie, patrimonio, ip,
      sistema_operacional, critico, situacao, vigia_alvo, observacao, created_by, updated_by)
    values (org, n, p ->> 'tipo', public.ti_texto(p ->> 'nome', 120), public.ti_texto(p ->> 'local', 120), public.ti_texto(p ->> 'responsavel', 120),
      public.ti_texto(p ->> 'fabricante', 80), public.ti_texto(p ->> 'modelo', 120), public.ti_texto(p ->> 'numero_serie', 80), public.ti_texto(p ->> 'patrimonio', 40),
      public.ti_texto(p ->> 'ip', 60), public.ti_texto(p ->> 'sistema_operacional', 80), coalesce((p ->> 'critico')::boolean, false),
      coalesce(p ->> 'situacao', 'em_uso'), public.ti_texto(p ->> 'vigia_alvo', 40), public.ti_texto(p ->> 'observacao', 1000), me, me)
    returning * into a;
    perform public.emit_module_event(org, 'ti', 'ti.ativo.cadastrado', 'ti_ativo', a.id::text,
      format('Equipamento #%s cadastrado no inventário de TI: %s', a.numero, a.nome),
      jsonb_build_object('numero', a.numero, 'tipo', a.tipo, 'critico', a.critico));
  else
    update public.ti_ativos set
      tipo = p ->> 'tipo', nome = public.ti_texto(p ->> 'nome', 120), local = public.ti_texto(p ->> 'local', 120),
      responsavel = public.ti_texto(p ->> 'responsavel', 120), fabricante = public.ti_texto(p ->> 'fabricante', 80),
      modelo = public.ti_texto(p ->> 'modelo', 120), numero_serie = public.ti_texto(p ->> 'numero_serie', 80),
      patrimonio = public.ti_texto(p ->> 'patrimonio', 40), ip = public.ti_texto(p ->> 'ip', 60),
      sistema_operacional = public.ti_texto(p ->> 'sistema_operacional', 80), critico = coalesce((p ->> 'critico')::boolean, false),
      situacao = coalesce(p ->> 'situacao', 'em_uso'), vigia_alvo = public.ti_texto(p ->> 'vigia_alvo', 40),
      observacao = public.ti_texto(p ->> 'observacao', 1000), updated_at = now(), updated_by = me
    where id = (p ->> 'id')::uuid and organization_id = org
    returning * into a;
    if a.id is null then raise exception 'Equipamento não encontrado.'; end if;
    perform public.emit_module_event(org, 'ti', 'ti.ativo.alterado', 'ti_ativo', a.id::text,
      format('Equipamento #%s do inventário de TI alterado: %s', a.numero, a.nome),
      jsonb_build_object('numero', a.numero, 'situacao', a.situacao, 'critico', a.critico));
  end if;
  return jsonb_build_object('id', a.id, 'numero', a.numero);
end;
$$;
revoke all on function public.ti_salvar_ativo(jsonb) from public, anon;
grant execute on function public.ti_salvar_ativo(jsonb) to authenticated;

-- --- Incidentes: cópia do vigia (só o servidor da plataforma, com a chave de serviço) -----------
-- p_incidentes: [{ vigia_id, alvo, alvo_nome, inicio, fim, causa_vigia, categoria }]
-- A categoria vem da regra (lib/ti/vigia.ts) enquanto a TI não confirmar; depois de
-- confirmado, só o fim e a causa do vigia são atualizados.
create or replace function public.ti_sincronizar_vigia(p_org uuid, p_incidentes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  i jsonb;
  inc public.ti_incidentes%rowtype;
  inc_id uuid;
  novo boolean;
  n integer := 0;
  duracao text;
begin
  if p_org is null or jsonb_typeof(p_incidentes) <> 'array' then return 0; end if;
  for i in select * from jsonb_array_elements(p_incidentes) loop
    inc_id := null;
    insert into public.ti_incidentes (organization_id, origem, vigia_id, alvo, alvo_nome, inicio, fim, categoria, causa_vigia)
    values (p_org, 'vigia', (i ->> 'vigia_id')::uuid, left(i ->> 'alvo', 40), left(i ->> 'alvo_nome', 120), (i ->> 'inicio')::timestamptz,
      nullif(i ->> 'fim', '')::timestamptz, nullif(i ->> 'categoria', ''), left(i ->> 'causa_vigia', 500))
    on conflict (vigia_id) do update set
      fim = excluded.fim,
      causa_vigia = excluded.causa_vigia,
      categoria = case when ti_incidentes.confirmado_em is null then excluded.categoria else ti_incidentes.categoria end,
      updated_at = now()
    where ti_incidentes.organization_id = p_org
      and (ti_incidentes.fim is distinct from excluded.fim or ti_incidentes.causa_vigia is distinct from excluded.causa_vigia
           or (ti_incidentes.confirmado_em is null and ti_incidentes.categoria is distinct from excluded.categoria))
    returning id, (xmax = 0) into inc_id, novo;
    if inc_id is null then continue; end if;
    select * into inc from public.ti_incidentes where id = inc_id;
    n := n + 1;
    if novo then
      duracao := case when inc.fim is null then 'ainda fora' else
        case when extract(epoch from inc.fim - inc.inicio) < 3600 then round(extract(epoch from inc.fim - inc.inicio) / 60) || ' min'
             else floor(extract(epoch from inc.fim - inc.inicio) / 3600) || ' h ' || lpad((round(extract(epoch from inc.fim - inc.inicio) / 60)::int % 60)::text, 2, '0') || ' min' end end;
      perform public.emit_module_event(p_org, 'ti', 'ti.incidente.registrado', 'ti_incidente', inc.id::text,
        format('Queda registrada pelo vigia: %s (%s)', coalesce(inc.alvo_nome, inc.alvo), duracao),
        jsonb_build_object('alvo', inc.alvo, 'inicio', inc.inicio, 'fim', inc.fim, 'categoria', inc.categoria));
      if coalesce(inc.categoria, '') <> 'alarme_falso' then
        perform public.notify_feature(p_org, 'ti.saude', 'ver', 'ti', case when inc.fim is null then 'critical' else 'attention' end,
          format('%s: %s', case when inc.fim is null then 'Fora do ar' else 'Queda registrada' end, coalesce(inc.alvo_nome, inc.alvo)),
          left(format('Desde %s · %s. Provável: %s', to_char(inc.inicio at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), duracao, coalesce(inc.causa_vigia, 'a confirmar')), 400),
          '/?module=ti&secao=Incidentes', null);
      end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.ti_sincronizar_vigia(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ti_sincronizar_vigia(uuid, jsonb) to service_role;

-- --- Incidentes: registrar à mão e confirmar a causa ------------------------------------------
-- p: { id? (confirmar/editar), categoria, causa, descricao, inicio, fim, ativo_id, alvo_nome }
create or replace function public.ti_salvar_incidente(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  inc public.ti_incidentes%rowtype;
  ativo uuid := nullif(p ->> 'ativo_id', '')::uuid;
  cat text := nullif(p ->> 'categoria', '');
begin
  if org is null or not public.has_feature('ti.saude', 'operar') then
    raise exception 'Sem permissão para registrar incidentes de TI.' using errcode = '42501';
  end if;
  if cat is null or cat not in ('energia', 'internet', 'rede', 'servidor', 'estacao', 'sistema', 'backup', 'alarme_falso', 'outro') then
    raise exception 'Escolha a categoria do incidente.';
  end if;
  if ativo is not null and not exists (select 1 from public.ti_ativos where id = ativo and organization_id = org) then
    raise exception 'Equipamento não encontrado.';
  end if;
  if nullif(p ->> 'inicio', '') is not null and nullif(p ->> 'fim', '') is not null and (p ->> 'fim')::timestamptz < (p ->> 'inicio')::timestamptz then
    raise exception 'O fim não pode ser antes do início.';
  end if;

  if nullif(p ->> 'id', '') is null then
    if nullif(p ->> 'inicio', '') is null then raise exception 'Informe quando começou.'; end if;
    if length(trim(coalesce(p ->> 'causa', ''))) < 3 then raise exception 'Descreva a causa.'; end if;
    insert into public.ti_incidentes (organization_id, origem, alvo_nome, ativo_id, inicio, fim, categoria, causa, descricao,
      confirmado_por, confirmado_por_nome, confirmado_em, created_by)
    values (org, 'manual', coalesce(public.ti_texto(p ->> 'alvo_nome', 120), (select nome from public.ti_ativos where id = ativo)), ativo,
      (p ->> 'inicio')::timestamptz, nullif(p ->> 'fim', '')::timestamptz, cat, public.ti_texto(p ->> 'causa', 500),
      public.ti_texto(p ->> 'descricao', 2000), me, public.ti_meu_nome(), now(), me)
    returning * into inc;
    perform public.emit_module_event(org, 'ti', 'ti.incidente.registrado', 'ti_incidente', inc.id::text,
      format('Incidente registrado pela TI: %s', coalesce(inc.alvo_nome, inc.causa)),
      jsonb_build_object('origem', 'manual', 'categoria', inc.categoria, 'inicio', inc.inicio, 'fim', inc.fim));
  else
    -- Do vigia, a TI confirma a categoria e a causa (e liga ao equipamento); início e fim são do vigia.
    update public.ti_incidentes set
      categoria = cat,
      causa = coalesce(public.ti_texto(p ->> 'causa', 500), causa),
      descricao = public.ti_texto(p ->> 'descricao', 2000),
      ativo_id = ativo,
      inicio = case when origem = 'manual' and nullif(p ->> 'inicio', '') is not null then (p ->> 'inicio')::timestamptz else inicio end,
      fim = case when origem = 'manual' then nullif(p ->> 'fim', '')::timestamptz else fim end,
      alvo_nome = case when origem = 'manual' then coalesce(public.ti_texto(p ->> 'alvo_nome', 120), alvo_nome) else alvo_nome end,
      confirmado_por = me, confirmado_por_nome = public.ti_meu_nome(), confirmado_em = now(), updated_at = now()
    where id = (p ->> 'id')::uuid and organization_id = org
    returning * into inc;
    if inc.id is null then raise exception 'Incidente não encontrado.'; end if;
    perform public.emit_module_event(org, 'ti', 'ti.incidente.confirmado', 'ti_incidente', inc.id::text,
      format('Causa do incidente confirmada pela TI: %s', inc.categoria),
      jsonb_build_object('origem', inc.origem, 'categoria', inc.categoria));
  end if;
  return jsonb_build_object('id', inc.id);
end;
$$;
revoke all on function public.ti_salvar_incidente(jsonb) from public, anon;
grant execute on function public.ti_salvar_incidente(jsonb) to authenticated;

-- --- Chamados: abrir (qualquer pessoa da empresa) ------------------------------------------------
create or replace function public.ti_abrir_chamado(p_titulo text, p_descricao text, p_categoria text, p_prioridade text, p_local text, p_ativo uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  nome text := public.ti_meu_nome();
  r public.ti_regras%rowtype;
  c public.ti_chamados%rowtype;
  n integer;
  prio text := coalesce(nullif(p_prioridade, ''), 'normal');
begin
  if org is null or me is null then raise exception 'Entre na plataforma para abrir um chamado.' using errcode = '42501'; end if;
  if prio not in ('baixa', 'normal', 'alta', 'urgente') then raise exception 'Prioridade inválida.'; end if;
  if length(trim(coalesce(p_titulo, ''))) < 3 then raise exception 'Escreva em poucas palavras o que aconteceu.'; end if;
  if length(trim(coalesce(p_descricao, ''))) < 3 then raise exception 'Descreva o problema.'; end if;
  select * into r from public.ti_regras where organization_id = org;
  if r.organization_id is null then raise exception 'As regras dos chamados de TI ainda não foram configuradas.'; end if;
  if not (p_categoria = any (r.categorias)) then raise exception 'Escolha uma das categorias da lista.'; end if;
  -- Ligar a um equipamento do inventário é coisa da TI (quem abre não vê o inventário).
  if p_ativo is not null and not (public.has_feature('ti.chamados', 'operar') and exists (select 1 from public.ti_ativos where id = p_ativo and organization_id = org)) then
    p_ativo := null;
  end if;

  perform pg_advisory_xact_lock(hashtext('ti_chamado:' || org::text));
  select coalesce(max(numero), 0) + 1 into n from public.ti_chamados where organization_id = org;
  insert into public.ti_chamados (organization_id, numero, titulo, descricao, categoria, prioridade, local, ativo_id, solicitante_id, solicitante_nome, prazo)
  values (org, n, public.ti_texto(p_titulo, 140), public.ti_texto(p_descricao, 4000), p_categoria, prio, public.ti_texto(p_local, 120), p_ativo, me, nome,
    now() + make_interval(hours => (r.prazos_h ->> prio)::integer))
  returning * into c;
  insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
  values (org, c.id, me, nome, 'abertura', c.descricao);

  perform public.notify_feature(org, 'ti.chamados', 'operar', 'ti',
    case c.prioridade when 'urgente' then 'critical' when 'alta' then 'attention' else 'info' end,
    format('%sChamado #%s · %s', case when c.prioridade = 'urgente' then 'URGENTE · ' else '' end, c.numero, c.titulo),
    left(format('%s (%s): %s', nome, c.categoria, c.descricao), 400), '/?module=ti&secao=Chamados', me);
  perform public.emit_module_event(org, 'ti', 'ti.chamado.aberto', 'ti_chamado', c.id::text,
    format('Chamado de TI #%s aberto: %s', c.numero, c.titulo),
    jsonb_build_object('numero', c.numero, 'categoria', c.categoria, 'prioridade', c.prioridade));
  return jsonb_build_object('id', c.id, 'numero', c.numero, 'prazo', c.prazo);
end;
$$;
revoke all on function public.ti_abrir_chamado(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.ti_abrir_chamado(text, text, text, text, text, uuid) to authenticated;

-- --- Chamados: andamento ----------------------------------------------------------------------
-- p_acao: comentar · assumir · aguardar · resolver · reabrir · cancelar · reclassificar
-- p_extra (reclassificar): { prioridade, categoria, ativo_id }
create or replace function public.ti_chamado_acao(p_chamado uuid, p_acao text, p_texto text default null, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  nome text := public.ti_meu_nome();
  c public.ti_chamados%rowtype;
  r public.ti_regras%rowtype;
  eh_ti boolean := public.has_feature('ti.chamados', 'operar');
  eh_dono boolean;
  texto text := public.ti_texto(p_texto, 4000);
  aberto boolean;
  link text := '/?module=ti&secao=Chamados';
  -- Quem abriu pode não ter o módulo de TI: o aviso abre o chamado no painel pessoal (menu da conta).
  link_dono text := '/?chamados-ti=' || p_chamado::text;
  prio text;
  cat text;
  ativo uuid;
begin
  if org is null or me is null then raise exception 'Entre na plataforma.' using errcode = '42501'; end if;
  select * into c from public.ti_chamados where id = p_chamado and organization_id = org for update;
  if c.id is null then raise exception 'Chamado não encontrado.'; end if;
  eh_dono := c.solicitante_id = me;
  if not (eh_ti or eh_dono) then raise exception 'Sem permissão para este chamado.' using errcode = '42501'; end if;
  aberto := c.situacao in ('aberto', 'em_atendimento', 'aguardando');

  if p_acao = 'comentar' then
    if not aberto then raise exception 'O chamado está encerrado: reabra para continuar.'; end if;
    if texto is null then raise exception 'Escreva a mensagem.'; end if;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto) values (org, c.id, me, nome, 'comentario', texto);
    if eh_ti and not eh_dono then
      update public.ti_chamados set primeira_resposta_em = coalesce(primeira_resposta_em, now()),
        situacao = case when situacao = 'aberto' then 'em_atendimento' else situacao end,
        responsavel_id = coalesce(responsavel_id, me), responsavel_nome = coalesce(responsavel_nome, nome), updated_at = now() where id = c.id;
      if c.solicitante_id is not null then
        perform public.notify_profile(org, c.solicitante_id, 'ti', 'info', format('Chamado #%s: resposta da TI', c.numero), left(texto, 400), link_dono);
      end if;
    else
      update public.ti_chamados set situacao = case when situacao = 'aguardando' then 'em_atendimento' else situacao end, updated_at = now() where id = c.id;
      if c.responsavel_id is not null and c.responsavel_id <> me then
        perform public.notify_profile(org, c.responsavel_id, 'ti', 'info', format('Chamado #%s: nova mensagem de %s', c.numero, nome), left(texto, 400), link);
      elsif c.responsavel_id is null then
        perform public.notify_feature(org, 'ti.chamados', 'operar', 'ti', 'info', format('Chamado #%s: nova mensagem de %s', c.numero, nome), left(texto, 400), link, me);
      end if;
    end if;

  elsif p_acao = 'assumir' then
    if not eh_ti then raise exception 'Só a TI assume chamados.' using errcode = '42501'; end if;
    if not aberto then raise exception 'O chamado está encerrado.'; end if;
    update public.ti_chamados set responsavel_id = me, responsavel_nome = nome, situacao = 'em_atendimento',
      primeira_resposta_em = coalesce(primeira_resposta_em, now()), updated_at = now() where id = c.id;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'atribuicao', format('%s assumiu o chamado.', nome));
    if not eh_dono and c.solicitante_id is not null then
      perform public.notify_profile(org, c.solicitante_id, 'ti', 'info', format('Chamado #%s em atendimento', c.numero), format('%s está cuidando do seu chamado.', nome), link_dono);
    end if;

  elsif p_acao = 'aguardar' then
    if not eh_ti then raise exception 'Só a TI muda a situação.' using errcode = '42501'; end if;
    if not aberto then raise exception 'O chamado está encerrado.'; end if;
    if texto is null then raise exception 'Diga o que falta para continuar (ex.: peça, retorno de quem abriu).'; end if;
    update public.ti_chamados set situacao = 'aguardando', responsavel_id = coalesce(responsavel_id, me), responsavel_nome = coalesce(responsavel_nome, nome),
      primeira_resposta_em = coalesce(primeira_resposta_em, now()), updated_at = now() where id = c.id;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'situacao', 'Aguardando: ' || texto);
    if not eh_dono and c.solicitante_id is not null then
      perform public.notify_profile(org, c.solicitante_id, 'ti', 'attention', format('Chamado #%s aguardando', c.numero), left(texto, 400), link_dono);
    end if;

  elsif p_acao = 'resolver' then
    if not eh_ti then raise exception 'Só a TI resolve chamados.' using errcode = '42501'; end if;
    if not aberto then raise exception 'O chamado já está encerrado.'; end if;
    if texto is null then raise exception 'Descreva o que foi feito.'; end if;
    update public.ti_chamados set situacao = 'resolvido', resolvido_em = now(), solucao = texto,
      responsavel_id = coalesce(responsavel_id, me), responsavel_nome = coalesce(responsavel_nome, nome),
      primeira_resposta_em = coalesce(primeira_resposta_em, now()), updated_at = now() where id = c.id;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'situacao', 'Resolvido: ' || texto);
    if not eh_dono and c.solicitante_id is not null then
      perform public.notify_profile(org, c.solicitante_id, 'ti', 'info', format('Chamado #%s resolvido', c.numero),
        left(texto || ' · Se não resolveu, reabra em até 7 dias.', 400), link_dono);
    end if;
    perform public.emit_module_event(org, 'ti', 'ti.chamado.resolvido', 'ti_chamado', c.id::text,
      format('Chamado de TI #%s resolvido', c.numero),
      jsonb_build_object('numero', c.numero, 'categoria', c.categoria, 'no_prazo', now() <= c.prazo));

  elsif p_acao = 'reabrir' then
    if c.situacao <> 'resolvido' then raise exception 'Só um chamado resolvido pode ser reaberto.'; end if;
    if not eh_ti and c.resolvido_em < now() - interval '7 days' then raise exception 'Passou de 7 dias: abra um chamado novo.'; end if;
    if texto is null then raise exception 'Diga por que o problema continua.'; end if;
    update public.ti_chamados set situacao = case when responsavel_id is null then 'aberto' else 'em_atendimento' end,
      resolvido_em = null, updated_at = now() where id = c.id;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'situacao', 'Reaberto: ' || texto);
    if c.responsavel_id is not null and c.responsavel_id <> me then
      perform public.notify_profile(org, c.responsavel_id, 'ti', 'attention', format('Chamado #%s reaberto', c.numero), left(texto, 400), link);
    elsif c.responsavel_id is null then
      perform public.notify_feature(org, 'ti.chamados', 'operar', 'ti', 'attention', format('Chamado #%s reaberto', c.numero), left(texto, 400), link, me);
    end if;

  elsif p_acao = 'cancelar' then
    if not aberto then raise exception 'O chamado já está encerrado.'; end if;
    if not eh_ti and c.situacao <> 'aberto' then raise exception 'A TI já está atendendo: peça o cancelamento por mensagem.'; end if;
    if texto is null then raise exception 'Informe o motivo.'; end if;
    update public.ti_chamados set situacao = 'cancelado', updated_at = now() where id = c.id;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'situacao', 'Cancelado: ' || texto);
    if eh_ti and not eh_dono and c.solicitante_id is not null then
      perform public.notify_profile(org, c.solicitante_id, 'ti', 'info', format('Chamado #%s cancelado pela TI', c.numero), left(texto, 400), link_dono);
    end if;

  elsif p_acao = 'reclassificar' then
    if not eh_ti then raise exception 'Só a TI reclassifica chamados.' using errcode = '42501'; end if;
    if not aberto then raise exception 'O chamado está encerrado.'; end if;
    select * into r from public.ti_regras where organization_id = org;
    prio := coalesce(nullif(p_extra ->> 'prioridade', ''), c.prioridade);
    cat := coalesce(nullif(p_extra ->> 'categoria', ''), c.categoria);
    ativo := nullif(p_extra ->> 'ativo_id', '')::uuid;
    if prio not in ('baixa', 'normal', 'alta', 'urgente') then raise exception 'Prioridade inválida.'; end if;
    if not (cat = any (r.categorias)) and cat <> c.categoria then raise exception 'Categoria fora da lista.'; end if;
    if ativo is not null and not exists (select 1 from public.ti_ativos where id = ativo and organization_id = org) then raise exception 'Equipamento não encontrado.'; end if;
    update public.ti_chamados set prioridade = prio, categoria = cat, ativo_id = ativo,
      prazo = created_at + make_interval(hours => (r.prazos_h ->> prio)::integer), updated_at = now() where id = c.id;
    insert into public.ti_chamado_andamentos (organization_id, chamado_id, autor_id, autor_nome, tipo, texto)
    values (org, c.id, me, nome, 'reclassificacao',
      format('Prioridade %s · %s%s%s', prio, cat, case when ativo is not null then ' · equipamento #' || (select numero from public.ti_ativos where id = ativo) else '' end,
             case when texto is not null then ' · ' || texto else '' end));

  else
    raise exception 'Ação desconhecida.';
  end if;
end;
$$;
revoke all on function public.ti_chamado_acao(uuid, text, text, jsonb) from public, anon;
grant execute on function public.ti_chamado_acao(uuid, text, text, jsonb) to authenticated;

-- --- Regras: categorias e prazos (quem aprova chamados — o supervisor de TI) ------------------
create or replace function public.ti_salvar_regras(p_categorias text[], p_prazos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  cats text[];
  k text;
begin
  if org is null or not public.has_feature('ti.chamados', 'aprovar') then
    raise exception 'Só quem aprova chamados muda as regras.' using errcode = '42501';
  end if;
  -- Sem repetição, na ordem em que foram escritas.
  select array_agg(x order by o) into cats
    from (select public.ti_texto(c, 60) x, min(o) o from unnest(p_categorias) with ordinality u(c, o) group by 1) s where x is not null;
  if cats is null or cardinality(cats) < 1 or cardinality(cats) > 30 then raise exception 'Informe de 1 a 30 categorias.'; end if;
  foreach k in array array['urgente', 'alta', 'normal', 'baixa'] loop
    if coalesce(jsonb_typeof(p_prazos -> k), '') <> 'number'
       or (p_prazos ->> k)::numeric < 1 or (p_prazos ->> k)::numeric > 720 or (p_prazos ->> k)::numeric <> round((p_prazos ->> k)::numeric) then
      raise exception 'Prazo de "%" deve ser de 1 a 720 horas.', k;
    end if;
  end loop;
  update public.ti_regras set categorias = cats,
    prazos_h = jsonb_build_object('urgente', (p_prazos ->> 'urgente')::integer, 'alta', (p_prazos ->> 'alta')::integer,
                                  'normal', (p_prazos ->> 'normal')::integer, 'baixa', (p_prazos ->> 'baixa')::integer),
    revisado_por = public.current_profile_id(), revisado_por_nome = public.ti_meu_nome(), revisado_em = now(), updated_at = now()
  where organization_id = org;
  perform public.emit_module_event(org, 'ti', 'ti.regras.alteradas', 'ti_regras', org::text,
    'Categorias e prazos dos chamados de TI revisados', jsonb_build_object('categorias', cats, 'prazos_h', p_prazos));
end;
$$;
revoke all on function public.ti_salvar_regras(text[], jsonb) from public, anon;
grant execute on function public.ti_salvar_regras(text[], jsonb) to authenticated;
