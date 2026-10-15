-- ============================================================================
-- Máscaras de impostos (15/10/2026, pedido do proprietário)
-- ============================================================================
-- A "máscara" do GRV: um código interno que diz a operação (CFOP) e como cada imposto sai.
-- O Rafael escolhe a máscara no orçamento (o sistema sugere pelo estado do cliente), o orçamento
-- mostra ICMS e IPI e a nota do Jefferson nasce com a mesma máscara.
--
-- As 23 máscaras entram como estão no arquivo do GRV (Mascara_de_impostos.xlsx): código, CFOP,
-- descrição, situação tributária, enquadramento do IPI, conta do plano. O GRV não guarda alíquotas
-- na máscara; elas virão das notas emitidas (XML) e do contador. Até lá a máscara fica
-- "incompleta" e o orçamento avisa em vez de calcular.
--
-- Alíquota do IPI por NCM (fiscal_ncm): o IPI segue a TIPI pelo NCM do produto. A máscara só
-- tem alíquota própria de IPI quando a operação manda (ex.: suspensão).
-- ============================================================================

create table if not exists public.fiscal_mascaras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null check (codigo ~ '^[0-9A-Za-z]{1,10}$'),
  descricao text not null check (char_length(descricao) between 2 and 200),
  cfop text not null check (cfop ~ '^[1-7][0-9]{3}$'),
  natureza text check (natureza is null or char_length(natureza) <= 60),
  situacao_tributaria text check (situacao_tributaria is null or char_length(situacao_tributaria) <= 60),
  -- Estados de destino em que a máscara vale (vazio: qualquer um). Ex.: 6101 para PE.
  ufs text[] not null default '{}',
  -- ICMS
  icms_cst text check (icms_cst is null or icms_cst ~ '^[0-9]{2,3}$'),
  icms_aliquota numeric(7,4) check (icms_aliquota is null or icms_aliquota between 0 and 100),
  icms_reducao_base numeric(7,4) check (icms_reducao_base is null or icms_reducao_base between 0 and 100),
  icms_diferimento numeric(7,4) check (icms_diferimento is null or icms_diferimento between 0 and 100),
  -- IPI (alíquota vazia: vem do NCM do produto)
  ipi_enquadramento text check (ipi_enquadramento is null or ipi_enquadramento ~ '^[0-9]{3}$'),
  ipi_cst text check (ipi_cst is null or ipi_cst ~ '^[0-9]{2}$'),
  ipi_aliquota numeric(7,4) check (ipi_aliquota is null or ipi_aliquota between 0 and 100),
  -- PIS e COFINS
  pis_cst text check (pis_cst is null or pis_cst ~ '^[0-9]{2}$'),
  pis_aliquota numeric(7,4) check (pis_aliquota is null or pis_aliquota between 0 and 100),
  cofins_cst text check (cofins_cst is null or cofins_cst ~ '^[0-9]{2}$'),
  cofins_aliquota numeric(7,4) check (cofins_aliquota is null or cofins_aliquota between 0 and 100),
  pis_cofins_exclui_icms boolean not null default false,
  -- IBS e CBS (reforma)
  ibs_cbs_cst text check (ibs_cbs_cst is null or char_length(ibs_cbs_cst) <= 3),
  cclasstrib text check (cclasstrib is null or char_length(cclasstrib) <= 6),
  ibs_aliquota numeric(7,4) check (ibs_aliquota is null or ibs_aliquota between 0 and 100),
  cbs_aliquota numeric(7,4) check (cbs_aliquota is null or cbs_aliquota between 0 and 100),
  -- Outros
  conta_plano text check (conta_plano is null or char_length(conta_plano) <= 30),
  conta_plano_descricao text check (conta_plano_descricao is null or char_length(conta_plano_descricao) <= 120),
  obs_nota text check (obs_nota is null or char_length(obs_nota) <= 500),
  observacao_interna text check (observacao_interna is null or char_length(observacao_interna) <= 1000),
  ativo boolean not null default true,
  -- De onde vieram os números e quem confirmou com o contador
  origem_dados text not null default 'grv' check (origem_dados in ('grv', 'nota', 'contador', 'manual')),
  confirmada_por uuid references public.profiles(id) on delete set null,
  confirmada_por_nome text,
  confirmada_em timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists fiscal_mascaras_codigo on public.fiscal_mascaras (organization_id, codigo);

create table if not exists public.fiscal_ncm (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ncm text not null check (ncm ~ '^[0-9]{8}$'),
  descricao text check (descricao is null or char_length(descricao) <= 200),
  ipi_aliquota numeric(7,4) check (ipi_aliquota is null or ipi_aliquota between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, ncm)
);

-- Orçamento: a máscara escolhida (a nota nasce com ela).
alter table public.sales_quotes add column if not exists mascara_id uuid references public.fiscal_mascaras(id) on delete set null;

-- Quem vê: o Fiscal (configuração e notas) e quem orça. Quem altera: Configuração fiscal (operar)
-- ou quem aprova notas (fiscal.nfe aprovar). O proprietário passa em tudo.
create or replace function public.fiscal_mascaras_pode_ver()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.config', 'ver') or public.has_feature('fiscal.nfe', 'ver') or public.has_feature('comercial.orcamentos', 'ver');
$$;
create or replace function public.fiscal_mascaras_pode_editar()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.config', 'operar') or public.has_feature('fiscal.nfe', 'aprovar');
$$;
revoke all on function public.fiscal_mascaras_pode_ver() from public, anon;
revoke all on function public.fiscal_mascaras_pode_editar() from public, anon;
grant execute on function public.fiscal_mascaras_pode_ver() to authenticated;
grant execute on function public.fiscal_mascaras_pode_editar() to authenticated;

alter table public.fiscal_mascaras enable row level security;
alter table public.fiscal_ncm enable row level security;
drop policy if exists fiscal_mascaras_read on public.fiscal_mascaras;
create policy fiscal_mascaras_read on public.fiscal_mascaras for select to authenticated
using (organization_id = (select public.current_organization_id()) and (select public.fiscal_mascaras_pode_ver()));
drop policy if exists fiscal_mascaras_write on public.fiscal_mascaras;
create policy fiscal_mascaras_write on public.fiscal_mascaras for all to authenticated
using (organization_id = (select public.current_organization_id()) and (select public.fiscal_mascaras_pode_editar()))
with check (organization_id = (select public.current_organization_id()) and (select public.fiscal_mascaras_pode_editar()));
drop policy if exists fiscal_ncm_read on public.fiscal_ncm;
create policy fiscal_ncm_read on public.fiscal_ncm for select to authenticated
using (organization_id = (select public.current_organization_id()) and (select public.fiscal_mascaras_pode_ver()));
drop policy if exists fiscal_ncm_write on public.fiscal_ncm;
create policy fiscal_ncm_write on public.fiscal_ncm for all to authenticated
using (organization_id = (select public.current_organization_id()) and (select public.fiscal_mascaras_pode_editar()))
with check (organization_id = (select public.current_organization_id()) and (select public.fiscal_mascaras_pode_editar()));
grant select, insert, update, delete on public.fiscal_mascaras, public.fiscal_ncm to authenticated;

-- Quem alterou e quando; alterar um número tira a confirmação do contador (precisa conferir de novo).
create or replace function public.fiscal_mascaras_autoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.current_profile_id(), new.updated_by);
  new.updated_by_name := coalesce((select full_name from public.profiles where id = public.current_profile_id()), new.updated_by_name);
  if tg_op = 'UPDATE' and old.confirmada_em is not null and new.confirmada_em is not distinct from old.confirmada_em
     and (new.cfop, new.ufs, new.icms_cst, new.icms_aliquota, new.icms_reducao_base, new.icms_diferimento, new.ipi_cst, new.ipi_aliquota,
          new.pis_cst, new.pis_aliquota, new.cofins_cst, new.cofins_aliquota, new.pis_cofins_exclui_icms, new.ibs_cbs_cst, new.cclasstrib,
          new.ibs_aliquota, new.cbs_aliquota)
         is distinct from
         (old.cfop, old.ufs, old.icms_cst, old.icms_aliquota, old.icms_reducao_base, old.icms_diferimento, old.ipi_cst, old.ipi_aliquota,
          old.pis_cst, old.pis_aliquota, old.cofins_cst, old.cofins_aliquota, old.pis_cofins_exclui_icms, old.ibs_cbs_cst, old.cclasstrib,
          old.ibs_aliquota, old.cbs_aliquota) then
    new.confirmada_em := null; new.confirmada_por := null; new.confirmada_por_nome := null;
  end if;
  return new;
end;
$$;
drop trigger if exists fiscal_mascaras_autoria on public.fiscal_mascaras;
create trigger fiscal_mascaras_autoria before insert or update on public.fiscal_mascaras for each row execute function public.fiscal_mascaras_autoria();
create or replace function public.fiscal_ncm_autoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.current_profile_id(), new.updated_by);
  new.updated_by_name := coalesce((select full_name from public.profiles where id = public.current_profile_id()), new.updated_by_name);
  return new;
end;
$$;
drop trigger if exists fiscal_ncm_autoria on public.fiscal_ncm;
create trigger fiscal_ncm_autoria before insert or update on public.fiscal_ncm for each row execute function public.fiscal_ncm_autoria();

-- As 23 máscaras do GRV, como estão no arquivo. CST do ICMS sugerido pela situação tributária
-- (tributada 00, redução 20, não tributada 41, suspensão 50, diferimento 51) e do IPI pelo
-- enquadramento (108 suspensão 55): sugestões, o contador confirma.
insert into public.fiscal_mascaras (organization_id, codigo, descricao, cfop, natureza, situacao_tributaria, ufs, icms_cst, ipi_enquadramento, ipi_cst,
  conta_plano, conta_plano_descricao, observacao_interna, origem_dados, updated_by_name)
select o.id, m.codigo, m.descricao, m.cfop, m.natureza, m.situacao, m.ufs, m.icms_cst, m.enq,
       case m.enq when '108' then '55' end,
       m.conta, m.conta_desc, m.obs, 'grv', 'Máscaras do GRV'
  from public.organizations o
  cross join (values
    ('1',    '1101 ENTRADA ENVIADA DE DENTRO DO ESTADO PARA FABRICAÇÃO', '1101', 'COMPRA PARA INDUSTRIALIZACAO', 'TRIBUTADA INTEGRALMENTE', '{}'::text[], '00', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('5',    '1124 ENTRADA PARA INDUSTRIALIZAÇÃO', '1124', 'INDUSTRIALIZACAO EFETUADA POR OUTRA EMPRESA', 'TRIBUTADA INTEGRALMENTE', '{}', '00', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('9',    '1901 ENTRADA DE REMESSA PARA INDUSTRIALIZAÇÃO', '1901', 'ENTRADA PARA INDUSTRIALIZACAO POR ENCOMENDA', 'DIFERIMENTO', '{}', '51', null, '07.001', 'RECEBIMENTO DE MATERIAL CLIENTE', 'No GRV: homologar máscara junto ao contador. Diferimento sem percentual.'),
    ('13',   '1902 RETORNO DE MERCADORIA REMETIDA PARA INDUSTRIALIZAÇÃO POR ENCOMENDA', '1902', 'RETORNO DE INDUSTRIALIZACAO POR ENCOMENDA', 'SUSPENSÃO', '{}', '50', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('3',    '2101 ENTRADA PARA FABRICAÇÃO DE FORA DO ESTADO', '2101', 'COMPRA PARA INDUSTRIALIZACAO', 'TRIBUTADA INTEGRALMENTE', '{}', '00', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('7',    '2124 ENTRADA PARA INDUSTRIALIZAÇÃO', '2124', 'INDUSTRIALIZACAO EFETUADA POR OUTRA EMPRESA', 'TRIBUTADA INTEGRALMENTE', '{}', '00', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('11',   '2901 ENTRADA DE REMESSA PARA INDUSTRIALIZAÇÃO', '2901', 'ENTRADA PARA INDUSTRIALIZACAO POR ENCOMENDA', 'DIFERIMENTO', '{}', '51', null, null, null, 'No GRV: homologar máscara junto ao contador. Diferimento sem percentual.'),
    ('14',   '2902 RETORNO DE MERCADORIA REMETIDA PARA INDUSTRIALIZAÇÃO POR ENCOMENDA', '2902', 'RETORNO DE INDUSTRIALIZACAO POR ENCOMENDA', 'SUSPENSÃO', '{}', '50', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('2',    '5101 VENDA DENTRO DO ESTADO', '5101', 'VENDA DE PRODUCAO DO ESTABELECIMENTO', 'COM REDUÇÃO DE BASE DE CÁLCULO', '{}', '20', '999', null, null, 'No GRV: homologar máscara junto ao contador. Redução de base sem percentual.'),
    ('6',    '5124 INDUSTRIALIZAÇÃO', '5124', 'INDUSTRIALIZACAO EFETUADA PARA OUTRA EMPRESA', 'TRIBUTADA INTEGRALMENTE', '{}', '00', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('10',   '5901 ENVIO DE REMESSA PARA INDUSTRIALIZAÇÃO', '5901', 'REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA', 'SUSPENSÃO', '{}', '50', '108', '08.01', 'REMESSA DE MERCADORIAS PARA TESTES OU BENEFICIAMENTO', null),
    ('15',   '5902 RETORNO DE MERCADORIA UTILIZADA NA INDUSTRIALIZAÇÃO POR ENCOMENDA', '5902', 'RETORNO DE INDUSTRIALIZACAO POR ENCOMENDA', 'SUSPENSÃO', '{}', '50', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('5915', '5915 REMESSA DE MERCADORIA OU BEM PARA CONSERTO OU REPARO', '5915', 'REMESSA PARA CONSERTO OU REPARO', 'NÃO TRIBUTADA', '{}', '41', '999', '08.01', 'REMESSA DE MERCADORIAS PARA TESTES OU BENEFICIAMENTO', null),
    ('5916', '5916 RETORNO DE MERCADORIA OU BEM RECEBIDO PARA CONSERTO OU REPARO', '5916', 'RETORNO DE CONSERTO OU REPARO', 'NÃO TRIBUTADA', '{}', '41', '999', '08.02', 'DEVOLUÇÃO DE MERCADORIAS DE CLIENTES E COMPRAS', null),
    ('4',    '6101 VENDA FORA DO ESTADO PE', '6101', 'VENDA DE PRODUCAO DO ESTABELECIMENTO', 'COM REDUÇÃO DE BASE DE CÁLCULO', '{PE}', '20', '999', null, null, 'Redução de base sem percentual.'),
    ('18',   '6101 VENDA FORA DO ESTADO RJ - RS', '6101', 'VENDA DE PRODUCAO DO ESTABELECIMENTO', 'COM REDUÇÃO DE BASE DE CÁLCULO', '{RJ,RS}', '20', '999', null, null, 'Redução de base sem percentual.'),
    ('19',   '6101 VENDA FORA DO ESTADO SP', '6101', 'VENDA DE PRODUCAO DO ESTABELECIMENTO', 'COM REDUÇÃO DE BASE DE CÁLCULO', '{}', '20', '999', null, null, 'No GRV está "VENDA FORA DO ESTADO SP", mas a empresa é de SP (venda para SP é 5101): confirmar o estado de destino. Redução de base sem percentual.'),
    ('8',    '6124 INDUSTRIALIZAÇÃO', '6124', 'INDUSTRIALIZACAO EFETUADA PARA OUTRA EMPRESA', 'TRIBUTADA INTEGRALMENTE', '{}', '00', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('12',   '6901 ENVIO DE REMESSA PARA INDUSTRIALIZAÇÃO', '6901', 'REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA', 'SUSPENSÃO', '{}', '50', '108', '08.01', 'REMESSA DE MERCADORIAS PARA TESTES OU BENEFICIAMENTO', 'No GRV: homologar máscara junto ao contador.'),
    ('16',   '6902 RETORNO DE MERCADORIA UTILIZADA NA INDUSTRIALIZAÇÃO POR ENCOMENDA', '6902', 'RETORNO DE INDUSTRIALIZACAO POR ENCOMENDA', 'SUSPENSÃO', '{}', '50', null, null, null, 'No GRV: homologar máscara junto ao contador.'),
    ('6915', '6915 REMESSA DE MERCADORIA OU BEM PARA CONSERTO OU REPARO', '6915', 'REMESSA PARA CONSERTO OU REPARO', null, '{}', null, '999', '08.01', 'REMESSA DE MERCADORIAS PARA TESTES OU BENEFICIAMENTO', 'No GRV a situação tributária está em branco (a 5915 é não tributada).'),
    ('6916', '6916 RETORNO DE MERCADORIA OU BEM RECEBIDO PARA CONSERTO OU REPARO', '6916', 'RETORNO DE CONSERTO OU REPARO', 'NÃO TRIBUTADA', '{}', '41', '999', '07.002', 'RETORNO DE MERCADORIAS', null),
    ('24',   '7101 VENDAS EXPORTAÇÃO', '7101', 'VENDA DE PRODUCAO DO ESTABELECIMENTO', 'NÃO TRIBUTADA', '{}', '41', '999', '01.01.001', 'VENDAS DE MOLDES', 'No GRV: NCM "Moldes para vidro".')
  ) as m(codigo, descricao, cfop, natureza, situacao, ufs, icms_cst, enq, conta, conta_desc, obs)
 where exists (select 1 from public.fiscal_config c where c.organization_id = o.id)
on conflict (organization_id, codigo) do nothing;

-- Números tirados das notas emitidas pelo GRV (autorizadas, set–out/2026): NF 11126 (5101 → SP),
-- 11092 (6101 → PE), 11104 (6101 → RJ), 11116 (7101 → Paraguai) e 11164 (5901). Conferidos centavo a
-- centavo com o cálculo da plataforma. Ficam "a confirmar" até o contador conferir.
-- Venda (Convênio ICMS 52/91 e art. 12 do Anexo II do RICMS/SP): carga de 8,80% dentro de SP e para
-- S/SE (exceto ES); 5,14% para N/NE/CO e ES. PIS 0,65% e COFINS 3% (cumulativos) com o ICMS fora da
-- base; IBS 0,10% e CBS 0,90% (2026) sobre a base sem ICMS, PIS e COFINS. IPI 0% pelo NCM 8480.50.00.
update public.fiscal_mascaras set
  icms_cst = '20', ipi_enquadramento = '999', ipi_cst = '51', pis_cst = '01', pis_aliquota = 0.65, cofins_cst = '01', cofins_aliquota = 3,
  pis_cofins_exclui_icms = true, ibs_cbs_cst = '000', cclasstrib = '000001', ibs_aliquota = 0.10, cbs_aliquota = 0.90,
  obs_nota = 'ICMS - BASE DE CALCULO REDUZIDA CONFORME ARTIGO 12, ANEXO II DO RICMS/SP., E CONVENIO 52/91 ICMS, ITEM 63.6. IPI - ALIQUOTA REDUZIDA A 0% CONFORME DECRETO 8.950 DE 29/12/2016.',
  origem_dados = 'nota',
  icms_aliquota = case codigo when '2' then 18 when '4' then 7 else 12 end,
  icms_reducao_base = case codigo when '2' then 51.11 when '4' then 26.57 else 26.67 end,
  observacao_interna = case codigo
    when '2' then 'Números da NF 11126 (SP, 18/09/2026): carga efetiva 8,80%.'
    when '4' then 'Números da NF 11092 (PE, 02/09/2026): carga efetiva 5,14% (N/NE/CO e ES).'
    else 'Números da NF 11104 (RJ, 10/09/2026): carga efetiva 8,80% (S/SE, exceto ES). Sem nota de exemplo para RS: mesma regra.' end
 where codigo in ('2', '4', '18') and origem_dados = 'grv';

update public.fiscal_mascaras set
  icms_cst = '41', ipi_enquadramento = '999', ipi_cst = '53', pis_cst = '08', cofins_cst = '08', pis_cofins_exclui_icms = true,
  ibs_cbs_cst = '410', cclasstrib = '410004',
  obs_nota = 'ICMS - NAO INCIDENCIA SOBRE MERCADORIA COM DESTINO AO EXTERIOR E PRESTACAO DE SERVICOS QUE DESTINE SERVICO AO EXTERIOR RICMS-SP/2000. ART. 7, V.',
  origem_dados = 'nota', observacao_interna = 'Números da NF 11116 (Paraguai, 16/09/2026). Na nota também vão a cotação do dólar, a invoice e o INCOTERM.'
 where codigo = '24' and origem_dados = 'grv';

update public.fiscal_mascaras set
  icms_cst = '50', ipi_enquadramento = '108', ipi_cst = '55', pis_cst = '08', cofins_cst = '08', ibs_cbs_cst = '410', cclasstrib = '410999',
  obs_nota = 'ICMS - SUSPENSAO DO ICMS CONF. ART.402 DECRETO 45.490/00 DO RICMS. IPI - SUSPENSAO DO IPI CONF. ART.40, ANEXO VII DO RIPI.',
  origem_dados = 'nota', observacao_interna = 'Números da NF 11164 (remessa para metalização, 05/10/2026). Sem pagamento (tPag 90).'
 where codigo = '10' and origem_dados = 'grv';

insert into public.fiscal_ncm (organization_id, ncm, descricao, ipi_aliquota, updated_by_name)
select o.id, '84805000', 'Moldes para vidro (TIPI: reduzido a 0% pelo Decreto 8.950/2016, conforme as notas emitidas)', 0, 'Notas emitidas pelo GRV'
  from public.organizations o
 where exists (select 1 from public.fiscal_config c where c.organization_id = o.id)
on conflict (organization_id, ncm) do nothing;

-- Estados de destino pela regra do Convênio 52/91 (decisão do proprietário, 15/10/2026; o contador
-- confirma): 18 = Sul e Sudeste, exceto ES (12% com redução de 26,67%); 4 = Norte, Nordeste,
-- Centro-Oeste e ES (7% com redução de 26,57%).
update public.fiscal_mascaras set
  ufs = '{RJ,RS,MG,PR,SC}', descricao = '6101 VENDA FORA DO ESTADO · SUL E SUDESTE (EXCETO ES)',
  observacao_interna = observacao_interna || ' Estados pela regra do Convênio 52/91 (no GRV: "RJ - RS").'
 where codigo = '18' and origem_dados = 'nota';
update public.fiscal_mascaras set
  ufs = '{AC,AL,AP,AM,BA,CE,DF,ES,GO,MA,MT,MS,PA,PB,PE,PI,RN,RO,RR,SE,TO}', descricao = '6101 VENDA FORA DO ESTADO · NORTE, NORDESTE, CENTRO-OESTE E ES',
  observacao_interna = observacao_interna || ' Estados pela regra do Convênio 52/91 (no GRV: "PE").'
 where codigo = '4' and origem_dados = 'nota';
