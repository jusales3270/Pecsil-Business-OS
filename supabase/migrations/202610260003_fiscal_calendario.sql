-- ============================================================================
-- Calendário fiscal da empresa (Contábil-Fiscal, N-06) (26/10/2026)
-- ============================================================================
-- As obrigações e a regra de vencimento de cada uma entram como parâmetro legal (camada legal e da UF), em
-- rascunho até o contador conferir, como os demais (semente em docs/contabil/calendario-obrigacoes.json). A função
-- fiscal_calendario_dados entrega ao calendário, a quem é do Fiscal ou paga as guias no Financeiro, as obrigações
-- que valem para a empresa (as da UF dela), os feriados e o regime do perfil. O cálculo das datas é da plataforma
-- (lib/contabil/calendario.ts): nenhum prazo fica no código.
-- ============================================================================

insert into public.contabil_parametros (chave, titulo, escopo, uf, valor, vigente_de, fonte, confianca, situacao, origem)
select v.chave, v.titulo, v.escopo, v.uf, v.valor, v.vigente_de, v.fonte, v.confianca, 'rascunho', 'carga_inicial'
from (values
  ('calendario_obrigacoes', $t$Calendário fiscal: obrigações federais e regras de vencimento$t$, 'legal', null, $j${"obrigacoes": [{"codigo": "dctfweb", "nome": "DCTFWeb (declaração dos débitos previdenciários e retenções)", "tipo": "declaracao", "periodicidade": "mensal", "meses_depois": 1, "dia": "ultimo_util", "ajuste": "mantem", "quem": "escritorio", "parametro": "prazo_dctfweb"}, {"codigo": "darf_previdenciario", "nome": "DARF da DCTFWeb (INSS patronal e retido)", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": 20, "ajuste": "antecipa", "quem": "empresa", "parametro": "vencimentos_federais"}, {"codigo": "esocial_s1299", "nome": "eSocial: fechamento da folha (S-1299)", "tipo": "declaracao", "periodicidade": "mensal", "meses_depois": 1, "dia": 15, "ajuste": "antecipa", "quem": "escritorio", "parametro": "prazo_esocial_fechamento", "observacao": "13º salário: até 20/12."}, {"codigo": "efd_reinf", "nome": "EFD-Reinf (retenções e serviços tomados)", "tipo": "declaracao", "periodicidade": "mensal", "meses_depois": 1, "dia": 15, "ajuste": "prorroga", "quem": "escritorio", "parametro": "prazo_efd_reinf"}, {"codigo": "fgts", "nome": "FGTS Digital (guia mensal)", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": 20, "ajuste": "antecipa", "quem": "empresa", "parametro": "fgts"}, {"codigo": "irrf", "nome": "IRRF (folha e serviços, códigos 0561, 1708, 8045)", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": 20, "ajuste": "antecipa", "quem": "empresa", "parametro": "vencimentos_federais", "observacao": "Último dia útil do 2º decêndio do mês seguinte ao fato gerador."}, {"codigo": "csrf", "nome": "CSRF retida (PIS/COFINS/CSLL, código 5952)", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": 20, "ajuste": "antecipa", "quem": "empresa", "parametro": "vencimentos_federais", "observacao": "Conta do mês do pagamento ao prestador."}, {"codigo": "pis_cofins", "nome": "PIS e COFINS", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": 25, "ajuste": "antecipa", "quem": "empresa", "parametro": "vencimentos_federais"}, {"codigo": "ipi", "nome": "IPI", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": 25, "ajuste": "antecipa", "quem": "empresa", "parametro": "vencimentos_federais"}, {"codigo": "efd_contribuicoes", "nome": "EFD-Contribuições", "tipo": "declaracao", "periodicidade": "mensal", "meses_depois": 2, "dia": "util:10", "ajuste": "mantem", "quem": "escritorio", "parametro": "prazo_efd_contribuicoes"}, {"codigo": "irpj_csll_trimestral", "nome": "IRPJ e CSLL trimestrais (quota única ou 1ª quota)", "tipo": "guia", "periodicidade": "trimestral", "meses_depois": 1, "dia": "ultimo_util", "ajuste": "mantem", "regimes": ["presumido", "real"], "quem": "empresa", "parametro": "vencimentos_federais", "observacao": "Lucro Presumido e Lucro Real trimestral. No Real anual, vale a estimativa mensal."}, {"codigo": "irpj_csll_estimativa", "nome": "IRPJ e CSLL por estimativa mensal (Lucro Real anual)", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": "ultimo_util", "ajuste": "mantem", "regimes": ["real"], "quem": "empresa", "parametro": "vencimentos_federais"}, {"codigo": "ecd", "nome": "ECD (SPED Contábil)", "tipo": "declaracao", "periodicidade": "anual", "mes": 6, "dia": "ultimo_util", "ajuste": "mantem", "quem": "escritorio", "parametro": "prazo_ecd"}, {"codigo": "ecf", "nome": "ECF (escrituração contábil fiscal)", "tipo": "declaracao", "periodicidade": "anual", "mes": 7, "dia": "ultimo_util", "ajuste": "mantem", "quem": "escritorio", "parametro": "prazo_ecf"}]}$j$::jsonb, date '2026-01-01', $f${"norma": "IN RFB 2.248/2025; IN RFB 2.043/2021; IN RFB 1.252/2012; Lei 8.036/1990 art. 15; Lei 9.430/1996 arts. 5º e 6º; Lei 11.933/2009; Lei 10.833/2003 art. 35; IN RFB 2.003 e 2.004/2021; MOS do eSocial", "url": "https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria"}$f$::jsonb, 'media'),
  ('calendario_obrigacoes', $t$Calendário fiscal: obrigações de São Paulo$t$, 'uf', 'SP', $j${"obrigacoes": [{"codigo": "efd_icms_ipi_sp", "nome": "EFD ICMS/IPI (SP)", "tipo": "declaracao", "periodicidade": "mensal", "meses_depois": 1, "dia": 20, "ajuste": "a_conferir", "quem": "escritorio", "parametro": "prazo_efd_icms_ipi", "observacao": "Regra do dia não útil em SP a conferir."}, {"codigo": "icms_sp", "nome": "ICMS (SP)", "tipo": "guia", "periodicidade": "mensal", "meses_depois": 1, "dia": "definir", "ajuste": "a_conferir", "quem": "empresa", "parametro": "prazo_efd_icms_ipi", "observacao": "O vencimento do ICMS em SP depende da CPR (classificação pela atividade) e do dígito da inscrição estadual: a definir com quem responde pelo Fiscal."}]}$j$::jsonb, date '2026-01-01', $f${"norma": "Portaria CAT 147/2009 (EFD ICMS/IPI em SP); Portaria SRE 2/2025 (GIA dispensada desde 01/2026); RICMS/SP e a tabela de vencimentos do ICMS por CPR", "url": "https://portal.fazenda.sp.gov.br/servicos/agenda"}$f$::jsonb, 'media')
) as v(chave, titulo, escopo, uf, valor, vigente_de, fonte, confianca)
where not exists (select 1 from public.contabil_parametros p where p.chave = v.chave and p.escopo = v.escopo and p.uf is not distinct from v.uf and p.vigente_de = v.vigente_de);

create or replace function public.fiscal_calendario_pode_ver() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_feature('fiscal.icms', 'ver') or public.has_feature('fiscal.config', 'ver') or public.has_feature('fiscal.parametros', 'ver')
    or public.has_feature('fiscal.nfe', 'ver') or public.has_feature('fiscal.escritorio', 'ver') or public.has_feature('fiscal.portal', 'operar')
    or public.has_feature('fiscal.contabilidade', 'ver') or public.has_feature('financeiro.pagar', 'ver');
$$;
revoke all on function public.fiscal_calendario_pode_ver() from public, anon;
grant execute on function public.fiscal_calendario_pode_ver() to authenticated;

-- Obrigações (legais e da UF da empresa), feriados (nacionais e da UF/município da empresa) e o perfil.
create or replace function public.fiscal_calendario_dados() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  org uuid := public.current_organization_id();
  cfg record;
begin
  if org is null or not public.fiscal_calendario_pode_ver() then raise exception 'Sem permissão para o calendário fiscal.' using errcode = '42501'; end if;
  select uf, codigo_municipio into cfg from public.fiscal_config where organization_id = org;
  return jsonb_build_object(
    'uf', cfg.uf, 'codigo_municipio', cfg.codigo_municipio,
    'perfil', (select jsonb_build_object('modo', modo, 'regime', regime) from public.contabil_perfil_empresa where organization_id = org),
    'obrigacoes', coalesce((select jsonb_agg(jsonb_build_object('escopo', escopo, 'uf', uf, 'valor', valor, 'situacao', situacao, 'vigente_de', vigente_de, 'vigente_ate', vigente_ate, 'fonte', fonte) order by escopo, vigente_de)
      from public.contabil_parametros where chave = 'calendario_obrigacoes' and situacao <> 'descartado'
        and (escopo = 'legal' or (escopo = 'uf' and uf = cfg.uf) or (escopo = 'municipio' and codigo_municipio = cfg.codigo_municipio))), '[]'::jsonb),
    'feriados', coalesce((select jsonb_agg(d) from public.contabil_parametros p, jsonb_array_elements(p.valor -> 'datas') d
      where p.chave = 'feriados_nacionais_lista' and p.situacao <> 'descartado'
        and (p.escopo = 'legal' or (p.escopo = 'uf' and p.uf = cfg.uf) or (p.escopo = 'municipio' and p.codigo_municipio = cfg.codigo_municipio))), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.fiscal_calendario_dados() from public, anon;
grant execute on function public.fiscal_calendario_dados() to authenticated;
