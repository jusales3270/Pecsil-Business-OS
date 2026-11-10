/**
 * Busca de uma compra pelo número, na busca de "Minhas Cotações". O número é o mesmo do começo ao fim
 * (lib/compras/rotulo.ts): "Cotação nº N" até a aprovação, "OC nº N" depois. Ao digitar "32", aparecem as
 * compras cujo número começa com 32 (o número exato primeiro). Quando a compra já tem Ordem de Compra, ela
 * aparece duas vezes, para a pessoa escolher: a cotação (os detalhes) ou a OC (o documento).
 */

/** O número digitado ("329", "OC 329", "cotação nº 329", "#329"), ou null quando a busca não é um número. */
export function numeroDaBusca(texto: string): string | null {
  const m = /^\s*(?:oc|ordem(?:\s+de\s+compra)?|cot(?:a[cç][aã]o)?\.?)?\s*(?:n[º°o.]?\s*)?#?\s*(\d{1,9})\s*$/i.exec(texto);
  return m ? m[1].replace(/^0+(?=\d)/, "") : null;
}

export type Sugestao<C> = { tipo: "cotacao" | "oc"; id: number; compra: C };

/**
 * As sugestões para o número digitado: até `limite` compras (o número exato primeiro, depois os mais
 * próximos, do menor para o maior), cada uma como cotação e, se `temOC`, também como OC.
 */
export function sugestoesPorNumero<C extends { id: number }>(compras: C[], numero: string, temOC: (c: C) => boolean, limite = 6): Sugestao<C>[] {
  const achadas = compras.filter((c) => String(c.id).startsWith(numero))
    .sort((a, b) => String(a.id).length - String(b.id).length || a.id - b.id)
    .slice(0, limite);
  return achadas.flatMap((c) => [{ tipo: "cotacao" as const, id: c.id, compra: c }, ...(temOC(c) ? [{ tipo: "oc" as const, id: c.id, compra: c }] : [])]);
}
