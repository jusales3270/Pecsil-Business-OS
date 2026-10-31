/**
 * O que a pessoa está vendo agora (T2 do E7.T). Fica na memória da página e vai junto de cada pergunta à SARA. É só um
 * apontador: o servidor confere tudo contra o catálogo e descarta o que não conhece (lib/sara/tela.ts).
 */

export type TelaAtual = { modulo: string; secao: string | null };

let atual: TelaAtual | null = null;

export function definirTelaAtual(t: TelaAtual | null) { atual = t; }
export const lerTelaAtual = () => atual;
