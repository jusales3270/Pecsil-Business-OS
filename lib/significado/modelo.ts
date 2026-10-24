import "server-only";

import { join } from "node:path";

/**
 * Modelo de significado LOCAL (D5 do proprietário): multilingual-e5-small, rodando no servidor da
 * Pecsil (ONNX, sem placa de vídeo). Nenhum texto sai da empresa: só o modelo é baixado, uma vez
 * (≈118 MB), para `MODELOS_DIR` ou `.modelos/` no projeto.
 *
 * Ocupa ≈430 MB de memória enquanto carregado. Carrega quando precisa (busca ou rodada) e é
 * descarregado depois de 10 minutos sem uso. Se não puder carregar (sem internet na primeira vez,
 * ou num sistema sem o motor — ex.: Mac Intel em desenvolvimento), devolve null e a busca segue
 * só por palavras.
 */

const MODELO = "Xenova/multilingual-e5-small";
const OCIOSO_MS = 10 * 60_000;
export const DIMENSOES = 384;

type Extrator = ((textos: string | string[], opcoes: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist: () => number[][] }>) & { dispose?: () => Promise<void> };

let carregando: Promise<Extrator | null> | null = null;
let ocioso: ReturnType<typeof setTimeout> | null = null;
let indisponivelAte = 0;

function agendarDescarga() {
  if (ocioso) clearTimeout(ocioso);
  ocioso = setTimeout(() => { void descarregar(); }, OCIOSO_MS);
  ocioso.unref?.();
}

async function descarregar() {
  const atual = carregando;
  carregando = null;
  ocioso = null;
  const extrator = await atual?.catch(() => null);
  await extrator?.dispose?.().catch(() => undefined);
}

async function modelo(): Promise<Extrator | null> {
  if (Date.now() < indisponivelAte) return null;
  carregando ??= (async () => {
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = process.env.MODELOS_DIR?.trim() || join(process.cwd(), ".modelos");
      return (await pipeline("feature-extraction", MODELO, { dtype: "q8" })) as unknown as Extrator;
    } catch (e) {
      console.error("Modelo de significado indisponível; a busca segue por palavras.", e instanceof Error ? e.message : e);
      indisponivelAte = Date.now() + 10 * 60_000; // não tenta de novo a cada busca
      carregando = null;
      return null;
    }
  })();
  const m = await carregando;
  if (m) agendarDescarga();
  return m;
}

/** Vetor da pergunta (prefixo "query:" do e5). Null se o modelo não estiver disponível. */
export async function vetorDaPergunta(pergunta: string): Promise<number[] | null> {
  const m = await modelo();
  if (!m) return null;
  return (await m(`query: ${pergunta.slice(0, 300)}`, { pooling: "mean", normalize: true })).tolist()[0];
}

/** Vetores dos trechos (prefixo "passage:"), de 8 em 8. Null se o modelo não estiver disponível. */
export async function vetoresDosTrechos(trechos: string[]): Promise<number[][] | null> {
  const m = await modelo();
  if (!m) return null;
  const vetores: number[][] = [];
  for (let i = 0; i < trechos.length; i += 8) {
    vetores.push(...(await m(trechos.slice(i, i + 8).map((t) => `passage: ${t}`), { pooling: "mean", normalize: true })).tolist());
  }
  agendarDescarga();
  return vetores;
}

/** Vetor no formato que o pgvector aceita ("[0.1,0.2,…]"). */
export const comoVetor = (v: number[]) => `[${v.map((x) => Number(x.toFixed(6))).join(",")}]`;
