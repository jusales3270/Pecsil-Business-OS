-- Pecsil Business OS — Ações específicas do Financeiro
-- Separada do schema para que os novos valores do enum estejam disponíveis
-- em uma transação posterior em qualquer versão suportada do PostgreSQL.

alter type public.permission_action add value if not exists 'settle';
alter type public.permission_action add value if not exists 'reconcile';

