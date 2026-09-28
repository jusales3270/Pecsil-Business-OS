-- ============================================================================
-- Usuário do Administrativo
-- ============================================================================
-- Terceiro tipo de acesso, ao lado de colaborador (ficha no RH) e terceiro
-- (prestador externo): a pessoa do administrativo, cadastrada pelo nome e
-- pelo cargo — diretor, gerente, assistente ou estagiário. Mesmo controle de
-- módulos → funcionalidades → nível dos outros tipos.
-- ============================================================================

alter table public.profiles
  add column if not exists job_title text;

alter table public.profiles drop constraint if exists profiles_account_type_check;
alter table public.profiles
  add constraint profiles_account_type_check
  check (account_type in ('colaborador', 'terceiro', 'administrativo'));

do $$ begin
  alter table public.profiles
    add constraint profiles_job_title_check
    check (job_title is null or job_title in ('diretor', 'gerente', 'assistente', 'estagiario'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_administrativo_job_title_check
    check (account_type <> 'administrativo' or job_title is not null);
exception when duplicate_object then null; end $$;

-- Ninguém muda o próprio tipo, a empresa, a validade nem o próprio cargo.
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
  new.job_title := old.job_title;
  return new;
end;
$$;
