-- Visões salvas do Segundo Cérebro (etapa G2, docs/PLANO-WAR-ROOM-CEREBRO.md), 19/10/2026.
-- Uma visão guarda os filtros e o foco do grafo ("dependências da Fundição", "fornecedores da resina")
-- para abrir de novo na reunião. Quem tem o War Room vê e usa todas (W2); grava pelas funções abaixo.

create table if not exists public.cerebro_visoes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  nome            text not null check (length(trim(nome)) between 2 and 80),
  -- { tipos, familias, desde, pecas, foco: { modo, no, profundidade, sentido, ate } }
  filtros         jsonb not null default '{}'::jsonb check (length(filtros::text) <= 8000),
  criado_por      uuid references public.profiles (id) on delete set null,
  criado_por_nome text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, nome)
);
alter table public.cerebro_visoes enable row level security;
drop policy if exists cerebro_visoes_read on public.cerebro_visoes;
create policy cerebro_visoes_read on public.cerebro_visoes for select using (
  organization_id = (select public.current_organization_id()) and (select public.has_feature('warroom.cerebro')));
revoke insert, update, delete on public.cerebro_visoes from anon, authenticated;
grant select on public.cerebro_visoes to authenticated;

create or replace function public.cerebro_salvar_visao(p_nome text, p_filtros jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  v uuid;
begin
  if org is null or not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_nome, ''))) < 2 then raise exception 'Dê um nome à visão.'; end if;
  if jsonb_typeof(coalesce(p_filtros, '{}'::jsonb)) <> 'object' then raise exception 'Filtros inválidos.'; end if;
  insert into public.cerebro_visoes (organization_id, nome, filtros, criado_por, criado_por_nome)
  values (org, left(trim(p_nome), 80), coalesce(p_filtros, '{}'::jsonb), public.current_profile_id(),
          (select full_name from public.profiles where id = public.current_profile_id()))
  on conflict (organization_id, nome) do update set filtros = excluded.filtros, updated_at = now()
  returning id into v;
  return v;
end $$;
revoke all on function public.cerebro_salvar_visao(text, jsonb) from public, anon;
grant execute on function public.cerebro_salvar_visao(text, jsonb) to authenticated;

create or replace function public.cerebro_apagar_visao(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  delete from public.cerebro_visoes where id = p_id and organization_id = public.current_organization_id();
end $$;
revoke all on function public.cerebro_apagar_visao(uuid) from public, anon;
grant execute on function public.cerebro_apagar_visao(uuid) to authenticated;

-- Registros de origem da ligação, em português: quantidade sem os zeros decimais ("210 kg", não "210.000 kg")
-- e a situação com o nome da tela ("quitado", não "settled").
create or replace function public.cerebro_registros(p_tabela text, p_ids text[])
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_feature('warroom.cerebro') then raise exception 'Sem acesso ao Segundo Cérebro.' using errcode = '42501'; end if;
  if p_tabela = 'compras' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', 'compra', 'data', c.data_compra, 'titulo', c.produto,
        'detalhe', concat_ws(' · ', trim_scale(c.quantidade)::text || ' ' || coalesce(c.unidade, ''), 'NF ' || nullif(c.nf, '')), 'valor', c.total, 'valor_unit', c.valor_unit,
        'link', '/?module=compras&secao=Realizadas') order by c.data_compra desc)
      from public.compras c where c.organization_id = public.current_organization_id() and c.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'cotacoes' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'tipo', 'cotação', 'data', k.created_at::date, 'titulo', k.produto,
        'detalhe', concat_ws(' · ', case k.status when 'PENDENTE' then 'pendente' when 'APROVADO' then 'aprovada' when 'REJEITADO' then 'rejeitada' when 'COMPRADO' then 'comprada' else lower(k.status) end,
          case k.divisao when 'FUNDICAO' then 'Fundição' when 'USINAGEM' then 'Usinagem' else k.divisao end, nullif(k.prazo, '')), 'valor_unit', k.valor_unit, 'link', '/?module=compras&secao=Cota%C3%A7%C3%B5es') order by k.created_at desc)
      from public.cotacoes k where k.organization_id = public.current_organization_id() and k.id::text = any (p_ids)), '[]'::jsonb);
  elsif p_tabela = 'finance_titles' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'tipo', case when t.direction::text = 'payable' then 'conta a pagar' else 'conta a receber' end,
        'data', t.issue_date, 'titulo', coalesce(nullif(t.description, ''), t.counterparty_name), 'detalhe', concat_ws(' · ', nullif(t.document_number, ''), case t.status::text when 'settled' then 'quitado' when 'approved' then 'em aberto'
          when 'pending_approval' then 'em aprovação' when 'partially_settled' then 'pago em parte' when 'overdue' then 'vencido' when 'cancelled' then 'cancelado'
          when 'draft' then 'rascunho' else t.status::text end),
        'valor', t.original_amount, 'link', case when t.direction::text = 'payable' then '/?module=financeiro&secao=Contas%20a%20pagar' else '/?module=financeiro&secao=Contas%20a%20receber' end)
        order by t.issue_date desc)
      from public.finance_titles t where t.organization_id = public.current_organization_id() and t.id::text = any (p_ids)), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
revoke all on function public.cerebro_registros(text, text[]) from public, anon;
grant execute on function public.cerebro_registros(text, text[]) to authenticated;
