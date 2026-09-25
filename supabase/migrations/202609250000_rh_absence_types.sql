-- ============================================================================
-- RH — tipos de ausência que o histórico da PecSil usa
-- ============================================================================
-- Separado da migração seguinte porque valor novo de enum só pode ser usado
-- depois do commit (mesma razão de 202608150001_rh_enums.sql).
--
-- Cada tipo tem efeito diferente na lei e no indicador; juntar tudo em "licença"
-- esconderia, por exemplo, afastamento pelo INSS no meio de doação de sangue.
-- ============================================================================

alter type public.rh_absence_type add value if not exists 'attendance_statement'; -- consulta ou exame em horas, com declaração
alter type public.rh_absence_type add value if not exists 'family_care';          -- acompanhamento de familiar
alter type public.rh_absence_type add value if not exists 'occupational_exam';    -- exame periódico, admissional, de retorno
alter type public.rh_absence_type add value if not exists 'legal_leave';          -- falecimento, casamento, doação de sangue (CLT art. 473)
alter type public.rh_absence_type add value if not exists 'justified_absence';    -- fórum, CNH, eleitoral, escola: ausência justificada
alter type public.rh_absence_type add value if not exists 'inss_leave';           -- afastamento pelo INSS
alter type public.rh_absence_type add value if not exists 'work_accident';        -- acidente de trabalho
alter type public.rh_absence_type add value if not exists 'maternity_leave';      -- licença-maternidade
