/**
 * Custo da SARA em reais (E4, 22/10/2026). Só o proprietário vê (decisão dele: nada de contador para
 * quem usa). O custo sai do modelo e dos tokens de cada resposta, separando o que veio do cache.
 *
 * Preços da Anthropic em US$ por milhão de tokens: os do catálogo de modelos (lib/sara/modelos.ts, conferidos na
 * documentação em 14/11/2026). Cada modelo tem a sua leitura do cache (Sonnet 5.5 cobra US$ 0,10, Opus e Fable
 * US$ 0,20); a gravação no cache (5 minutos) = 1,25× a entrada. A cotação do dólar vem de SARA_COTACAO_USD
 * (o proprietário ajusta); sem ela, o valor padrão abaixo, sempre mostrado na tela.
 */

import { CATALOGO, doCatalogo } from "./modelos.ts";

type Preco = { entrada: number; saida: number; leituraCache: number };
/** Os preços por modelo (do catálogo). */
export const PRECOS: Record<string, Preco> = Object.fromEntries(CATALOGO.map((m) => [m.id, m.preco]));
/** Modelo desconhecido custa como o mais caro do catálogo, para não esconder custo. */
const MAIS_CARO: Preco = CATALOGO.reduce((a, m) => (m.preco.entrada > a.entrada ? m.preco : a), CATALOGO[0].preco);
const GRAVACAO_CACHE = 1.25;
export const COTACAO_PADRAO = 5.5;

export type Uso = { modelo: string; tokens_entrada: number; tokens_saida: number; cache_lido: number; cache_gravado: number };

/**
 * Custo em US$. `tokens_entrada` já inclui o que foi lido e gravado no cache (é o volume total):
 * a parte comum é o resto.
 */
export function custoUsd(u: Uso): number {
  const p = doCatalogo(u.modelo)?.preco ?? MAIS_CARO;
  const lido = Math.max(0, Number(u.cache_lido) || 0);
  const gravado = Math.max(0, Number(u.cache_gravado) || 0);
  const comum = Math.max(0, (Number(u.tokens_entrada) || 0) - lido - gravado);
  const total = comum * p.entrada + lido * p.leituraCache + gravado * p.entrada * GRAVACAO_CACHE + (Number(u.tokens_saida) || 0) * p.saida;
  return total / 1_000_000;
}

export function cotacao(valor: string | undefined): number {
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 1 && n < 50 ? n : COTACAO_PADRAO;
}

export const emReais = (usd: number, cot: number) => Math.round(usd * cot * 100) / 100;
