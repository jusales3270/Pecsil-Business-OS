-- ============================================================
-- Papel só de leitura para o backup externo (T-02 = B-02, docs/PLANO-TI.md)
-- ============================================================
-- O serviço de backup (services/backup) faz o pg_dump com este papel: lê todas
-- as tabelas (pg_read_all_data) e ignora o RLS (BYPASSRLS), para o backup sair
-- completo, mas não grava, não altera e não apaga nada.
--
-- A senha NÃO fica neste arquivo: é definida à parte, como verificador SCRAM
-- (o texto da senha não trafega), e vai só para a variável do serviço no Coolify.
-- Conexão pelo pooler: usuário "backup_leitura.<tenant>" na porta 5432.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_leitura') then
    create role backup_leitura login bypassrls inherit connection limit 3;
  end if;
end $$;

grant pg_read_all_data to backup_leitura;
alter role backup_leitura set default_transaction_read_only = on;
alter role backup_leitura set statement_timeout = 0;
alter role backup_leitura set idle_in_transaction_session_timeout = '30min';

comment on role backup_leitura is 'Backup externo (T-02): só leitura, sem RLS, sem gravação. Senha só no Coolify.';
