-- ============================================================================
-- Trilha preserva o autor mesmo depois de excluir o usuário
-- ============================================================================
-- Até aqui audit_logs e module_events tinham chave estrangeira para profiles e
-- auth.users com ON DELETE SET NULL: excluir um usuário apagaria o autor de
-- todo o histórico dele. Trilha não se reescreve. Sem a chave, o id continua
-- no registro, e o evento "core.access.user.delete" guarda nome e e-mail de
-- quem foi excluído, o que mantém cada ação rastreável até a pessoa.
-- ============================================================================

alter table public.audit_logs drop constraint if exists audit_logs_actor_profile_id_fkey;
alter table public.audit_logs drop constraint if exists audit_logs_actor_user_id_fkey;
alter table public.module_events drop constraint if exists module_events_actor_profile_id_fkey;
