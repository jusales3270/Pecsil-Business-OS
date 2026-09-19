-- ============================================================================
-- Terceiros com acesso à plataforma
-- ============================================================================
-- Até aqui todo acesso nascia de um colaborador do RH. Prestadores de fora do
-- quadro (contabilidade, TI, manutenção) também precisam entrar, com o mesmo
-- controle de módulos → funcionalidades → nível. O terceiro é um perfil sem
-- ficha no RH, com a empresa prestadora e, opcionalmente, uma validade.
--
-- A validade vale no ponto central do RLS: current_profile_id(),
-- current_organization_id() e is_owner() deixam de reconhecer o perfil depois
-- da data. Nenhuma policy libera nada a um acesso vencido, e renovar a data
-- devolve o acesso sem refazer as permissões.
-- ============================================================================

alter table public.profiles
  add column if not exists account_type text not null default 'colaborador',
  add column if not exists company_name text,
  add column if not exists access_expires_at timestamptz;

do $$ begin
  alter table public.profiles
    add constraint profiles_account_type_check check (account_type in ('colaborador', 'terceiro'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_terceiro_company_check
    check (account_type <> 'terceiro' or nullif(btrim(company_name), '') is not null);
exception when duplicate_object then null; end $$;

-- Ninguém muda o próprio tipo, a empresa nem estende a própria validade.
create or replace function public.profiles_protect_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Administração (service role) passa direto; auth.uid() é nulo nela.
  if auth.uid() is null or new.user_id <> auth.uid() then
    return new;
  end if;
  new.email := old.email;
  new.organization_id := old.organization_id;
  new.status := old.status;
  new.user_id := old.user_id;
  new.is_owner := old.is_owner;
  new.account_type := old.account_type;
  new.company_name := old.company_name;
  new.access_expires_at := old.access_expires_at;
  return new;
end;
$$;

-- --- Validade no ponto central do RLS --------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles
  where user_id = auth.uid() and status = 'active'
    and (access_expires_at is null or access_expires_at > now())
  limit 1;
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles
  where user_id = auth.uid() and status = 'active'
    and (access_expires_at is null or access_expires_at > now())
  limit 1;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_owner from public.profiles p
    where p.user_id = auth.uid() and p.status = 'active'
      and (p.access_expires_at is null or p.access_expires_at > now())
    limit 1
  ), false);
$$;

create index if not exists idx_profiles_account_type on public.profiles(organization_id, account_type);
