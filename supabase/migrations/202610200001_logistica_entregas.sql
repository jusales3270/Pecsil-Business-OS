-- Logística: entregas com frota própria (L-02, docs/PLANO-LOGISTICA.md), 20/10/2026.
-- A plataforma guarda a entrega (de qual OS, pedido ou nota; cliente, endereço, situação, comprovante); a execução
-- (rota, motorista, GPS) é do Fleetbase, serviço separado consumido por API. Ler exige logistica.entregas; criar,
-- configurar e cancelar exigem "operar". A conferência com o Fleetbase é feita só pelo servidor (chave de serviço).

-- --- Permissão e registro do módulo (ninguém recebe permissão aqui: quem libera é o proprietário) -------------
insert into public.access_features (code, module_code, label, levels, sort) values
  ('logistica.entregas', 'logistica', 'Entregas e mapa ao vivo', '{ver,operar}', 10)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

insert into public.modules (code, name, version, route, entry_permission, status, menu_order)
values ('logistica', 'Logística', '1.0.0', '/modules/logistica', 'logistica.view', 'integrated', 47)
on conflict (code) do update set status = 'integrated', name = 'Logística', route = excluded.route, menu_order = excluded.menu_order;

insert into public.organization_modules (organization_id, module_code, enabled, menu_enabled)
select o.id, 'logistica', true, true from public.organizations o
on conflict (organization_id, module_code) do update set enabled = true, menu_enabled = true;

-- Origem das entregas (o pátio de onde o caminhão sai): configuração, não texto fixo da empresa.
create table if not exists public.logistica_config (
  organization_id  uuid primary key references public.organizations (id) on delete cascade,
  origem_nome      text not null check (length(trim(origem_nome)) between 2 and 120),
  origem_endereco  text not null check (length(origem_endereco) <= 300),
  origem_lat       double precision not null check (origem_lat between -90 and 90),
  origem_lng       double precision not null check (origem_lng between -180 and 180),
  fleetbase_local  text,
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_by_nome  text,
  updated_at       timestamptz not null default now()
);

-- Coordenada do endereço de cada cliente: geocodificado uma vez (ou corrigido à mão) e guardado.
create table if not exists public.logistica_locais (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  customer_id      uuid not null references public.customers (id) on delete cascade,
  endereco         text not null check (length(endereco) <= 300),
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  fonte            text not null check (fonte in ('geocodificado', 'manual')),
  fleetbase_local  text,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, customer_id)
);

create table if not exists public.logistica_entregas (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  numero           integer not null check (numero > 0),
  origem_tipo      text not null check (origem_tipo in ('os', 'pedido', 'nota', 'avulsa')),
  origem_id        text check (length(origem_id) <= 80),
  origem_rotulo    text check (length(origem_rotulo) <= 120),
  customer_id      uuid not null references public.customers (id),
  cliente_nome     text not null,
  descricao        text not null check (length(trim(descricao)) between 2 and 500),
  destino_endereco text check (length(destino_endereco) <= 300),
  destino_lat      double precision,
  destino_lng      double precision,
  situacao         text not null default 'criada'
                   check (situacao in ('criada', 'enviada', 'a_caminho', 'entregue', 'falhou', 'cancelada')),
  fleetbase_ordem  text unique,
  rastreio         text,
  motorista        text,
  veiculo          text,
  previsao         timestamptz,
  saiu_em          timestamptz,
  entregue_em      timestamptz,
  comprovante      jsonb not null default '{}'::jsonb check (length(comprovante::text) <= 8000),
  erro             text check (length(erro) <= 500),
  conferida_em     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_by_nome  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, numero)
);
create index if not exists logistica_entregas_abertas on public.logistica_entregas (organization_id, situacao)
  where situacao in ('criada', 'enviada', 'a_caminho');
create index if not exists logistica_entregas_origem on public.logistica_entregas (organization_id, origem_tipo, origem_id);

alter table public.logistica_config enable row level security;
alter table public.logistica_locais enable row level security;
alter table public.logistica_entregas enable row level security;

drop policy if exists logistica_config_read on public.logistica_config;
create policy logistica_config_read on public.logistica_config for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('logistica.entregas')));
drop policy if exists logistica_locais_read on public.logistica_locais;
create policy logistica_locais_read on public.logistica_locais for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('logistica.entregas')));
drop policy if exists logistica_entregas_read on public.logistica_entregas;
create policy logistica_entregas_read on public.logistica_entregas for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('logistica.entregas')));

revoke insert, update, delete on public.logistica_config, public.logistica_locais, public.logistica_entregas from anon, authenticated;
grant select on public.logistica_config, public.logistica_locais, public.logistica_entregas to authenticated;

create or replace function public.logistica_meu_nome()
returns text language sql stable security definer set search_path = public as $$
  select full_name from public.profiles where id = public.current_profile_id();
$$;
revoke all on function public.logistica_meu_nome() from public, anon;

create or replace function public.logistica_exigir_operar()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not public.has_feature('logistica.entregas', 'operar') then
    raise exception 'Sem permissão para operar as entregas.' using errcode = '42501';
  end if;
  return org;
end $$;
revoke all on function public.logistica_exigir_operar() from public, anon;

-- Origem das entregas.
create or replace function public.logistica_salvar_origem(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_operar();
  c public.logistica_config%rowtype;
begin
  if length(trim(coalesce(p ->> 'nome', ''))) < 2 then raise exception 'Dê um nome à origem (ex.: o pátio da fábrica).'; end if;
  if nullif(p ->> 'lat', '') is null or nullif(p ->> 'lng', '') is null then raise exception 'Falta a coordenada da origem.'; end if;
  insert into public.logistica_config (organization_id, origem_nome, origem_endereco, origem_lat, origem_lng, fleetbase_local, updated_by, updated_by_nome)
  values (org, left(trim(p ->> 'nome'), 120), left(coalesce(p ->> 'endereco', ''), 300), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          nullif(p ->> 'fleetbase_local', ''), public.current_profile_id(), public.logistica_meu_nome())
  on conflict (organization_id) do update set origem_nome = excluded.origem_nome, origem_endereco = excluded.origem_endereco,
    origem_lat = excluded.origem_lat, origem_lng = excluded.origem_lng,
    fleetbase_local = coalesce(excluded.fleetbase_local, case when (logistica_config.origem_lat, logistica_config.origem_lng) = (excluded.origem_lat, excluded.origem_lng)
                                                           then logistica_config.fleetbase_local end),
    updated_by = excluded.updated_by, updated_by_nome = excluded.updated_by_nome, updated_at = now()
  returning * into c;
  return to_jsonb(c);
end $$;
revoke all on function public.logistica_salvar_origem(jsonb) from public, anon;
grant execute on function public.logistica_salvar_origem(jsonb) to authenticated;

-- Coordenada do cliente (geocodificada pelo servidor ou corrigida à mão).
create or replace function public.logistica_salvar_local(p_customer uuid, p_endereco text, p_lat double precision, p_lng double precision,
  p_fonte text, p_fleetbase text default null)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.logistica_exigir_operar();
begin
  if not exists (select 1 from public.customers where id = p_customer and organization_id = org) then raise exception 'Cliente não encontrado.'; end if;
  if p_fonte not in ('geocodificado', 'manual') then raise exception 'Origem da coordenada inválida.'; end if;
  insert into public.logistica_locais (organization_id, customer_id, endereco, lat, lng, fonte, fleetbase_local)
  values (org, p_customer, left(coalesce(p_endereco, ''), 300), p_lat, p_lng, p_fonte, nullif(p_fleetbase, ''))
  on conflict (organization_id, customer_id) do update set endereco = excluded.endereco, lat = excluded.lat, lng = excluded.lng,
    fonte = excluded.fonte,
    fleetbase_local = case when (logistica_locais.lat, logistica_locais.lng) = (excluded.lat, excluded.lng)
                           then coalesce(excluded.fleetbase_local, logistica_locais.fleetbase_local) else excluded.fleetbase_local end,
    updated_at = now();
end $$;
revoke all on function public.logistica_salvar_local(uuid, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.logistica_salvar_local(uuid, text, double precision, double precision, text, text) to authenticated;

-- Nova entrega (situação "criada"; o servidor manda ao Fleetbase em seguida).
create or replace function public.logistica_criar_entrega(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_operar();
  tipo text := coalesce(nullif(p ->> 'origem_tipo', ''), 'avulsa');
  ref text := nullif(p ->> 'origem_id', '');
  rotulo text;
  cli public.customers%rowtype;
  loc public.logistica_locais%rowtype;
  e public.logistica_entregas%rowtype;
  n integer;
begin
  select * into cli from public.customers where id = nullif(p ->> 'customer_id', '')::uuid and organization_id = org;
  if cli.id is null then raise exception 'Escolha o cliente da entrega.'; end if;
  if length(trim(coalesce(p ->> 'descricao', ''))) < 2 then raise exception 'Descreva o que vai na entrega.'; end if;
  if tipo not in ('os', 'pedido', 'nota', 'avulsa') then raise exception 'Origem da entrega inválida.'; end if;
  if tipo <> 'avulsa' and ref is null then raise exception 'Indique de qual OS, pedido ou nota é a entrega.'; end if;
  if tipo = 'os' then
    select 'OS ' || code into rotulo from public.production_orders where id::text = ref and organization_id = org;
    if rotulo is null then raise exception 'OS não encontrada.'; end if;
  elsif tipo = 'pedido' then
    select 'Pedido ' || numero into rotulo from public.sales_quotes where id::text = ref and organization_id = org and situacao = 'ganho';
    if rotulo is null then raise exception 'Pedido não encontrado (só pedidos ganhos viram entrega).'; end if;
  elsif tipo = 'nota' then
    select 'NF ' || numero into rotulo from public.fiscal_nfe where id::text = ref and organization_id = org and situacao = 'autorizada';
    if rotulo is null then raise exception 'Nota não encontrada (só notas autorizadas viram entrega).'; end if;
  end if;
  select * into loc from public.logistica_locais where organization_id = org and customer_id = cli.id;

  perform pg_advisory_xact_lock(hashtext('logistica_entregas:' || org::text));
  select coalesce(max(numero), 0) + 1 into n from public.logistica_entregas where organization_id = org;
  insert into public.logistica_entregas (organization_id, numero, origem_tipo, origem_id, origem_rotulo, customer_id, cliente_nome, descricao,
    destino_endereco, destino_lat, destino_lng, created_by, created_by_nome)
  values (org, n, tipo, ref, rotulo, cli.id, cli.name, left(trim(p ->> 'descricao'), 500), loc.endereco, loc.lat, loc.lng,
    public.current_profile_id(), public.logistica_meu_nome())
  returning * into e;
  perform public.emit_module_event(org, 'logistica', 'logistica.entrega.criada', 'logistica_entrega', e.id::text,
    format('Entrega %s criada para %s%s', e.numero, e.cliente_nome, coalesce(' · ' || e.origem_rotulo, '')),
    jsonb_build_object('numero', e.numero, 'origem', e.origem_tipo, 'cliente', e.cliente_nome));
  return to_jsonb(e);
end $$;
revoke all on function public.logistica_criar_entrega(jsonb) from public, anon;
grant execute on function public.logistica_criar_entrega(jsonb) to authenticated;

-- Resultado do envio ao Fleetbase (ordem e rastreio, ou o erro para tentar de novo).
create or replace function public.logistica_registrar_envio(p_id uuid, p_ordem text, p_rastreio text, p_erro text,
  p_lat double precision default null, p_lng double precision default null, p_endereco text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_operar();
  e public.logistica_entregas%rowtype;
begin
  select * into e from public.logistica_entregas where id = p_id and organization_id = org for update;
  if e.id is null then raise exception 'Entrega não encontrada.'; end if;
  if e.situacao not in ('criada') then raise exception 'Esta entrega já foi enviada ao motorista.'; end if;
  if nullif(p_ordem, '') is null then
    update public.logistica_entregas set erro = left(coalesce(p_erro, 'Falha ao enviar.'), 500), updated_at = now() where id = e.id returning * into e;
    return to_jsonb(e);
  end if;
  update public.logistica_entregas set situacao = 'enviada', fleetbase_ordem = p_ordem, rastreio = nullif(p_rastreio, ''), erro = null,
    destino_lat = coalesce(p_lat, destino_lat), destino_lng = coalesce(p_lng, destino_lng), destino_endereco = coalesce(nullif(p_endereco, ''), destino_endereco),
    updated_at = now()
  where id = e.id returning * into e;
  perform public.emit_module_event(org, 'logistica', 'logistica.entrega.enviada', 'logistica_entrega', e.id::text,
    format('Entrega %s enviada à frota · %s', e.numero, e.cliente_nome), jsonb_build_object('numero', e.numero, 'rastreio', e.rastreio));
  return to_jsonb(e);
end $$;
revoke all on function public.logistica_registrar_envio(uuid, text, text, text, double precision, double precision, text) from public, anon;
grant execute on function public.logistica_registrar_envio(uuid, text, text, text, double precision, double precision, text) to authenticated;

-- Cancelar (antes de entregue). O servidor cancela também a ordem no Fleetbase.
create or replace function public.logistica_cancelar_entrega(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_operar();
  e public.logistica_entregas%rowtype;
begin
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga por que a entrega foi cancelada.'; end if;
  select * into e from public.logistica_entregas where id = p_id and organization_id = org for update;
  if e.id is null then raise exception 'Entrega não encontrada.'; end if;
  if e.situacao in ('entregue', 'cancelada') then raise exception 'Esta entrega já está %.', e.situacao; end if;
  update public.logistica_entregas set situacao = 'cancelada', erro = left(trim(p_motivo), 500), updated_at = now() where id = e.id returning * into e;
  perform public.emit_module_event(org, 'logistica', 'logistica.entrega.cancelada', 'logistica_entrega', e.id::text,
    format('Entrega %s cancelada · %s', e.numero, left(trim(p_motivo), 120)), jsonb_build_object('numero', e.numero));
  return to_jsonb(e);
end $$;
revoke all on function public.logistica_cancelar_entrega(uuid, text) from public, anon;
grant execute on function public.logistica_cancelar_entrega(uuid, text) to authenticated;

-- Conferência com o Fleetbase: SÓ o servidor (chave de serviço) chama, com o que leu da ordem pela própria chave.
-- O aviso (webhook) do Fleetbase nunca é usado como verdade: ele só dispara esta leitura.
create or replace function public.logistica_conferir(p_org uuid, p_ordem text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.logistica_entregas%rowtype;
  nova text := p ->> 'situacao';
  evento text;
  frase text;
begin
  select * into e from public.logistica_entregas where organization_id = p_org and fleetbase_ordem = p_ordem for update;
  if e.id is null then return null; end if;
  if nova is null or nova not in ('enviada', 'a_caminho', 'entregue', 'falhou', 'cancelada') then nova := e.situacao; end if;
  -- Situações finais não voltam atrás pela conferência (só "cancelada" por quem opera, antes de entregue).
  if e.situacao in ('entregue', 'cancelada') then nova := e.situacao; end if;
  update public.logistica_entregas set
    situacao    = nova,
    motorista   = coalesce(nullif(p ->> 'motorista', ''), motorista),
    veiculo     = coalesce(nullif(p ->> 'veiculo', ''), veiculo),
    previsao    = case when nova in ('enviada', 'a_caminho') then nullif(p ->> 'previsao', '')::timestamptz else previsao end,
    saiu_em     = coalesce(saiu_em, case when nova in ('a_caminho', 'entregue') then coalesce(nullif(p ->> 'saiu_em', '')::timestamptz, now()) end),
    entregue_em = coalesce(entregue_em, case when nova = 'entregue' then coalesce(nullif(p ->> 'entregue_em', '')::timestamptz, now()) end),
    comprovante = case when jsonb_typeof(p -> 'comprovante') = 'object' then p -> 'comprovante' else comprovante end,
    conferida_em = now(),
    updated_at  = case when nova is distinct from e.situacao then now() else updated_at end
  where id = e.id returning * into e;
  -- O evento da mudança de situação sai pelo gatilho logistica_evento_situacao.
  return to_jsonb(e);
end $$;
revoke all on function public.logistica_conferir(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.logistica_conferir(uuid, text, jsonb) to service_role;

-- Evento quando a situação muda pela conferência (gatilho: vale para qualquer caminho de escrita).
create or replace function public.logistica_evento_situacao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.situacao is distinct from old.situacao and new.situacao in ('a_caminho', 'entregue', 'falhou') then
    perform public.emit_module_event(new.organization_id, 'logistica',
      case new.situacao when 'a_caminho' then 'logistica.entrega.saiu' when 'entregue' then 'logistica.entrega.entregue' else 'logistica.entrega.falhou' end,
      'logistica_entrega', new.id::text,
      case new.situacao
        when 'a_caminho' then format('Entrega %s saiu para %s%s', new.numero, new.cliente_nome, coalesce(' · ' || new.motorista, ''))
        when 'entregue' then format('Entrega %s entregue em %s', new.numero, new.cliente_nome)
        else format('Entrega %s não foi concluída · %s', new.numero, new.cliente_nome) end,
      jsonb_build_object('numero', new.numero, 'motorista', new.motorista, 'veiculo', new.veiculo, 'rastreio', new.rastreio));
  end if;
  return new;
end $$;
drop trigger if exists logistica_evento_situacao on public.logistica_entregas;
create trigger logistica_evento_situacao after update of situacao on public.logistica_entregas
  for each row execute function public.logistica_evento_situacao();

-- O Segundo Cérebro passa a pulsar com os eventos da Logística (cerebro_pulsos de 0004, com 'logistica' na lista).
create or replace function public.cerebro_pulsos(p_desde timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  desde timestamptz := greatest(coalesce(p_desde, now() - interval '2 hours'), now() - interval '7 days');
begin
  if org is null or not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(p order by (p->>'em') desc) from (
    (select jsonb_build_object('em', e.occurred_at, 'tipo', 'evento', 'setor', upper(e.module_code), 'texto', e.summary) p
       from public.module_events e
      where e.organization_id = org and e.occurred_at > desde
        and e.module_code in ('compras', 'financeiro', 'comercial', 'almoxarifado', 'fiscal', 'rh', 'portaria', 'producao', 'fundicao', 'ti', 'logistica')
      order by e.occurred_at desc limit 60)
    union all
    (select jsonb_build_object('em', m.created_at, 'tipo', 'sara', 'setor', upper(c.modulo),
             'texto', 'SARA ' || c.modulo || ' consultou ' || coalesce((select string_agg(distinct u->>'nome', ', ')
                        from jsonb_array_elements(coalesce(m.ferramentas -> 'usadas', '[]'::jsonb)) u
                       where u->>'nome' not in ('abrir_tela', 'mostrar', 'registrar_lacuna', 'propor_habilidade')), 'o próprio conhecimento')) p
       from public.sara_mensagens m join public.sara_conversas c on c.id = m.conversa_id
      where c.organization_id = org and m.papel = 'sara' and m.created_at > desde
      order by m.created_at desc limit 40)
    union all
    (select jsonb_build_object('em', greatest(l.created_at, l.updated_at), 'tipo', 'ligacao', 'ligacao', l.id, 'origem', l.origem, 'destino', l.destino,
             'texto', o.nome || ' → ' || d.nome || ' (' || l.tipo || ')') p
       from public.cerebro_ligacoes l join public.cerebro_nos o on o.id = l.origem join public.cerebro_nos d on d.id = l.destino
      where l.organization_id = org and greatest(l.created_at, l.updated_at) > desde
      order by greatest(l.created_at, l.updated_at) desc limit 40)
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.cerebro_pulsos(timestamptz) from public, anon;
grant execute on function public.cerebro_pulsos(timestamptz) to authenticated;
