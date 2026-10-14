-- ============================================================================
-- Quadro de terceiros: o RH inclui e exclui os prestadores (14/10/2026, pedido do proprietário)
-- ============================================================================
-- Até aqui a lista de prestadores que a Portaria escolhe ao registrar a entrada era fixa no
-- código. Agora fica no banco:
--   - a Portaria (portaria.terceiros) e o RH (rh.terceiros) leem;
--   - incluir e excluir só pelo RH, com "Terceiros" em Operar, pelas funções abaixo;
--   - excluir não apaga: a linha sai do quadro com quem e quando excluiu. Os apontamentos já
--     feitos (tabela terceiros, que guarda o nome) não mudam.
-- Os apontamentos de entrada e saída continuam exclusivos da Portaria.
-- ============================================================================

insert into public.access_features (code, module_code, label, levels, sort) values
  ('rh.terceiros', 'rh', 'Terceiros', '{ver,operar}', 75)
on conflict (code) do update set levels = excluded.levels;

create table if not exists public.terceiros_quadro (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 80),
  ativo boolean not null default true,
  incluido_por uuid references public.profiles(id) on delete set null,
  incluido_por_nome text,
  incluido_em timestamptz not null default now(),
  removido_por uuid references public.profiles(id) on delete set null,
  removido_por_nome text,
  removido_em timestamptz
);
-- O mesmo nome não aparece duas vezes no quadro ativo (a Portaria escolhe pelo nome).
create unique index if not exists terceiros_quadro_nome_ativo on public.terceiros_quadro (organization_id, lower(btrim(nome))) where ativo;

alter table public.terceiros_quadro enable row level security;
drop policy if exists terceiros_quadro_read on public.terceiros_quadro;
create policy terceiros_quadro_read on public.terceiros_quadro for select to authenticated
using (organization_id = public.current_organization_id() and (public.has_feature('portaria.terceiros') or public.has_feature('rh.terceiros')));
-- Sem policy de escrita: só pelas funções.
revoke insert, update, delete on public.terceiros_quadro from anon, authenticated;
grant select on public.terceiros_quadro to authenticated;

create or replace function public.rh_terceiro_incluir(p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  v_nome text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  novo public.terceiros_quadro%rowtype;
begin
  if org is null or not public.has_feature('rh.terceiros', 'operar') then
    raise exception 'Sem permissão para alterar o quadro de terceiros.' using errcode = '42501';
  end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 80 then raise exception 'Informe o nome do terceiro (2 a 80 letras).'; end if;
  if exists (select 1 from public.terceiros_quadro q where q.organization_id = org and q.ativo and lower(btrim(q.nome)) = lower(v_nome)) then
    raise exception '% já está no quadro de terceiros.', v_nome;
  end if;
  insert into public.terceiros_quadro (organization_id, nome, incluido_por, incluido_por_nome)
  values (org, v_nome, me, meu_nome) returning * into novo;
  perform public.emit_module_event(org, 'rh', 'rh.terceiro.incluido', 'terceiro', novo.id::text,
    format('Terceiro incluído no quadro · %s', v_nome), jsonb_build_object('nome', v_nome));
  perform public.notify_feature(org, 'portaria.terceiros', 'operar', 'portaria', 'info',
    format('Novo terceiro no quadro · %s', v_nome), 'O RH incluiu o prestador. Ele já aparece na lista ao registrar a entrada.',
    '/?module=portaria', me);
  return jsonb_build_object('id', novo.id, 'nome', novo.nome);
end;
$$;

create or replace function public.rh_terceiro_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  meu_nome text := (select full_name from public.profiles where id = public.current_profile_id());
  alvo public.terceiros_quadro%rowtype;
begin
  if org is null or not public.has_feature('rh.terceiros', 'operar') then
    raise exception 'Sem permissão para alterar o quadro de terceiros.' using errcode = '42501';
  end if;
  update public.terceiros_quadro set ativo = false, removido_por = me, removido_por_nome = meu_nome, removido_em = now()
   where id = p_id and organization_id = org and ativo
  returning * into alvo;
  if alvo.id is null then raise exception 'Terceiro não encontrado no quadro.'; end if;
  perform public.emit_module_event(org, 'rh', 'rh.terceiro.excluido', 'terceiro', alvo.id::text,
    format('Terceiro excluído do quadro · %s', alvo.nome), jsonb_build_object('nome', alvo.nome));
  perform public.notify_feature(org, 'portaria.terceiros', 'operar', 'portaria', 'info',
    format('Terceiro saiu do quadro · %s', alvo.nome), 'O RH excluiu o prestador. Ele não aparece mais na lista ao registrar a entrada.',
    '/?module=portaria', me);
  return jsonb_build_object('id', alvo.id, 'nome', alvo.nome);
end;
$$;

revoke all on function public.rh_terceiro_incluir(text) from public, anon;
revoke all on function public.rh_terceiro_excluir(uuid) from public, anon;
grant execute on function public.rh_terceiro_incluir(text) to authenticated;
grant execute on function public.rh_terceiro_excluir(uuid) to authenticated;

-- Quadro inicial: os prestadores que estavam fixos na Portaria, só para quem já usa os terceiros.
insert into public.terceiros_quadro (organization_id, nome, incluido_por_nome)
select o.id, n.nome, 'Lista anterior da Portaria'
  from public.organizations o
  cross join unnest(array['Adriano', 'Ailton', 'Alex', 'Claudemir', 'Dalvacy', 'Diego', 'Everton', 'Márcio', 'Nilton', 'Romualdo',
                          'Victor', 'Victor Pinheiro', 'Wesley']) as n(nome)
 where exists (select 1 from public.terceiros t where t.organization_id = o.id)
   and not exists (select 1 from public.terceiros_quadro q where q.organization_id = o.id);
