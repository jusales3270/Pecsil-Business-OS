/**
 * O que a pessoa está vendo agora (T2 do E7.T). Fica na memória da página e vai junto de cada pergunta à SARA. É só um
 * apontador: o servidor confere tudo contra o catálogo e descarta o que não conhece (lib/sara/tela.ts).
 */

export type TelaAtual = { modulo: string; secao: string | null };
export type RegistroAberto = { tipo: string; id: string };

let atual: TelaAtual | null = null;
let registro: RegistroAberto | null = null;

/** Mudou de tela: o registro aberto na anterior deixa de valer. */
export function definirTelaAtual(t: TelaAtual | null) { atual = t; registro = null; }
/** A tela que abre um detalhe avisa ao abrir e limpa ao fechar. */
export function definirRegistroAberto(r: RegistroAberto | null) { registro = r; }
export const lerTelaAtual = () => (atual ? { ...atual, registro } : null);
