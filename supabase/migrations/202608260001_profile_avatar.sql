-- ============================================================================
-- Pecsil Business OS — Foto de perfil (autosserviço da conta)
--
-- Acrescenta a foto do usuário e o bucket de Storage correspondente.
--
-- Diferente de `rh-documents`, este bucket é PÚBLICO para leitura: uma foto de
-- perfil precisa aparecer em avatares, listas e cabeçalhos, e URL assinada com
-- validade curta obrigaria a renovar a imagem o tempo todo. Não há dado
-- sensível aqui — e a ESCRITA continua restrita: cada pessoa só grava na
-- própria pasta, cujo nome é o id do perfil.
--
-- Convenção de caminho: {profile_id}/{arquivo}
-- ============================================================================

alter table public.profiles
  add column if not exists avatar_path text;

comment on column public.profiles.avatar_path is
  'Caminho do arquivo no bucket "avatars" ({profile_id}/{arquivo}). Nulo = usa as iniciais.';

-- --- Bucket -----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- --- RLS do Storage ---------------------------------------------------------
-- Leitura é pública (o bucket é público). Escrita: só o dono da pasta.
drop policy if exists avatars_objects_insert on storage.objects;
drop policy if exists avatars_objects_update on storage.objects;
drop policy if exists avatars_objects_delete on storage.objects;

create policy avatars_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
);

create policy avatars_objects_update on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
);

create policy avatars_objects_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = public.current_profile_id()::text
);

-- --- Autosserviço do próprio perfil -----------------------------------------
-- `profiles_update_self` já permitia o UPDATE do próprio registro. Recriada
-- aqui apenas para deixar explícito que nome e foto são editáveis pelo dono,
-- mas e-mail, organização e situação NÃO — esses continuam sendo administração.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and organization_id = public.current_organization_id()
);

-- Blindagem: mesmo com a policy acima, um UPDATE direto não pode trocar
-- e-mail, organização, situação nem o vínculo com auth.users.
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
  return new;
end;
$$;

revoke all on function public.profiles_protect_self_update() from public;

drop trigger if exists profiles_protect_self on public.profiles;
create trigger profiles_protect_self
before update on public.profiles
for each row execute function public.profiles_protect_self_update();
