-- Fuso de Brasília nas conexões da plataforma (13/10/2026).
--
-- O banco trabalha em UTC: depois das 21h de Brasília, "hoje" (current_date) já é o dia seguinte.
-- Isso afetava 6 valores automáticos (compras.data_compra, receipts.recebido_em,
-- fiscal_malotes.enviado_em, production_entries.data, sales_quotes.data_orcamento,
-- rh_benefit_enrollments.enrolled_at) e 10 funções (recebimento, baixa e previsões do Financeiro,
-- previsão de compra, portal do contador, orçamento ganho…).
--
-- Em vez de reescrever cada uma, as conexões da plataforma (o papel `authenticator`, por onde
-- passam o navegador e o servidor) passam a trabalhar no fuso de Brasília. Datas e horas gravadas
-- não mudam (timestamptz é guardado em UTC); muda só o "hoje" e o fuso em que as horas são
-- devolvidas (-03:00). O login (supabase_auth_admin) e o armazenamento não são afetados.
-- Desfazer: alter role authenticator reset timezone;
-- (Produto multiempresa: o fuso por empresa fica para quando houver empresa fora deste fuso.)
alter role authenticator set timezone to 'America/Sao_Paulo';

-- As conexões já abertas só leem a configuração ao reconectar: elas são encerradas e o
-- PostgREST reconecta sozinho (no máximo um pedido em andamento precisa ser repetido).
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'authenticator' and pid <> pg_backend_pid();
