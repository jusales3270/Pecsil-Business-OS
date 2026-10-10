/**
 * Miolo do modelo de decisão (Clef, Cloudflare Workers AI), sem dependência de servidor:
 * monta o pedido, lê a resposta, calcula a faixa de confiança e decide quando tentar de
 * novo. O `fetch` vem de fora, para os testes. O cliente do servidor está em ./client.ts.
 *
 * O modelo só responde três tipos de pergunta (mesmo contrato do Jev): `noul` (o quanto
 * uma afirmação é verdadeira, 0 a 1), `choice` (uma opção de uma lista) e `score` (nota
 * numa escala ordenada). Ele não extrai valores nem escreve texto.
 */

export type Pergunta =
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type Resposta =
  | { type: "noul"; valor: number; confianca: number }
  | { type: "choice"; escolha: string; confianca: number; probabilidades: Record<string, number> }
  | { type: "score"; nota: number; nivel: string | null; confianca: number; probabilidades: Record<string, number> };

export type Faixa = "alta" | "media" | "baixa";
export type Limites = { alto: number; baixo: number };
export type ModeloClef = "clef-flash" | "clef";

export type CodigoErro = "NAO_CONFIGURADO" | "CHAVE" | "FORA_DO_AR" | "TEMPO" | "RESPOSTA";
export class DecisaoErro extends Error {
  readonly codigo: CodigoErro;
  constructor(codigo: CodigoErro, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

export const urlClef = (conta: string, modelo: ModeloClef) =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(conta)}/ai/run/@cf/cloudflare/${modelo}`;

export function montarPedido(estado: string, perguntas: Record<string, Pergunta>) {
  if (!estado.trim()) throw new DecisaoErro("RESPOSTA", "Nada para perguntar: o estado está vazio.");
  if (!Object.keys(perguntas).length) throw new DecisaoErro("RESPOSTA", "Informe ao menos uma pergunta.");
  return { state: estado, questions: perguntas };
}

const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Resposta do Clef → respostas tipadas. Sem confiança explícita no `noul`, vale a distância do meio. */
export function lerResposta(json: unknown): { respostas: Record<string, Resposta>; tokens: number | null } {
  const corpo = (json ?? {}) as { result?: unknown; success?: boolean; answers?: unknown };
  const res = (corpo.result ?? corpo) as { answers?: Record<string, Record<string, unknown>>; usage?: { input_tokens?: number } };
  if (!res.answers || typeof res.answers !== "object") throw new DecisaoErro("RESPOSTA", "O modelo respondeu num formato inesperado.");
  const respostas: Record<string, Resposta> = {};
  for (const [nome, a] of Object.entries(res.answers)) {
    const conf = numero(a.confidence);
    if (a.type === "noul" && numero(a.noul) !== null) {
      const v = a.noul as number;
      respostas[nome] = { type: "noul", valor: v, confianca: conf ?? Math.max(v, 1 - v) };
    } else if (a.type === "choice" && typeof a.choice === "string") {
      const prob = (a.probabilities ?? {}) as Record<string, number>;
      respostas[nome] = { type: "choice", escolha: a.choice, confianca: conf ?? prob[a.choice] ?? 0, probabilidades: prob };
    } else if (a.type === "score" && numero(a.score) !== null) {
      const legenda = (a.legend ?? {}) as Record<string, string>;
      const nota = a.score as number;
      respostas[nome] = { type: "score", nota, nivel: legenda[String(Math.round(nota))] ?? null, confianca: conf ?? 0, probabilidades: (a.probabilities ?? {}) as Record<string, number> };
    } else {
      throw new DecisaoErro("RESPOSTA", `Resposta inesperada para "${nome}".`);
    }
  }
  return { respostas, tokens: numero(res.usage?.input_tokens) };
}

/** Confiança geral de uma consulta: a menor entre as respostas (a corrente é tão forte quanto o elo mais fraco). */
export const confiancaGeral = (respostas: Record<string, Resposta>) =>
  Math.min(...Object.values(respostas).map((r) => r.confianca));

export function faixa(confianca: number, limites: Limites): Faixa {
  if (confianca >= limites.alto) return "alta";
  if (confianca < limites.baixo) return "baixa";
  return "media";
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * Chama o Clef. Uma nova tentativa quando o serviço falha (5xx, 429, rede, tempo esgotado);
 * nenhuma quando a chave é recusada. Devolve o JSON e o tempo da chamada que deu certo.
 */
export async function consultar({ fetch, url, token, corpo, timeoutMs = 8000, tentativas = 2 }: {
  fetch: FetchLike; url: string; token: string; corpo: unknown; timeoutMs?: number; tentativas?: number;
}): Promise<{ json: unknown; ms: number }> {
  let ultimo: DecisaoErro = new DecisaoErro("FORA_DO_AR", "O serviço do modelo não respondeu.");
  for (let i = 0; i < tentativas; i++) {
    const inicio = Date.now();
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 401 || r.status === 403) throw new DecisaoErro("CHAVE", "A chave do Clef foi recusada.");
      if (r.status === 429 || r.status >= 500) { ultimo = new DecisaoErro("FORA_DO_AR", `O serviço do modelo respondeu ${r.status}.`); continue; }
      const json = await r.json().catch(() => null);
      if (r.status !== 200 || (json as { success?: boolean } | null)?.success === false) {
        throw new DecisaoErro("RESPOSTA", `O modelo recusou o pedido (${r.status}).`);
      }
      return { json, ms: Date.now() - inicio };
    } catch (e) {
      if (e instanceof DecisaoErro) {
        if (e.codigo === "CHAVE" || e.codigo === "RESPOSTA") throw e;
        ultimo = e;
        continue;
      }
      const nome = (e as { name?: string })?.name;
      ultimo = nome === "TimeoutError" || nome === "AbortError"
        ? new DecisaoErro("TEMPO", "O modelo demorou demais para responder.")
        : new DecisaoErro("FORA_DO_AR", "Não foi possível falar com o serviço do modelo.");
    }
  }
  throw ultimo;
}
