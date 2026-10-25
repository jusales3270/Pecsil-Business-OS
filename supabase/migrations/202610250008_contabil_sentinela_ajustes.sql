-- ============================================================================
-- Sentinela (N-02), ajustes da primeira coleta real (25/10/2026)
-- ============================================================================
-- * Receita Federal: o RSS de "Notícias" mistura pastas e parou em julho; o de "Últimas notícias" traz as
--   notícias do dia. Troca a URL.
-- * Senado: a data "12/08/2026" foi lida como 8 de dezembro (formato americano). O leitor foi corrigido; os
--   itens do Senado saem e voltam na próxima coleta, com a data certa.
-- * eSocial: os PDFs publicados (".../arquivo.pdf/view") eram descartados como ruído. Corrigido.
-- * Receita, Senado e eSocial voltam a ser lidos "pela primeira vez": o que já foi publicado entra como
--   histórico, sem proposta do passado.
-- * Selic de 10/2026: a série "acumulada no mês" do mês corrente é parcial. A Sentinela passa a gravar só mês
--   fechado; o valor parcial fica DESCARTADO, com o motivo (nada se apaga). Fechado o mês, o valor certo
--   entra no mesmo lugar.
-- ============================================================================

update public.contabil_fontes
set url = 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/ultimas-noticias/RSS', nome = 'Receita Federal: últimas notícias'
where id = 'rfb_noticias';

delete from public.contabil_itens where fonte_id in ('senado_legislacao', 'rfb_noticias', 'esocial');
update public.contabil_fontes set ultima_coleta_em = null, ultimo_item_em = null, itens = 0
where id in ('senado_legislacao', 'rfb_noticias', 'esocial');

update public.contabil_parametros
set situacao = 'descartado', motivo_descarte = 'Mês ainda aberto: a Selic acumulada no mês era parcial. A Sentinela passou a gravar só mês fechado.', updated_at = now()
where chave = 'selic_mensal' and vigente_de = date '2026-10-01' and origem = 'sentinela' and situacao = 'conferido';
