/**
 * Busca por significado (Segundo Cérebro, Etapa 5B; D5 = local). O texto de cada documento é
 * dividido em trechos com sobreposição; cada trecho vira um vetor de significado no servidor.
 * Sem dependência de servidor (testável).
 */
export const TAM_TRECHO = 800;
export const SOBREPOSICAO = 120;
/** Documento muito longo: os primeiros 100 trechos (~70 mil caracteres) bastam para a busca. */
export const MAX_TRECHOS = 100;

/** Divide em trechos de até ~800 caracteres, cortando em espaço, com 120 de sobreposição. */
export function dividirEmTrechos(texto: string, tamanho = TAM_TRECHO, sobreposicao = SOBREPOSICAO, max = MAX_TRECHOS): string[] {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3) return [];
  const trechos: string[] = [];
  let inicio = 0;
  while (inicio < t.length && trechos.length < max) {
    let fim = Math.min(t.length, inicio + tamanho);
    if (fim < t.length) {
      const espaco = t.lastIndexOf(" ", fim);
      if (espaco > inicio + tamanho / 2) fim = espaco;
    }
    trechos.push(t.slice(inicio, fim).trim());
    if (fim >= t.length) break;
    let proximo = fim - sobreposicao;
    const espaco = t.indexOf(" ", proximo);
    if (espaco > 0 && espaco < fim) proximo = espaco + 1;
    inicio = Math.max(proximo, inicio + 1);
  }
  return trechos.filter(Boolean);
}

export type PorSentido = { id: string; similaridade: number };

/**
 * Quais resultados por sentido mostrar. As notas desse modelo ficam próximas (≈0,80–0,87), então o
 * corte é RELATIVO ao melhor: entra quem está a até `margem` dele, com um piso e um máximo.
 */
export function escolherPorSentido<T extends PorSentido>(lista: readonly T[], { margem = 0.025, piso = 0.8, max = 5 } = {}): T[] {
  const ordenada = [...lista].sort((a, b) => b.similaridade - a.similaridade);
  const melhor = ordenada[0]?.similaridade ?? 0;
  if (melhor < piso) return [];
  return ordenada.filter((x) => x.similaridade >= Math.max(piso, melhor - margem)).slice(0, max);
}

type Achado = { id: string; trecho: string | null; como: string };

/**
 * Junta a busca por palavras com a por sentido, sem repetir documento:
 * 1. os que têm as PALAVRAS vêm primeiro;
 * 2. depois os achados pelo SENTIDO;
 * 3. por último os PARECIDOS por erro de digitação — que perdem o lugar (e o rótulo) para o
 *    sentido quando o mesmo documento aparece nos dois ("conta de luz" casava "conta" por digitação).
 */
export function juntarComSentido(porPalavra: readonly Achado[], porSentido: readonly { id: string; trecho: string | null }[]): Achado[] {
  const palavras = porPalavra.filter((a) => a.como === "palavras");
  const usados = new Set(palavras.map((a) => a.id));
  const sentido = porSentido.filter((s) => !usados.has(s.id)).map((s) => ({ id: s.id, trecho: s.trecho, como: "significado" }));
  for (const s of sentido) usados.add(s.id);
  const parecidos = porPalavra.filter((a) => a.como !== "palavras" && !usados.has(a.id));
  return [...palavras, ...sentido, ...parecidos];
}
