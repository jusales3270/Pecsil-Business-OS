-- ============================================================================
-- Máscaras de impostos para a virada do GRV (01/12/2026) — docs/PLANO-VIRADA-FISCAL.md, 1.4
-- ============================================================================
-- 1) Campos que o GRV usa e a máscara não tinha:
--    - cbenef: código de benefício fiscal da UF (em toda nota do GRV desde 2026: SP020120, SP070050…);
--    - icms_por_dentro: base = valor ÷ (1 − alíquota) (sucata, art. 392 do RICMS/SP);
--    - ipi_na_base_icms: IPI (e IPI devolvido) na base do ICMS fora da venda a consumidor final;
--    - pis_cofins_sem_base: PIS/COFINS de "outras operações" só informativo (base e valor zero);
--    - icms_mod_bc: modalidade da base do ICMS (vazio = 3, valor da operação);
--    - valores_informados: os valores do imposto são digitados na nota (DI da importação, crédito do CIAP).
-- 2) As máscaras da Pecsil completadas e as que faltavam, pelas 639 notas autorizadas que o GRV emitiu de janeiro a
--    outubro de 2026 (espelho: scripts/fiscal-espelho.mjs). Tudo entra como "tirado de nota emitida" e SEM
--    confirmação: a produção só aceita máscara confirmada pelo Jefferson (com o contador).
-- Só a empresa do CNPJ 46.839.106/0001-84; outra empresa não recebe nada (ECOS).
-- ============================================================================

alter table public.fiscal_mascaras add column if not exists cbenef text
  check (cbenef is null or cbenef ~ '^([!-ÿ]{8}|[!-ÿ]{10}|SEM CBENEF)$');
alter table public.fiscal_mascaras add column if not exists icms_por_dentro boolean not null default false;
alter table public.fiscal_mascaras add column if not exists ipi_na_base_icms boolean not null default false;
alter table public.fiscal_mascaras add column if not exists pis_cofins_sem_base boolean not null default false;
alter table public.fiscal_mascaras add column if not exists icms_mod_bc smallint check (icms_mod_bc is null or icms_mod_bc between 0 and 3);
alter table public.fiscal_mascaras add column if not exists valores_informados boolean not null default false;

-- Mudar um número (agora também o benefício e as regras da base) tira a confirmação do contador.
create or replace function public.fiscal_mascaras_autoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.current_profile_id(), new.updated_by);
  new.updated_by_name := coalesce((select full_name from public.profiles where id = public.current_profile_id()), new.updated_by_name);
  if tg_op = 'UPDATE' and old.confirmada_em is not null and new.confirmada_em is not distinct from old.confirmada_em
     and (new.cfop, new.ufs, new.icms_cst, new.icms_aliquota, new.icms_reducao_base, new.icms_diferimento, new.ipi_cst, new.ipi_aliquota,
          new.pis_cst, new.pis_aliquota, new.cofins_cst, new.cofins_aliquota, new.pis_cofins_exclui_icms, new.ibs_cbs_cst, new.cclasstrib,
          new.ibs_aliquota, new.cbs_aliquota, new.cbenef, new.icms_por_dentro, new.ipi_na_base_icms, new.pis_cofins_sem_base,
          new.icms_mod_bc, new.valores_informados, new.ipi_enquadramento)
         is distinct from
         (old.cfop, old.ufs, old.icms_cst, old.icms_aliquota, old.icms_reducao_base, old.icms_diferimento, old.ipi_cst, old.ipi_aliquota,
          old.pis_cst, old.pis_aliquota, old.cofins_cst, old.cofins_aliquota, old.pis_cofins_exclui_icms, old.ibs_cbs_cst, old.cclasstrib,
          old.ibs_aliquota, old.cbs_aliquota, old.cbenef, old.icms_por_dentro, old.ipi_na_base_icms, old.pis_cofins_sem_base,
          old.icms_mod_bc, old.valores_informados, old.ipi_enquadramento) then
    new.confirmada_em := null; new.confirmada_por := null; new.confirmada_por_nome := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2a) Máscaras que já existem: o que as notas do GRV mostram (setembro e outubro de 2026, as mais recentes).
-- ---------------------------------------------------------------------------
with o as (select organization_id from public.fiscal_config where cnpj = '46839106000184')
update public.fiscal_mascaras m set
  cbenef = v.cbenef,
  pis_cst = coalesce(v.pis_cst, m.pis_cst), pis_aliquota = case when v.pis_cst is not null then v.pis_aliquota else m.pis_aliquota end,
  cofins_cst = coalesce(v.cofins_cst, m.cofins_cst), cofins_aliquota = case when v.cofins_cst is not null then v.cofins_aliquota else m.cofins_aliquota end,
  pis_cofins_sem_base = v.sem_base,
  ibs_cbs_cst = coalesce(m.ibs_cbs_cst, v.ibs_cst), cclasstrib = coalesce(m.cclasstrib, v.cclass),
  -- Conserto (41/53 nas 47 notas do GRV): garante o CST que a nota exige, se a máscara ainda estiver sem.
  icms_cst = case when v.codigo in ('5915', '5916', '6916') then coalesce(m.icms_cst, '41') else m.icms_cst end,
  ipi_cst = case when v.codigo in ('5915', '5916', '6916') then coalesce(m.ipi_cst, '53') else m.ipi_cst end,
  ipi_enquadramento = case when v.codigo in ('5915', '5916', '6916') then coalesce(m.ipi_enquadramento, '999') else m.ipi_enquadramento end,
  origem_dados = 'nota',
  observacao_interna = case when coalesce(m.observacao_interna, '') like '%Virada 18/11%' then m.observacao_interna
                            else left(concat_ws(' | ', nullif(m.observacao_interna, ''), v.nota), 1000) end
from o, (values
  ('2',    'SP020120', null, null::numeric, null, null::numeric, false, null, null, 'Virada 18/11: cBenef SP020120 em todas as vendas do GRV desde mai/2026 (73 notas 5101).'),
  ('4',    'SP020120', null, null, null, null, false, null, null, 'Virada 18/11: cBenef SP020120 nas vendas 6101 N/NE/CO/ES do GRV desde mai/2026 (31 notas).'),
  ('18',   'SP020120', null, null, null, null, false, null, null, 'Virada 18/11: cBenef SP020120 nas vendas 6101 S/SE do GRV desde mai/2026 (90 notas).'),
  ('10',   'SP054020', null, null, null, null, false, null, null, 'Virada 18/11: cBenef SP054020 (suspensão, art. 402) nas remessas 5901 do GRV desde mai/2026 (81 notas).'),
  ('24',   'SP070050', null, null, null, null, false, null, null, 'Virada 18/11: cBenef SP070050 (não incidência na exportação) nas notas 7101 do GRV desde mai/2026 (21 notas).'),
  ('5915', 'SP070090', '49', 0, '49', 0, true, '410', '410999', 'Virada 18/11: como o GRV emite (17 notas, out/2026): cBenef SP070090, PIS/COFINS 49 sem base, IBS/CBS 410/410999 (a homologação exige o grupo).'),
  ('5916', 'SP070100', '49', 0, '49', 0, true, '410', '410999', 'Virada 18/11: como o GRV emite (10 notas, out/2026): cBenef SP070100, PIS/COFINS 49 sem base, IBS/CBS 410/410999.'),
  ('6916', 'SP070100', '49', 0, '49', 0, true, '410', '410999', 'Virada 18/11: como o GRV emite (20 notas, out/2026): cBenef SP070100, PIS/COFINS 49 sem base, IBS/CBS 410/410999.')
) as v(codigo, cbenef, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, sem_base, ibs_cst, cclass, nota)
where m.organization_id = o.organization_id and m.codigo = v.codigo;

-- 1101: entrada própria (sucata do art. 392), como o GRV emite desde mai/2026 (31 notas).
with o as (select organization_id from public.fiscal_config where cnpj = '46839106000184')
update public.fiscal_mascaras m set
  natureza = coalesce(m.natureza, 'COMPRA PARA INDUSTRIALIZACAO OU PRODUCAO RURAL'),
  icms_cst = '00', icms_aliquota = 18, icms_por_dentro = true, ipi_enquadramento = '999', ipi_cst = '03',
  pis_cst = '07', pis_aliquota = null, cofins_cst = '07', cofins_aliquota = null, ibs_cbs_cst = '410', cclasstrib = '410999',
  obs_nota = coalesce(m.obs_nota, 'EMITIDA NOS TERMOS DO ARTIGO 392 DO RICMS/SP.'), origem_dados = 'nota',
  observacao_interna = case when coalesce(m.observacao_interna, '') like '%Virada 18/11%' then m.observacao_interna else left(concat_ws(' | ', nullif(m.observacao_interna, ''), 'Virada 18/11: sucata (art. 392): ICMS 18% por dentro (base = valor ÷ 0,82), IPI 03, PIS/COFINS 07, IBS/CBS 410/410999 — 31 notas do GRV. Até mai/2026 o GRV usava PIS/COFINS 98 sem base.'), 1000) end
from o where m.organization_id = o.organization_id and m.codigo = '1';

-- ---------------------------------------------------------------------------
-- 2b) Operações que o GRV emitiu em 2026 e a plataforma não tinha. Códigos novos = o CFOP (com N para a outra
--     região do 6101). Alíquota do IPI vazia = a do NCM do produto. Devolução: CST e alíquotas são os da nota
--     devolvida (botão "Trazer os itens da nota devolvida"); a máscara traz o que o GRV usou por último.
-- ---------------------------------------------------------------------------
with o as (select organization_id from public.fiscal_config where cnpj = '46839106000184')
insert into public.fiscal_mascaras (
  organization_id, codigo, descricao, cfop, natureza,
  icms_cst, icms_aliquota, icms_reducao_base, cbenef, icms_por_dentro, ipi_na_base_icms, valores_informados,
  ipi_enquadramento, ipi_cst, ipi_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, pis_cofins_exclui_icms, pis_cofins_sem_base,
  ibs_cbs_cst, cclasstrib, ibs_aliquota, cbs_aliquota, obs_nota, observacao_interna, origem_dados)
select o.organization_id, v.* , 'nota' from o cross join (values
  ('1201', '1201 DEVOLUCAO DE VENDA (DENTRO DO ESTADO)', '1201', 'DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO',
   '20', 18::numeric, 51.11::numeric, 'SP020120', false, false, false, '999', '01', null::numeric, '98', 0.65::numeric, '98', 3::numeric, true, false,
   '000', '000001', 0.1::numeric, 0.9::numeric, 'ICMS - BASE DE CALCULO REDUZIDA CONFORME ARTIGO 12, ANEXO II DO RICMS/SP., E CONVENIO 52/91 ICMS, ITEM 63.6 IPI - ALICOTA REDUZIDA A 0% CONFORME DECRETO 8.950 DE 29/12/2016.',
   'Virada 18/11: como o GRV emitiu (2 notas, set/2026). Devolução: alíquotas da venda devolvida.'),
  ('2201', '2201 DEVOLUCAO DE VENDA · SUL E SUDESTE', '2201', 'DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO',
   '20', 12, 26.67, 'SP020120', false, false, false, '999', '01', null, '98', 0.65, '98', 3, true, false,
   '000', '000001', 0.1, 0.9, 'ICMS - BASE DE CALCULO REDUZIDA CONFORME ARTIGO 12, ANEXO II DO RICMS/SP., E CONVENIO 52/91 ICMS, ITEM 63,6 IPI-REDUZIDO A 0% CONFORME DECRETO 8.950 DE 29/12/2016.',
   'Virada 18/11: como o GRV emitiu (4 notas, até jun/2026). Devolução: alíquotas da venda devolvida.'),
  ('2201N', '2201 DEVOLUCAO DE VENDA · NORTE, NORDESTE, CENTRO-OESTE E ES', '2201', 'DEVOLUCAO DE VENDA DE PRODUCAO DO ESTABELECIMENTO',
   '20', 7, 26.57, 'SP020120', false, false, false, '999', '01', null, '98', 0.65, '98', 3, true, false,
   '000', '000001', 0.1, 0.9, 'ICMS - BASE DE CALCULO REDUZIDA CONFORME ARTIGO 12, ANEXO II DO RICMS/SP., E CONVENIO 52/91 ICMS, ITEM 63,6 IPI-REDUZIDO A 0% CONFORME DECRETO 8.950 DE 29/12/2016.',
   'Virada 18/11: como o GRV emitiu (1 nota, mai/2026). Devolução: alíquotas da venda devolvida.'),
  ('5201', '5201 DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO', '5201', 'DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO OU PRODUCAO RURAL',
   '20', 18, 51.11, 'SP020120', false, false, false, '999', '53', null, '49', 1.65, '49', 7.6, false, false,
   '000', '000001', 0.1, 0.9, null,
   'Virada 18/11: como o GRV emitiu (2 notas, out/2026). Devolução de compra: CST e alíquotas são os da nota do fornecedor (trazer os itens da nota devolvida).'),
  ('6201', '6201 DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO (FORA)', '6201', 'DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO OU PRODUCAO RURAL',
   '00', 12, null, null, false, false, false, '999', '51', null, '99', 0.65, '99', 3, true, false,
   '000', '000001', 0.1, 0.9, null,
   'Virada 18/11: como o GRV emitiu (1 nota, abr/2026). Devolução de compra: CST e alíquotas são os da nota do fornecedor.'),
  ('5556', '5556 DEVOLUCAO DE COMPRA DE MATERIAL DE USO OU CONSUMO', '5556', 'DEVOLUCAO DE COMPRA DE MATERIAL DE USO OU CONSUMO',
   '00', 18, null, null, false, true, false, '999', '99', null, '49', 1.65, '49', 7.6, true, false,
   '000', '000001', 0.1, 0.9, null,
   'Virada 18/11: como o GRV emitiu (out/2026): IPI devolvido na base do ICMS (grupo impostoDevol). Alíquotas da nota do fornecedor.'),
  ('5551', '5551 VENDA DE BEM DO ATIVO IMOBILIZADO', '5551', 'VENDA DE BEM DO ATIVO IMOBILIZADO',
   '41', null, null, 'SP070140', false, false, false, '999', '53', null, '08', null, '08', null, false, false,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (jun/2026). O GRV usou IBS/CBS 410999 e 000001 em vendas de ativo: confirmar.'),
  ('6551', '6551 VENDA DE BEM DO ATIVO IMOBILIZADO (FORA)', '6551', 'VENDA DE BEM DO ATIVO IMOBILIZADO',
   '41', null, null, 'SP070140', false, false, false, '999', '53', null, '08', null, '08', null, false, false,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (jul/2026). O GRV usou IBS/CBS 410999 e 000001: confirmar.'),
  ('5555', '5555 DEVOLUCAO DE BEM DO ATIVO DE TERCEIRO', '5555', 'DEVOLUCAO DE BEM DO ATIVO IMOBILIZADO DE TERCEIRO, RECEBIDO',
   '41', null, null, null, false, false, false, '999', '53', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (mar/2026), sem cBenef: confirmar se o código é exigido.'),
  ('5903', '5903 RETORNO DE MERCADORIA RECEBIDA PARA INDUSTRIALIZACAO E NAO APLICADA', '5903', 'RETORNO DE MERCADORIA RECEBIDA PARA INDUSTRIALIZACAO E NAO A',
   '50', null, null, null, false, false, false, '108', '55', null, '08', null, '08', null, false, false,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (mar/2026), sem cBenef (a 5901 usa SP054020): confirmar.'),
  ('5909', '5909 RETORNO DE BEM RECEBIDO EM COMODATO', '5909', 'RETORNO DE BEM RECEBIDO POR CONTA DE CONTRATO DE COMODATO',
   '41', null, null, null, false, false, false, '999', '53', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (fev/2026), sem cBenef: confirmar.'),
  ('5913', '5913 RETORNO DE MERCADORIA RECEBIDA PARA DEMONSTRACAO', '5913', 'RETORNO DE MERCADORIA OU BEM RECEBIDO PARA DEMONSTRACAO',
   '00', 12, null, null, false, true, false, '999', '99', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (jul/2026): ICMS 12% com o IPI na base; IPI pela nota recebida (3,25% nas do GRV). Uma nota de abr/2026 saiu com ICMS 50 e SP053190: confirmar.'),
  ('5920', '5920 REMESSA DE VASILHAME OU SACARIA', '5920', 'REMESSA DE VASILHAME OU SACARIA',
   '40', null, null, 'SP010820', false, false, false, '999', '53', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (abr/2026). Outra nota do mesmo dia saiu com ICMS 41 sem cBenef: confirmar.'),
  ('6920', '6920 REMESSA DE VASILHAME OU SACARIA (FORA)', '6920', 'REMESSA DE VASILHAME OU SACARIA',
   '40', null, null, 'SP010820', false, false, false, '999', '53', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: proposta igual à 5920 (o GRV emitiu 6920 com ICMS 41 sem cBenef em abr/2026): confirmar.'),
  ('5949', '5949 OUTRA SAIDA NAO ESPECIFICADA', '5949', 'OUTRA SAIDA DE MERCADORIA OU PRESTACAO DE SERVICO NAO ESPECI',
   null, null, null, null, false, false, false, '999', null, null, '49', 0, '49', 0, false, true,
   null, null, null, null, null, 'Virada 18/11: o GRV usou cinco tratamentos diferentes na 5949 (ICMS 00 a 12% e 18%, 41; IPI 50/51/53/55). Definir caso a caso: a máscara fica incompleta de propósito.'),
  ('6949', '6949 OUTRA SAIDA NAO ESPECIFICADA (FORA)', '6949', 'OUTRA SAIDA DE MERCADORIA OU PRESTACAO DE SERVICO NAO ESPECI',
   '00', 12, null, null, false, false, false, '999', '51', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (retorno de mercadoria recebida para teste, mar/2026). O GRV usou também 000001: confirmar.'),
  ('6918', '6918 DEVOLUCAO DE MERCADORIA RECEBIDA EM CONSIGNACAO', '6918', 'DEVOLUCAO DE MERCADORIA RECEBIDA EM CONSIGNACAO MERCANTIL OU',
   '00', 12, null, null, false, false, false, '999', '50', null, '49', 0.65, '49', 3, true, false,
   '000', '000001', 0.1, 0.9, null, 'Virada 18/11: como o GRV emitiu (set/2026). IPI pela nota recebida (9,75% na do GRV).'),
  ('6919', '6919 DEVOLUCAO SIMBOLICA (CONSIGNACAO)', '6919', 'DEVOLUCAO SIMBOLICA DE MERCADORIA VENDIDA OU UTILIZADA EM PR',
   '90', null, null, 'SP099999', false, false, false, '999', '99', null, '49', 0, '49', 0, false, true,
   '410', '410999', null, null, null, 'Virada 18/11: como o GRV emitiu (set/2026): ICMS 90 sem destaque.'),
  ('2949', '2949 OUTRA ENTRADA NAO ESPECIFICADA (FORA)', '2949', 'OUTRA ENTRADA DE MERCADORIA OU PRESTACAO DE SERVICO NAO ESPE',
   '00', 12, null, null, false, false, false, '999', '49', null, '98', 0.65, '98', 3, true, false,
   '000', '000001', 0.1, 0.9, null, 'Virada 18/11: como o GRV emitiu (set/2026, entrada de nota própria recusada). IPI pela nota (9,75% na do GRV).'),
  ('1604', '1604 CREDITO DO ICMS DO ATIVO (CIAP)', '1604', 'LANCAMENTO DO CREDITO RELATIVO A COMPRA DE BEM PARA O ATIVO',
   '90', null, null, null, false, false, true, '999', '49', null, '08', null, '08', null, false, false,
   '410', '410999', null, null, 'NFE. EMITIDA CONFORME PORTARIA CAT.41 DE 06/05/2003., E ALTERACAO DA PORTARIA CAT.43 DE 08/05/2003.',
   'Virada 18/11: como o GRV emite todo mês (9 notas): nota de ajuste de valor zero, ICMS do crédito digitado na nota.'),
  ('3101', '3101 IMPORTACAO PARA INDUSTRIALIZACAO', '3101', 'COMPRA PARA INDUSTRIALIZACAO OU PRODUCAO RURAL',
   '00', 18, null, 'SP020120', false, false, true, '999', '03', null, '98', 2.1, '98', 10.25, false, false,
   '000', '000001', 0.1, 0.9, null, 'Virada 18/11: como o GRV emite (16 notas): valores da DI digitados (ICMS, II, PIS/COFINS-Importação, IBS/CBS). cBenef SP020120 como o GRV pôs em 4 das 5 de set–out/2026 (com CST 00: confirmar se é exigido). COFINS 9,65% em algumas (pelo NCM) e IPI 49 numa: ajustar na nota pela DI.'),
  ('3551', '3551 IMPORTACAO DE BEM PARA O ATIVO IMOBILIZADO', '3551', 'COMPRA DE BEM PARA O ATIVO IMOBILIZADO',
   '00', 12, null, null, false, false, true, '999', '49', null, '98', 2.1, '98', 10.25, false, false,
   '000', '000001', 0.1, 0.9, null, 'Virada 18/11: como o GRV emitiu (out/2026): valores da DI digitados.'),
  ('7501', '7501 EXPORTACAO DE MERCADORIA RECEBIDA COM FIM DE EXPORTACAO', '7501', 'EXPORTACAO DE MERCADORIAS RECEBIDAS COM FIM ESPECIFICO DE EX',
   '41', null, null, null, false, false, false, '999', '53', null, '08', null, '08', null, false, false,
   '410', '410004', null, null, 'ICMS - NAO INCIDENCIA SOBRE SAIDA DE MERCADORIA COM DESTINO AO EXTERIOR E PRESTACAO DE SERVICOS QUE DESTINE SERVICO AO EXTERIOR RICMS-SP/2000. ART,7 V.',
   'Virada 18/11: como o GRV emitiu (jan/2026, sem cBenef). A 7101 usa SP070050 desde mai/2026: confirmar o código da 7501.')
) as v(codigo, descricao, cfop, natureza, icms_cst, icms_aliquota, icms_reducao_base, cbenef, icms_por_dentro, ipi_na_base_icms, valores_informados,
       ipi_enquadramento, ipi_cst, ipi_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, pis_cofins_exclui_icms, pis_cofins_sem_base,
       ibs_cbs_cst, cclasstrib, ibs_aliquota, cbs_aliquota, obs_nota, observacao_interna)
on conflict (organization_id, codigo) do nothing;

-- As devoluções de venda seguem os estados das máscaras de venda (6101 S/SE = 18; N/NE/CO/ES = 4).
with o as (select organization_id from public.fiscal_config where cnpj = '46839106000184')
update public.fiscal_mascaras m set ufs = (select x.ufs from public.fiscal_mascaras x where x.organization_id = o.organization_id and x.codigo = case m.codigo when '2201' then '18' else '4' end)
from o where m.organization_id = o.organization_id and m.codigo in ('2201', '2201N');
