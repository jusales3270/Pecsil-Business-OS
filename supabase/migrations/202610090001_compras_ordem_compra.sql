-- Ordem de Compra (09/10/2026): dados do pedido que a Kaylane informa na
-- própria cotação, para o Ricardo aprovar já vendo o total, e o CEP do
-- fornecedor, que sai no quadro do fornecedor da OC.
-- As políticas de RLS existentes de cotacoes e suppliers já cobrem as colunas.

alter table public.cotacoes
  add column if not exists frete_tipo text not null default 'CIF',
  add column if not exists frete_valor numeric(14,2) not null default 0,
  add column if not exists seguro_valor numeric(14,2) not null default 0,
  add column if not exists outras_despesas numeric(14,2) not null default 0,
  add column if not exists prazo_entrega date,
  add column if not exists observacao text;

alter table public.cotacoes drop constraint if exists cotacoes_frete_tipo_check;
alter table public.cotacoes add constraint cotacoes_frete_tipo_check check (frete_tipo in ('CIF', 'FOB', 'SEM'));
alter table public.cotacoes drop constraint if exists cotacoes_despesas_check;
alter table public.cotacoes add constraint cotacoes_despesas_check check (frete_valor >= 0 and seguro_valor >= 0 and outras_despesas >= 0);
alter table public.cotacoes drop constraint if exists cotacoes_observacao_tamanho;
alter table public.cotacoes add constraint cotacoes_observacao_tamanho check (observacao is null or char_length(observacao) <= 2000);

comment on column public.cotacoes.frete_tipo is 'Modalidade do frete na Ordem de Compra: CIF (remetente), FOB (destinatário) ou SEM.';
comment on column public.cotacoes.frete_valor is 'Frete cobrado pelo fornecedor no pedido (soma no total da OC).';
comment on column public.cotacoes.prazo_entrega is 'Prazo de entrega combinado com o fornecedor (sai na OC).';
comment on column public.cotacoes.observacao is 'Observação do pedido para o fornecedor (sai na OC).';

alter table public.suppliers add column if not exists postal_code text;
alter table public.suppliers drop constraint if exists suppliers_postal_code_check;
alter table public.suppliers add constraint suppliers_postal_code_check check (postal_code is null or postal_code ~ '^\d{8}$');
comment on column public.suppliers.postal_code is 'CEP, só os 8 dígitos.';
