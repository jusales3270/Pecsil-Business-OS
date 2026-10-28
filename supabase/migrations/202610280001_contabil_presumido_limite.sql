-- ============================================================================
-- Lucro Presumido: versão até 2025 e o limite da LC 224 em número (Contábil-Fiscal, N-07) (28/10/2026)
-- ============================================================================
-- A apuração (lib/contabil/apuracao/presumido.ts) lê os percentuais vigentes na data do fato gerador. Faltava a versão
-- de antes da LC 224 (até 31/12/2025, para conferir 2025 com a ECD do escritório) e o limite da LC 224 em número: o
-- art. 15 da IN RFB 2.305/2025, na redação da IN 2.306/2026, distribui o limite anual de R$ 5 mi em R$ 1,25 mi por
-- trimestre, a sobra soma aos trimestres seguintes do ano e o último trimestre faz o ajuste pelo acumulado. Tudo fica em
-- rascunho até o contador conferir, como a carga da N-01.
-- ============================================================================

insert into public.contabil_parametros (chave, titulo, escopo, uf, valor, vigente_de, vigente_ate, fonte, confianca, situacao, origem, observacao)
select 'lucro_presumido_percentuais', 'Lucro Presumido: percentuais (antes da LC 224/2025)', 'legal', null,
  $j${"industria_comercio": {"irpj": 0.08, "csll": 0.12}, "servicos": {"irpj": 0.32, "csll": 0.32}, "irpj_aliquota": 0.15, "irpj_adicional": {"aliquota": 0.1, "excedente_trimestral": 60000}, "csll_aliquota": 0.09}$j$::jsonb,
  date '1996-01-01', date '2025-12-31',
  $f${"norma": "Lei 9.249/1995 arts. 3º, 15 e 20", "url": "https://www.planalto.gov.br/ccivil_03/leis/l9249.htm"}$f$::jsonb,
  'alta', 'rascunho', 'carga_inicial', 'Sem o acréscimo da LC 224/2025, que vale desde 01/01/2026 (IRPJ) e 01/04/2026 (CSLL).'
where not exists (select 1 from public.contabil_parametros where chave = 'lucro_presumido_percentuais' and escopo = 'legal' and vigente_de = date '1996-01-01');

update public.contabil_parametros
set valor = jsonb_set(valor, '{lc_224_2025}', (valor -> 'lc_224_2025') || $j${"limite_anual": 5000000, "limite_trimestral": 1250000, "sobra_acumula_no_ano": true, "ajuste_no_ultimo_trimestre": true}$j$::jsonb),
    fonte = jsonb_set(fonte, '{norma}', to_jsonb((fonte ->> 'norma') || '; IN RFB 2.305/2025 art. 15 §§ 1º a 9º, na redação da IN RFB 2.306/2026 (limite trimestral, sobra e ajuste no último trimestre)'))
where chave = 'lucro_presumido_percentuais' and escopo = 'legal' and vigente_de = date '2026-01-01' and not ((valor -> 'lc_224_2025') ? 'limite_trimestral');
