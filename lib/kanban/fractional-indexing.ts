/**
 * Posição de um card entre dois vizinhos, sem renumerar a coluna inteira.
 *
 * Cada card guarda um número; para colocar um card entre outros dois, usa-se o
 * ponto médio. Mover um card grava UMA linha, não a coluna toda — é o que
 * mantém o quadro rápido e evita que duas pessoas movendo cards ao mesmo tempo
 * embaralhem a ordem.
 *
 * Trazido do SomaFlow (`lib/kanban/fractional-indexing.ts`), com os limites
 * explicitados: casas decimais têm fim, então há um ponto em que a coluna
 * precisa ser renumerada.
 */

/** Distância padrão entre cards quando não há com quem dividir espaço. */
export const PASSO = 1000;

/**
 * Casas decimais a partir das quais a coluna deve ser renumerada. Cada divisão
 * ao meio gasta uma casa; passar disso começa a arriscar empate por
 * arredondamento do ponto flutuante.
 */
export const LIMITE_PRECISAO = 15;

/**
 * Posição entre dois vizinhos. `null` significa "não tem vizinho desse lado".
 * Devolve `NaN` quando os dois são iguais — aí não há espaço entre eles e a
 * coluna precisa ser renumerada.
 */
export function pontoMedio(anterior: number | null, seguinte: number | null): number {
  if (anterior == null && seguinte == null) return PASSO;
  if (anterior == null) return seguinte! - PASSO;
  if (seguinte == null) return anterior + PASSO;
  if (anterior === seguinte) return NaN;
  return (anterior + seguinte) / 2;
}

/** Quantas casas decimais o número tem. */
export function casasDecimais(valor: number): number {
  if (!Number.isFinite(valor)) return Infinity;
  const texto = Math.abs(valor).toString();
  if (texto.includes("e")) return Infinity;
  const ponto = texto.indexOf(".");
  return ponto < 0 ? 0 : texto.length - ponto - 1;
}

/** A coluna precisa ser renumerada antes de aceitar esta posição? */
export function precisaRenumerar(posicao: number): boolean {
  return !Number.isFinite(posicao) || casasDecimais(posicao) > LIMITE_PRECISAO;
}

/**
 * Posições limpas para uma coluna inteira (1000, 2000, 3000…), usadas quando
 * o espaço entre cards acabou.
 */
export function renumerar(quantidade: number): number[] {
  return Array.from({ length: quantidade }, (_, indice) => (indice + 1) * PASSO);
}
