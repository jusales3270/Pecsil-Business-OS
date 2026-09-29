-- ============================================================================
-- Compras: valor unitário com até 4 casas decimais
-- ============================================================================
-- O app do Compras passou a aceitar 3 casas no valor unitário (21/09/2026), e o
-- banco dele guarda numeric(14,4). Aqui o valor era numeric(12,2): 1,235 viraria
-- 1,24 ao migrar ou ao lançar. O total continua em centavos (a soma é que
-- arredonda), como no app.
-- ============================================================================

alter table public.cotacoes alter column valor_unit type numeric(14,4);
alter table public.cotacao_produtos alter column valor_unit type numeric(14,4);
alter table public.compras alter column valor_unit type numeric(14,4);
