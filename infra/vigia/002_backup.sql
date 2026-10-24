-- ============================================================
-- Backup externo da Pecsil (T-02 = B-02, docs/PLANO-TI.md §10)
-- ============================================================
-- Roda no MESMO projeto Supabase da nuvem do vigia (rodar depois do 001).
--
-- O serviço de backup da fábrica (services/backup) envia, todo dia, os
-- arquivos JÁ CRIPTOGRAFADOS (age, com a chave pública da Pecsil; a chave
-- privada fica só com o proprietário). A nuvem guarda um arquivo que ela mesma
-- não consegue ler: CPF, salários, documentos do RH e fotos não saem legíveis.
--
-- O servidor da fábrica SÓ GRAVA: entra com um usuário próprio (Auth do projeto)
-- que tem permissão de inserir no bucket "backups" e mais nada — não lista, não
-- sobrescreve, não apaga. Se o servidor for invadido, as cópias antigas ficam.
-- Quem apaga as cópias vencidas é a própria nuvem (vigia_backup_limpar), e nunca
-- as mais recentes.
--
-- Cada backup completo avisa o vigia (alvo "backup-pecsil"); se ficar mais de
-- 26 h sem aviso, abre incidente e alerta como qualquer queda.
-- ============================================================

-- Bucket privado, até 50 MB por arquivo (limite do plano gratuito; o serviço
-- divide em partes os arquivos maiores).
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- O usuário do backup é cadastrado em Authentication > Users e o id dele vai em
-- vigia_config ('backup_user_id').
create or replace function public.vigia_e_backup() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and auth.uid()::text = (select valor from public.vigia_config where chave = 'backup_user_id')
$$;
grant execute on function public.vigia_e_backup() to authenticated;

drop policy if exists "vigia: backup só grava" on storage.objects;
create policy "vigia: backup só grava" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'backups' and public.vigia_e_backup());

-- Retenção: 1 por dia nos últimos 8 dias e o de domingo por 5 semanas. Nunca apaga
-- os 30 arquivos mais recentes (se o backup parar, os últimos ficam).
-- O apagar passa pela API do Storage (o arquivo e o registro), com a chave de
-- serviço do próprio projeto guardada no Vault ('vigia_service_key').
create or replace function public.vigia_backup_vencidos() returns setof text
language sql stable security definer set search_path = public as $$
  select o.name from storage.objects o
   where o.bucket_id = 'backups'
     and o.created_at < now() - interval '8 days'
     and not (extract(dow from o.created_at at time zone 'America/Sao_Paulo') = 0 and o.created_at > now() - interval '36 days')
     and o.name not in (select r.name from storage.objects r where r.bucket_id = 'backups' order by r.created_at desc limit 30)
$$;

create or replace function public.vigia_backup_limpar() returns integer
language plpgsql security definer set search_path = public as $$
declare
  projeto text := (select valor from public.vigia_config where chave = 'projeto_url');
  chave text;
  n integer := 0;
  nome text;
begin
  begin
    select decrypted_secret into chave from vault.decrypted_secrets where name = 'vigia_service_key' limit 1;
  exception when others then chave := null;
  end;
  if projeto is null or chave is null then return 0; end if;
  for nome in select public.vigia_backup_vencidos() loop
    perform net.http_delete(
      url => format('%s/storage/v1/object/backups/%s', rtrim(projeto, '/'), nome),
      -- chave nova (sb_secret_…) vai só no apikey; a antiga (JWT) também no Authorization
      headers => case when chave like 'eyJ%' then jsonb_build_object('Authorization', 'Bearer ' || chave, 'apikey', chave) else jsonb_build_object('apikey', chave) end,
      timeout_milliseconds => 15000);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.vigia_backup_vencidos() from public, anon, authenticated;
revoke all on function public.vigia_backup_limpar() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'vigia-backup-limpar';
select cron.schedule('vigia-backup-limpar', '30 9 * * *', 'select public.vigia_backup_limpar()');

-- O aviso do backup: um sinal por dia; 26 h sem ele vira incidente.
insert into public.vigia_alvos (id, nome, tipo, tolerancia_s, aviso_parada)
values ('backup-pecsil', 'Backup diário', 'sinal', 93600, 'o backup diário não chegou (serviço de backup parado ou com erro)')
on conflict (id) do update set tolerancia_s = excluded.tolerancia_s, aviso_parada = excluded.aviso_parada;
