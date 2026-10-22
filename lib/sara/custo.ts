/**
 * Custo da SARA em reais (E4, 22/10/2026). Só o proprietário vê (decisão dele: nada de contador para
 * quem usa). O custo sai do modelo e dos tokens de cada resposta, separando o que veio do cache.
 *
 * Preços da Anthropic em US$ por milhão de tokens, conferidos na tabela oficial em 22/10/2026
 * (Haiku 5.5 vale até 100 mil tokens por pedido, sempre o caso da SARA). Leitura do cache = 0,1× a
 * entrada; gravação no cache (5 minutos) = 1,25× a entrada. A cotação do dólar vem de SARA_COTACAO_USD
 * (o proprietário ajusta); sem ela, o valor padrão abaixo, sempre mostrado na tela.
 */

type Preco = { entrada: number; saida: number };
export const PRECOS: Record<string, Preco> = {
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10 },
};
const LEITURA_CACHE = 0.1;
const GRAVACAO_CACHE = 1.25;
export const COTACAO_PADRAO = 5.5;

export type Uso = { modelo: string; tokens_entrada: number; tokens_saida: number; cache_lido: number; cache_gravado: number };

/**
 * Custo em US$. `tokens_entrada` já inclui o que foi lido e gravado no cache (é o volume total):
 * a parte comum é o resto. Modelo sem preço conhecido custa como o Sonnet (o mais caro), para não esconder custo.
 */
export function custoUsd(u: Uso): number {
  const p = PRECOS[u.modelo] ?? PRECOS["claude-sonnet-5-5"];
  const lido = Math.max(0, Number(u.cache_lido) || 0);
  const gravado = Math.max(0, Number(u.cache_gravado) || 0);
  const comum = Math.max(0, (Number(u.tokens_entrada) || 0) - lido - gravado);
  const total = comum * p.entrada + lido * p.entrada * LEITURA_CACHE + gravado * p.entrada * GRAVACAO_CACHE + (Number(u.tokens_saida) || 0) * p.saida;
  return total / 1_000_000;
}

export function cotacao(valor: string | undefined): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 1 && n < 50 ? n : COTACAO_PADRAO;
}

export const emReais = (usd: number, cot: number) => Math.round(usd * cot * 100) / 100;
