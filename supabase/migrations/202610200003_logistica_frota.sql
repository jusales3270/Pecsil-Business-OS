-- Logística: cadastro da frota e dos motoristas na plataforma (pedido do proprietário, 20/10/2026).
-- A plataforma é a dona do cadastro; o servidor espelha no Fleetbase (veículo e motorista) e guarda o id de lá.
-- O motorista é um COLABORADOR DO RH: a Logística guarda só o vínculo e o nome. Os documentos (CNH etc.) e os
-- dados pessoais continuam no RH; ao Fleetbase vai só o nome.
-- Ler: logistica.frota ou logistica.entregas. Cadastrar: logistica.frota "operar". Ninguém recebe permissão aqui.

insert into public.access_features (code, module_code, label, levels, sort) values
  ('logistica.frota', 'logistica', 'Frota e motoristas', '{ver,operar}', 20)
on conflict (code) do update
  set module_code = excluded.module_code, label = excluded.label, levels = excluded.levels, sort = excluded.sort;

create table if not exists public.logistica_veiculos (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  placa             text not null check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  tipo              text not null default 'caminhao' check (tipo in ('caminhao', 'van', 'utilitario', 'carro', 'moto', 'outro')),
  marca             text check (length(marca) <= 60),
  modelo            text check (length(modelo) <= 80),
  ano               integer check (ano between 1950 and 2100),
  capacidade_kg     numeric check (capacidade_kg >= 0),
  observacao        text check (length(observacao) <= 500),
  ativo             boolean not null default true,
  fleetbase_veiculo text,
  erro              text check (length(erro) <= 500),
  created_by        uuid references public.profiles (id) on delete set null,
  created_by_nome   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, placa)
);

create table if not exists public.logistica_motoristas (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  employee_id         uuid not null references public.employees (id),
  nome                text not null,
  veiculo_id          uuid references public.logistica_veiculos (id) on delete set null,
  ativo               boolean not null default true,
  fleetbase_motorista text,
  erro                text check (length(erro) <= 500),
  created_by          uuid references public.profiles (id) on delete set null,
  created_by_nome     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, employee_id)
);

alter table public.logistica_veiculos enable row level security;
alter table public.logistica_motoristas enable row level security;
drop policy if exists logistica_veiculos_read on public.logistica_veiculos;
create policy logistica_veiculos_read on public.logistica_veiculos for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('logistica.frota')) or (select public.has_feature('logistica.entregas'))));
drop policy if exists logistica_motoristas_read on public.logistica_motoristas;
create policy logistica_motoristas_read on public.logistica_motoristas for select using (
  organization_id = (select public.current_organization_id())
  and ((select public.has_feature('logistica.frota')) or (select public.has_feature('logistica.entregas'))));
revoke insert, update, delete on public.logistica_veiculos, public.logistica_motoristas from anon, authenticated;
grant select on public.logistica_veiculos, public.logistica_motoristas to authenticated;

create or replace function public.logistica_exigir_frota()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.current_organization_id();
begin
  if org is null or not public.has_feature('logistica.frota', 'operar') then
    raise exception 'Cadastrar a frota é de quem tem a permissão de frota (operar).' using errcode = '42501';
  end if;
  return org;
end $$;
revoke all on function public.logistica_exigir_frota() from public, anon;

-- Colaboradores ativos do RH para escolher o motorista: SÓ id, nome e cargo (os de cargo "motorista" primeiro).
-- Nada de documento, contato ou dado pessoal: isso fica no RH.
create or replace function public.logistica_colaboradores_motorista()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare org uuid := public.logistica_exigir_frota();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nome', e.full_name, 'cargo', p.name)
                     order by (p.name ilike '%motorista%') desc, e.full_name)
    from public.employees e left join public.positions p on p.id = e.position_id
    where e.organization_id = org and e.active and e.termination_date is null), '[]'::jsonb);
end $$;
revoke all on function public.logistica_colaboradores_motorista() from public, anon;
grant execute on function public.logistica_colaboradores_motorista() to authenticated;

-- Veículo: novo (sem id) ou alteração (com id). A placa é normalizada (sem traço, maiúscula; padrão antigo e Mercosul).
create or replace function public.logistica_salvar_veiculo(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_frota();
  v public.logistica_veiculos%rowtype;
  v_placa text := upper(regexp_replace(coalesce(p ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  novo boolean := nullif(p ->> 'id', '') is null;
begin
  if v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then raise exception 'Placa inválida (ex.: ABC1D23 ou ABC1234).'; end if;
  if novo then
    insert into public.logistica_veiculos (organization_id, placa, tipo, marca, modelo, ano, capacidade_kg, observacao, created_by, created_by_nome)
    values (org, v_placa, coalesce(nullif(p ->> 'tipo', ''), 'caminhao'), nullif(trim(p ->> 'marca'), ''), nullif(trim(p ->> 'modelo'), ''),
      nullif(p ->> 'ano', '')::int, nullif(p ->> 'capacidade_kg', '')::numeric, nullif(trim(p ->> 'observacao'), ''),
      public.current_profile_id(), public.logistica_meu_nome())
    returning * into v;
  else
    update public.logistica_veiculos set placa = v_placa, tipo = coalesce(nullif(p ->> 'tipo', ''), tipo), marca = nullif(trim(p ->> 'marca'), ''),
      modelo = nullif(trim(p ->> 'modelo'), ''), ano = nullif(p ->> 'ano', '')::int, capacidade_kg = nullif(p ->> 'capacidade_kg', '')::numeric,
      observacao = nullif(trim(p ->> 'observacao'), ''), ativo = coalesce((p ->> 'ativo')::boolean, ativo), updated_at = now()
    where id = (p ->> 'id')::uuid and organization_id = org returning * into v;
    if v.id is null then raise exception 'Veículo não encontrado.'; end if;
  end if;
  perform public.emit_module_event(org, 'logistica', case when novo then 'logistica.veiculo.cadastrado' else 'logistica.veiculo.alterado' end,
    'logistica_veiculo', v.id::text, format('Veículo %s %s', v.placa, case when novo then 'cadastrado' when not v.ativo then 'desativado' else 'alterado' end),
    jsonb_build_object('placa', v.placa, 'tipo', v.tipo, 'ativo', v.ativo));
  return to_jsonb(v);
exception when unique_violation then
  raise exception 'Já existe um veículo com a placa %.', v_placa;
end $$;
revoke all on function public.logistica_salvar_veiculo(jsonb) from public, anon;
grant execute on function public.logistica_salvar_veiculo(jsonb) to authenticated;

-- Motorista: um colaborador ativo do RH, com o veículo de costume (opcional).
create or replace function public.logistica_salvar_motorista(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.logistica_exigir_frota();
  m public.logistica_motoristas%rowtype;
  e public.employees%rowtype;
  veic uuid := nullif(p ->> 'veiculo_id', '')::uuid;
  novo boolean := nullif(p ->> 'id', '') is null;
begin
  if veic is not null and not exists (select 1 from public.logistica_veiculos where id = veic and organization_id = org and ativo) then
    raise exception 'Veículo não encontrado ou desativado.';
  end if;
  if novo then
    select * into e from public.employees where id = nullif(p ->> 'employee_id', '')::uuid and organization_id = org and active and termination_date is null;
    if e.id is null then raise exception 'Escolha um colaborador ativo do RH.'; end if;
    insert into public.logistica_motoristas (organization_id, employee_id, nome, veiculo_id, created_by, created_by_nome)
    values (org, e.id, e.full_name, veic, public.current_profile_id(), public.logistica_meu_nome())
    returning * into m;
  else
    update public.logistica_motoristas set veiculo_id = veic, ativo = coalesce((p ->> 'ativo')::boolean, ativo),
      nome = coalesce((select full_name from public.employees where id = logistica_motoristas.employee_id), nome), updated_at = now()
    where id = (p ->> 'id')::uuid and organization_id = org returning * into m;
    if m.id is null then raise exception 'Motorista não encontrado.'; end if;
  end if;
  perform public.emit_module_event(org, 'logistica', case when novo then 'logistica.motorista.cadastrado' else 'logistica.motorista.alterado' end,
    'logistica_motorista', m.id::text, format('Motorista %s %s', m.nome, case when novo then 'cadastrado' when not m.ativo then 'desativado' else 'alterado' end),
    jsonb_build_object('ativo', m.ativo, 'veiculo', m.veiculo_id));
  return to_jsonb(m);
exception when unique_violation then
  raise exception 'Este colaborador já está cadastrado como motorista.';
end $$;
revoke all on function public.logistica_salvar_motorista(jsonb) from public, anon;
grant execute on function public.logistica_salvar_motorista(jsonb) to authenticated;

-- Resultado do espelho no Fleetbase (o id de lá, ou o erro para tentar de novo).
create or replace function public.logistica_registrar_frota(p_tipo text, p_id uuid, p_fleetbase text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare org uuid := public.logistica_exigir_frota();
begin
  if p_tipo = 'veiculo' then
    update public.logistica_veiculos set fleetbase_veiculo = coalesce(nullif(p_fleetbase, ''), fleetbase_veiculo),
      erro = case when nullif(p_fleetbase, '') is null then left(p_erro, 500) end where id = p_id and organization_id = org;
  elsif p_tipo = 'motorista' then
    update public.logistica_motoristas set fleetbase_motorista = coalesce(nullif(p_fleetbase, ''), fleetbase_motorista),
      erro = case when nullif(p_fleetbase, '') is null then left(p_erro, 500) end where id = p_id and organization_id = org;
  else
    raise exception 'Tipo inválido.';
  end if;
end $$;
revoke all on function public.logistica_registrar_frota(text, uuid, text, text) from public, anon;
grant execute on function public.logistica_registrar_frota(text, uuid, text, text) to authenticated;
