-- ============================================================================
-- IBS e CBS (N-03): o regime do emitente em cada nota lida (25/10/2026, conferência pela lei da data)
-- ============================================================================
-- O Simples Nacional (CRT 1, 2 e 4) só é obrigado a destacar o IBS/CBS a partir de 01/01/2027, e a base dele
-- não segue a conta do regime normal (ICMS, PIS e COFINS vão no DAS, sem destaque). Sem o CRT, a conferência
-- acusaria como falta ou divergência o que é dispensa. As notas já lidas ficam com o campo nulo e o servidor as
-- relê na próxima leitura (a tabela é derivada dos XMLs guardados).
-- ============================================================================

alter table public.fiscal_ibscbs_notas add column if not exists emitente_crt smallint check (emitente_crt is null or emitente_crt between 1 and 4);
comment on column public.fiscal_ibscbs_notas.emitente_crt is 'Regime do emitente na NF-e (CRT): 1 Simples Nacional, 2 Simples com excesso de sublimite, 3 regime normal, 4 MEI.';
