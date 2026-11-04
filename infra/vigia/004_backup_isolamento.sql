-- ============================================================
-- Isolamento do backup em um projeto de nuvem compartilhado
-- ============================================================
-- Executar DEPOIS de 001_vigia.sql e 002_backup.sql, dentro de uma
-- transação do instalador (BEGIN/COMMIT). Não é uma migração da fábrica.
--
-- Políticas permissivas do aplicativo anterior são combinadas com OR.
-- Estas quatro políticas RESTRITIVAS acrescentam uma condição obrigatória
-- somente ao bucket "backups", preservando os demais buckets e políticas.
-- O usuário dedicado pode apenas inserir arquivos novos; não pode listar,
-- ler, substituir, mover nem apagar as cópias. A retenção administrativa
-- continua usando service_role (BYPASSRLS), nunca a conta do servidor.

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Storage não encontrado. Instale o Storage deste projeto antes do isolamento do backup.';
  end if;
  if to_regprocedure('public.vigia_e_backup()') is null then
    raise exception 'Função de autorização do backup ausente. Execute 001_vigia.sql e 002_backup.sql primeiro.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'backups' and public = false) then
    raise exception 'O bucket backups precisa existir e ser privado. Confira 002_backup.sql antes de continuar.';
  end if;
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'RLS precisa estar habilitado em storage.objects antes do isolamento do backup.';
  end if;
end $$;

drop policy if exists "vigia: backups isolados select" on storage.objects;
create policy "vigia: backups isolados select" on storage.objects
  as restrictive for select to anon, authenticated
  using (bucket_id <> 'backups');

drop policy if exists "vigia: backups isolados delete" on storage.objects;
create policy "vigia: backups isolados delete" on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id <> 'backups');

drop policy if exists "vigia: backups isolados update" on storage.objects;
create policy "vigia: backups isolados update" on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'backups')
  with check (bucket_id <> 'backups');

drop policy if exists "vigia: backups isolados insert" on storage.objects;
create policy "vigia: backups isolados insert" on storage.objects
  as restrictive for insert to anon, authenticated
  with check (
    case when bucket_id = 'backups' then
      current_user = 'authenticated'
      and auth.uid() is not null
      and coalesce(public.vigia_e_backup(), false)
    else true end
  );
