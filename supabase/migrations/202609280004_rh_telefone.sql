-- ============================================================================
-- RH › Colaboradores: telefone do colaborador
-- ============================================================================
-- O formulário pedia telefone, mas não havia onde guardar: o valor sumia ao
-- recarregar. Fica junto do CPF, na tabela de dados pessoais, com a mesma
-- proteção (leitura e escrita só com rh.colaboradores em "operar", ou o
-- próprio colaborador lendo o seu).
-- ============================================================================

alter table public.rh_employee_personal_data
  add column if not exists phone text;

-- O CPF passa a ser opcional: dá para registrar o telefone de quem ainda
-- não teve o CPF lançado.
alter table public.rh_employee_personal_data
  alter column cpf drop not null;
