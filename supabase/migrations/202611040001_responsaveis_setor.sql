-- ============================================================================
-- Responsável pelo setor (04/11/2026, pedido do proprietário)
-- ============================================================================
--   * O RH marca, na ficha do colaborador e no quadro de terceiros, quem é "Responsável pelo setor". O colaborador
--     responde pelo próprio departamento; o terceiro, pelo setor digitado.
--   * A Portaria passa a escolher o Responsável da visita (e o Destinatário dos recebidos) só entre os marcados,
--     no formato "Nome · Setor" (portaria_responsaveis). Desmarcou, saiu da lista.
--   * Marcar e desmarcar exige a credencial nova rh.responsaveis em Operar (o proprietário sempre pode). Começa com
--     quem já opera RH › Colaboradores.
--   * Entra o departamento Ferramentaria.
-- ============================================================================

insert into public.access_features (code, module_code, label, levels, sort) values
  ('rh.responsaveis', 'rh', 'Responsáveis pelo setor', '{ver,operar}', 76)
on conflict (code) do update set label = excluded.label, levels = excluded.levels;

insert into public.user_feature_grants (organization_id, profile_id, feature_code, level)
select g.organization_id, g.profile_id, 'rh.responsaveis', 'operar'
  from public.user_feature_grants g
 where g.feature_code = 'rh.colaboradores' and g.level >= 'operar'
   and not exists (select 1 from public.user_feature_grants x where x.profile_id = g.profile_id and x.feature_code = 'rh.responsaveis');

-- Ferramentaria, na mesma unidade dos outros departamentos da organização.
insert into public.departments (organization_id, unit_id, name, code, active)
select o.id, (select d.unit_id from public.departments d where d.organization_id = o.id and d.unit_id is not null group by d.unit_id order by count(*) desc limit 1),
       'Ferramentaria', 'FERRAMENTARIA', true
  from public.organizations o
 where not exists (select 1 from public.departments d where d.organization_id = o.id and (d.code = 'FERRAMENTARIA' or lower(d.name) = 'ferramentaria'));

alter table public.employees add column if not exists responsavel_setor boolean not null default false;
alter table public.employees add column if not exists responsavel_marcado_por_nome text;
alter table public.employees add column if not exists responsavel_marcado_em timestamptz;
comment on column public.employees.responsavel_setor is 'Responsável pelo setor (o próprio departamento): aparece em Responsável nas visitas da Portaria. Só muda por rh_responsavel_setor.';

alter table public.terceiros_quadro add column if not exists responsavel_setor text;
alter table public.terceiros_quadro drop constraint if exists terceiros_quadro_responsavel_setor_ck;
alter table public.terceiros_quadro add constraint terceiros_quadro_responsavel_setor_ck
  check (responsavel_setor is null or char_length(btrim(responsavel_setor)) between 2 and 60);
comment on column public.terceiros_quadro.responsavel_setor is 'Setor pelo qual o terceiro responde (vazio = não é responsável). Só muda por rh_responsavel_setor.';

-- Quem edita o cadastro (rh.colaboradores) não marca responsável pelo update comum: só pela função, com a credencial.
create or replace function public.employees_responsavel_guarda()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.responsavel_setor is distinct from old.responsavel_setor and coalesce(current_setting('pecsil.responsavel_setor', true), '') <> '1' then
    raise exception 'Responsável pelo setor só muda pela marcação do RH.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists employees_responsavel_guarda on public.employees;
create trigger employees_responsavel_guarda before update of responsavel_setor on public.employees
for each row execute function public.employees_responsavel_guarda();

create or replace function public.rh_responsavel_setor(p_tipo text, p_id uuid, p_marcado boolean, p_setor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  meu_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  v_setor text := nullif(regexp_replace(btrim(coalesce(p_setor, '')), '\s+', ' ', 'g'), '');
  v_nome text;
begin
  if org is null or not public.has_feature('rh.responsaveis', 'operar') then
    raise exception 'Sem permissão para marcar responsável pelo setor.' using errcode = '42501';
  end if;

  if p_tipo = 'colaborador' then
    select e.full_name, d.name into v_nome, v_setor
      from public.employees e left join public.departments d on d.id = e.department_id
     where e.id = p_id and e.organization_id = org;
    if v_nome is null then raise exception 'Colaborador não encontrado.'; end if;
    if p_marcado and v_setor is null then raise exception 'Informe o departamento de % antes de marcar como responsável.', v_nome; end if;
    perform set_config('pecsil.responsavel_setor', '1', true);
    update public.employees
       set responsavel_setor = p_marcado,
           responsavel_marcado_por_nome = case when p_marcado then meu_nome end,
           responsavel_marcado_em = case when p_marcado then now() end
     where id = p_id and organization_id = org;
    perform set_config('pecsil.responsavel_setor', '', true);
  elsif p_tipo = 'terceiro' then
    if p_marcado and (v_setor is null or char_length(v_setor) < 2 or char_length(v_setor) > 60) then
      raise exception 'Digite o setor pelo qual o terceiro responde (2 a 60 letras).';
    end if;
    update public.terceiros_quadro set responsavel_setor = case when p_marcado then v_setor end
     where id = p_id and organization_id = org and ativo
    returning nome into v_nome;
    if v_nome is null then raise exception 'Terceiro não encontrado no quadro.'; end if;
  else
    raise exception 'Tipo inválido.';
  end if;

  perform public.emit_module_event(org, 'rh', case when p_marcado then 'rh.responsavel.marcado' else 'rh.responsavel.desmarcado' end,
    p_tipo, p_id::text,
    case when p_marcado then format('Responsável pelo setor · %s · %s', v_nome, v_setor) else format('Deixou de ser responsável pelo setor · %s', v_nome) end,
    jsonb_build_object('nome', v_nome, 'setor', case when p_marcado then v_setor end, 'tipo', p_tipo));
  return jsonb_build_object('nome', v_nome, 'setor', case when p_marcado then v_setor end, 'marcado', p_marcado);
end;
$$;

-- A lista de responsáveis da Portaria: colaboradores ativos marcados (setor = departamento) e terceiros do quadro com setor.
create or replace function public.portaria_responsaveis()
returns table (nome text, setor text, tipo text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
begin
  if org is null or not (public.has_feature('portaria.visitas') or public.has_feature('portaria.recebidos') or public.has_feature('rh.responsaveis')) then
    raise exception 'Sem permissão para ver os responsáveis.' using errcode = '42501';
  end if;
  return query
    select x.nome, x.setor, x.tipo from (
      select e.full_name as nome, d.name as setor, 'colaborador'::text as tipo
        from public.employees e join public.departments d on d.id = e.department_id
       where e.organization_id = org and e.responsavel_setor and e.active
      union all
      select q.nome, q.responsavel_setor, 'terceiro'
        from public.terceiros_quadro q
       where q.organization_id = org and q.ativo and q.responsavel_setor is not null
    ) x
    order by x.setor, x.nome;
end;
$$;

revoke all on function public.rh_responsavel_setor(text, uuid, boolean, text) from public, anon;
revoke all on function public.portaria_responsaveis() from public, anon;
revoke all on function public.employees_responsavel_guarda() from public, anon, authenticated;
grant execute on function public.rh_responsavel_setor(text, uuid, boolean, text) to authenticated;
grant execute on function public.portaria_responsaveis() to authenticated;
