-- Fiscal: NF-e "transmitindo" (29/10/2026 — F1 de docs/PLANO-EMISSAO-NFE.md, emissão em homologação).
--
--   * Ao transmitir de verdade, a nota passa a "transmitindo" ANTES de ir à SEFAZ: um segundo clique não manda a
--     mesma nota duas vezes.
--   * Se a resposta da SEFAZ se perde (rede, tempo esgotado), a nota FICA "transmitindo" até alguém consultar a
--     SEFAZ pela chave: nunca se reenvia às cegas (a SEFAZ pode ter autorizado).
--   * Rejeição da SEFAZ: "rejeitada", com o motivo; volta para edição e mantém o número.

alter table public.fiscal_nfe drop constraint if exists fiscal_nfe_situacao_check;
alter table public.fiscal_nfe add constraint fiscal_nfe_situacao_check
  check (situacao in ('rascunho', 'validada', 'aguardando_aprovacao', 'transmitindo', 'autorizada', 'rejeitada', 'cancelada'));

alter table public.fiscal_nfe add column if not exists sefaz_cstat text;
alter table public.fiscal_nfe add column if not exists transmitida_em timestamptz;
comment on column public.fiscal_nfe.sefaz_cstat is 'Último código da SEFAZ para a nota (100 autorizada; rejeição; 217 não consta).';
comment on column public.fiscal_nfe.transmitida_em is 'Quando foi à SEFAZ pela última vez (homologação ou produção).';
