-- R-03 (roadmap), parte 1 · A função define as exigências do colaborador (EPI, exames, treinamentos).
-- Decide quem aprova em Saúde e segurança (rh.sst · aprovar, pela permissão da área: o proprietário não
-- decide pelo RH); quem vê SST vê as pendências.
--   * rh_position_requirements: por função, o EPI (do catálogo do RH) ou o exame/treinamento exigido,
--     com a validade em dias (troca do EPI, periodicidade do exame) quando houver;
--   * sugestões por regra, sem IA: o EPI entregue a pelo menos metade dos colaboradores ativos da
--     função nos últimos 12 meses, que ainda não é exigência. Só vira exigência quando alguém confirma;
--   * pendências: para cada colaborador ativo e cada exigência da sua função, a situação calculada
--     das entregas de EPI e dos registros de SST (mesma categoria e mesmo título).

create table if not exists public.rh_position_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  position_id uuid not null references public.positions(id) on delete cascade,
  tipo text not null check (tipo in ('epi', 'exame', 'treinamento')),
  ppe_item_id uuid references public.rh_ppe_items(id) on delete cascade,
  titulo text check (titulo is null or length(btrim(titulo)) between 2 and 120),
  validade_dias int check (validade_dias is null or validade_dias between 1 and 3650),
  origem text not null default 'manual' check (origem in ('manual', 'historico')),
  criado_por uuid references public.profiles(id) on delete set null,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tipo = 'epi' and ppe_item_id is not null) or (tipo <> 'epi' and titulo is not null))
);
create unique index if not exists uq_rh_req_epi on public.rh_position_requirements (position_id, ppe_item_id) where tipo = 'epi';
create unique index if not exists uq_rh_req_titulo on public.rh_position_requirements (position_id, tipo, lower(btrim(titulo))) where tipo <> 'epi';
create index if not exists idx_rh_req_org on public.rh_position_requirements (organization_id, position_id);

alter table public.rh_position_requirements enable row level security;
drop policy if exists rh_position_requirements_read on public.rh_position_requirements;
create policy rh_position_requirements_read on public.rh_position_requirements for select to authenticated
using (organization_id = public.current_organization_id() and public.has_feature('rh.sst'));
revoke insert, update, delete on public.rh_position_requirements from anon, authenticated;

create or replace function public.rh_exigencia_salvar(p_position uuid, p_tipo text, p_item uuid, p_titulo text, p_validade int, p_origem text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  v_id uuid;
  v_titulo text := nullif(btrim(coalesce(p_titulo, '')), '');
  funcao text;
begin
  if org is null or not public.tem_permissao_da_area('rh.sst', 'aprovar') then
    raise exception 'Definir as exigências da função é de quem aprova em Saúde e segurança no RH.' using errcode = '42501';
  end if;
  select name into funcao from public.positions where id = p_position and organization_id = org;
  if funcao is null then raise exception 'Função não encontrada.'; end if;
  if p_tipo not in ('epi', 'exame', 'treinamento') then raise exception 'Tipo de exigência inválido.'; end if;
  if p_tipo = 'epi' and not exists (select 1 from public.rh_ppe_items where id = p_item and organization_id = org) then raise exception 'Escolha o EPI do catálogo.'; end if;
  if p_tipo <> 'epi' and v_titulo is null then raise exception 'Informe o nome do exame ou do treinamento.'; end if;
  if p_validade is not null and (p_validade < 1 or p_validade > 3650) then raise exception 'Validade entre 1 e 3650 dias.'; end if;
  select id into v_id from public.rh_position_requirements r
  where r.position_id = p_position and r.tipo = p_tipo
    and ((p_tipo = 'epi' and r.ppe_item_id = p_item) or (p_tipo <> 'epi' and lower(btrim(r.titulo)) = lower(v_titulo)));
  if v_id is null then
    insert into public.rh_position_requirements (organization_id, position_id, tipo, ppe_item_id, titulo, validade_dias, origem, criado_por, criado_por_nome)
    values (org, p_position, p_tipo, case when p_tipo = 'epi' then p_item end, case when p_tipo <> 'epi' then v_titulo end, p_validade,
      case when p_origem = 'historico' then 'historico' else 'manual' end, me, (select full_name from public.profiles where id = me))
    returning id into v_id;
  else
    update public.rh_position_requirements set validade_dias = p_validade, updated_at = now() where id = v_id;
  end if;
  perform public.emit_module_event(org, 'rh', 'rh.exigencia.salva', 'funcao', p_position::text,
    format('Exigência da função %s: %s', funcao, coalesce(v_titulo, (select name from public.rh_ppe_items where id = p_item))),
    jsonb_build_object('tipo', p_tipo, 'validade_dias', p_validade, 'origem', p_origem));
  return v_id;
end;
$$;
revoke all on function public.rh_exigencia_salvar(uuid, text, uuid, text, int, text) from public, anon;
grant execute on function public.rh_exigencia_salvar(uuid, text, uuid, text, int, text) to authenticated;

create or replace function public.rh_exigencia_remover(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  r public.rh_position_requirements%rowtype;
begin
  if org is null or not public.tem_permissao_da_area('rh.sst', 'aprovar') then
    raise exception 'Definir as exigências da função é de quem aprova em Saúde e segurança no RH.' using errcode = '42501';
  end if;
  delete from public.rh_position_requirements where id = p_id and organization_id = org returning * into r;
  if r.id is null then raise exception 'Exigência não encontrada.'; end if;
  perform public.emit_module_event(org, 'rh', 'rh.exigencia.removida', 'funcao', r.position_id::text,
    format('Exigência removida da função %s: %s', (select name from public.positions where id = r.position_id), coalesce(r.titulo, (select name from public.rh_ppe_items where id = r.ppe_item_id))),
    jsonb_build_object('tipo', r.tipo));
end;
$$;
revoke all on function public.rh_exigencia_remover(uuid) from public, anon;
grant execute on function public.rh_exigencia_remover(uuid) to authenticated;

-- Sugestões pelo histórico: EPI entregue a ≥ metade dos ativos da função nos últimos 12 meses.
create or replace function public.rh_exigencias_sugestoes()
returns table (position_id uuid, funcao text, ppe_item_id uuid, epi text, pessoas int, na_funcao int)
language sql
stable
security definer
set search_path = public
as $$
  with ativos as (
    select e.id, e.position_id from public.employees e
    where e.organization_id = public.current_organization_id() and e.active and e.position_id is not null
  ), total as (select a.position_id, count(*)::int n from ativos a group by 1),
  entregas as (
    select a.position_id, d.item_id, count(distinct d.employee_id)::int pessoas
    from public.rh_ppe_deliveries d join ativos a on a.id = d.employee_id
    where d.delivered_on >= (now() at time zone 'America/Sao_Paulo')::date - 365
    group by 1, 2
  )
  select x.position_id, p.name, x.item_id, i.name, x.pessoas, t.n
  from entregas x
  join total t on t.position_id = x.position_id
  join public.positions p on p.id = x.position_id
  join public.rh_ppe_items i on i.id = x.item_id and i.active
  where public.has_feature('rh.sst') and x.pessoas * 2 >= t.n
    and not exists (select 1 from public.rh_position_requirements r where r.position_id = x.position_id and r.tipo = 'epi' and r.ppe_item_id = x.item_id)
  order by p.name, x.pessoas desc, i.name;
$$;
revoke all on function public.rh_exigencias_sugestoes() from public, anon;
grant execute on function public.rh_exigencias_sugestoes() to authenticated;

-- Pendências: cada colaborador ativo × cada exigência da sua função, com a situação calculada.
create or replace function public.rh_exigencias_pendencias()
returns table (
  employee_id uuid, colaborador text, setor text, funcao text, requirement_id uuid, tipo text, exigencia text,
  validade_dias int, ultima date, vence date, situacao text
)
language sql
stable
security definer
set search_path = public
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
  base as (
    select e.id employee_id, e.full_name, dep.name setor, p.name funcao, r.id requirement_id, r.tipo, r.validade_dias,
      coalesce(r.titulo, i.name) exigencia, r.ppe_item_id, r.titulo
    from public.employees e
    join public.positions p on p.id = e.position_id
    join public.rh_position_requirements r on r.position_id = e.position_id
    left join public.rh_ppe_items i on i.id = r.ppe_item_id
    left join public.departments dep on dep.id = e.department_id
    where e.organization_id = public.current_organization_id() and e.active and public.has_feature('rh.sst')
  ), calc as (
    select b.*,
      case when b.tipo = 'epi' then (select max(d.delivered_on) from public.rh_ppe_deliveries d where d.employee_id = b.employee_id and d.item_id = b.ppe_item_id)
        else (select max(coalesce(s.completed_at::date, null)) from public.rh_sst_records s
              where s.employee_id = b.employee_id and s.category::text = case when b.tipo = 'exame' then 'exam' else 'training' end
                and lower(btrim(s.title)) = lower(btrim(b.titulo))) end ultima,
      case when b.tipo = 'epi' then null
        else (select min(s.due_date) from public.rh_sst_records s
              where s.employee_id = b.employee_id and s.category::text = case when b.tipo = 'exame' then 'exam' else 'training' end
                and lower(btrim(s.title)) = lower(btrim(b.titulo)) and s.completed_at is null) end proximo,
      case when b.tipo = 'epi' then false
        else exists (select 1 from public.rh_sst_records s
              where s.employee_id = b.employee_id and s.category::text = case when b.tipo = 'exame' then 'exam' else 'training' end
                and lower(btrim(s.title)) = lower(btrim(b.titulo))) end tem_registro
    from base b
  )
  select c.employee_id, c.full_name, c.setor, c.funcao, c.requirement_id, c.tipo, c.exigencia, c.validade_dias, c.ultima,
    coalesce(c.proximo, case when c.ultima is not null and c.validade_dias is not null then c.ultima + c.validade_dias end) vence,
    case
      when c.tipo = 'epi' and c.ultima is null then 'nunca_entregue'
      when c.tipo <> 'epi' and not c.tem_registro then 'sem_registro'
      when coalesce(c.proximo, case when c.ultima is not null and c.validade_dias is not null then c.ultima + c.validade_dias end) < (select d from hoje) then 'vencido'
      when coalesce(c.proximo, case when c.ultima is not null and c.validade_dias is not null then c.ultima + c.validade_dias end) <= (select d from hoje) + 30 then 'a_vencer'
      else 'em_dia'
    end
  from calc c
  order by c.setor nulls last, c.full_name, c.tipo, c.exigencia;
$$;
revoke all on function public.rh_exigencias_pendencias() from public, anon;
grant execute on function public.rh_exigencias_pendencias() to authenticated;
