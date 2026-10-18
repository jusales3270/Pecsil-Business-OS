-- Avisos da SARA (I-12, proprietário 18/10/2026): o que cada pessoa já viu. O aviso (vermelho ou azul)
-- pulsa até a pessoa abrir a SARA e vê-lo; depois disso aquela chave não pulsa mais para ela. A chave
-- carrega a situação (ex.: quantos lançamentos a conciliar): se a situação mudar, é outro aviso.
-- Os avisos em si não ficam no banco: são calculados dos dados, com as permissões de quem está logado.

create table if not exists public.sara_alertas_vistos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  chave text not null check (length(chave) between 3 and 300),
  nivel text not null check (nivel in ('urgente', 'aviso')),
  visto_em timestamptz not null default now(),
  primary key (profile_id, chave)
);
create index if not exists idx_sara_alertas_vistos_org on public.sara_alertas_vistos (organization_id, visto_em desc);

alter table public.sara_alertas_vistos enable row level security;
drop policy if exists sara_alertas_vistos_leitura on public.sara_alertas_vistos;
create policy sara_alertas_vistos_leitura on public.sara_alertas_vistos for select to authenticated
  using (organization_id = (select public.current_organization_id()) and profile_id = (select public.current_profile_id()));
grant select on public.sara_alertas_vistos to authenticated;

-- Marca como vistos os avisos que a pessoa acabou de ver (só para ela mesma).
create or replace function public.sara_alertas_marcar(p_alertas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_organization_id();
  me uuid := public.current_profile_id();
  n integer;
begin
  if org is null or me is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  insert into public.sara_alertas_vistos (organization_id, profile_id, chave, nivel)
  select org, me, left(a->>'chave', 300), a->>'nivel'
  from jsonb_array_elements(coalesce(p_alertas, '[]'::jsonb)) a
  where length(coalesce(a->>'chave', '')) >= 3 and a->>'nivel' in ('urgente', 'aviso')
  limit 100
  on conflict (profile_id, chave) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.sara_alertas_marcar(jsonb) from public, anon;
grant execute on function public.sara_alertas_marcar(jsonb) to authenticated;
