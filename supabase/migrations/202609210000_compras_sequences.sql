-- ============================================================================
-- Compras: sequências de id atrás dos dados importados
-- ============================================================================
-- A importação do app antigo gravou cotações, produtos, compras e notificações
-- com ids explícitos (até 191, 515, 266 e 607) sem avançar as sequências, que
-- ficaram em 1–4. Todo registro novo criado pela tela falhava com "id
-- duplicado". Idempotente: só avança, nunca volta.
-- ============================================================================
select setval('public.cotacoes_id_seq', greatest((select coalesce(max(id), 0) from public.cotacoes), (select last_value from public.cotacoes_id_seq)));
select setval('public.cotacao_produtos_id_seq', greatest((select coalesce(max(id), 0) from public.cotacao_produtos), (select last_value from public.cotacao_produtos_id_seq)));
select setval('public.compras_id_seq', greatest((select coalesce(max(id), 0) from public.compras), (select last_value from public.compras_id_seq)));
select setval('public.notificacoes_compras_id_seq', greatest((select coalesce(max(id), 0) from public.notificacoes_compras), (select last_value from public.notificacoes_compras_id_seq)));
