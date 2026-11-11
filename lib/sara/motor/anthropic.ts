import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";

/**
 * A porta única da plataforma para os modelos Claude (I-26, PLANO-SARA-FERRAMENTAS etapa 1). Só este arquivo
 * importa o SDK da Anthropic: as SARAs, a vigia, o Bom dia, o crescimento e a Sentinela chamam `chamarClaude`.
 * Trocar ou somar outro provedor (lib/sara/modelos.ts › Provedor) mexe só aqui.
 *
 * - O SDK não repete a chamada (maxRetries 0): a nova tentativa e o modelo reserva são da plataforma
 *   (lib/sara/tentativas.ts), com as regras de cada lugar (timeout, falha silenciosa).
 * - Nunca lança por falha da API: devolve o que aconteceu (status, mensagem, retry-after, demora, rede), no
 *   formato que as chamadas já tratavam com o fetch direto. Só lança CANCELADA quando o sinal de quem chamou cancela.
 * - `buscar` troca o fetch (testes); sem ele, o fetch global.
 */

export type CorpoClaude = Anthropic.MessageCreateParamsNonStreaming;
export type MensagemClaude = Anthropic.Message;

export type ResultadoClaude =
  | { ok: true; mensagem: MensagemClaude }
  | { ok: false; status: number; erro: string; retryAfter: string | null; demorou: boolean; rede: boolean };

/** O que um `buscar` pode devolver: a resposta do fetch ou a forma curta dos testes ({ ok, status, json, headers }). */
type RespostaCurta = { ok?: boolean; status?: number; json?: () => Promise<unknown>; headers?: { get?: (nome: string) => string | null } };

async function comoResposta(r: Response | RespostaCurta): Promise<Response> {
  if (r instanceof Response) return r;
  const corpo = r.json ? await r.json().catch(() => null) : null;
  const cabecalhos = new Headers({ "content-type": "application/json" });
  const espera = r.headers?.get?.("retry-after");
  if (espera) cabecalhos.set("retry-after", espera);
  return new Response(JSON.stringify(corpo), { status: r.status ?? (r.ok === false ? 500 : 200), headers: cabecalhos });
}

export async function chamarClaude(corpo: CorpoClaude, o: { chave: string; buscar?: typeof fetch; timeoutMs: number; sinal?: AbortSignal | null }): Promise<ResultadoClaude> {
  const buscar = o.buscar;
  const cliente = new Anthropic({ apiKey: o.chave, maxRetries: 0, timeout: o.timeoutMs,
    ...(buscar ? { fetch: async (url: string | URL | Request, init?: RequestInit) => comoResposta(await buscar(url, init) as Response | RespostaCurta) } : {}) });
  try {
    const mensagem = await cliente.messages.create(corpo, { signal: o.sinal ?? undefined });
    // 200 sem conteúdo veio quebrado: conta como falha passageira (tentativas.ts › statusPassageiro).
    if (!Array.isArray(mensagem?.content)) return { ok: false, status: 200, erro: "resposta sem conteúdo", retryAfter: null, demorou: false, rede: false };
    return { ok: true, mensagem };
  } catch (e) {
    if (e instanceof APIUserAbortError || o.sinal?.aborted) throw new Error("CANCELADA");
    if (e instanceof APIConnectionTimeoutError) return { ok: false, status: 0, erro: `sem resposta em ${Math.round(o.timeoutMs / 1000)} s`, retryAfter: null, demorou: true, rede: false };
    if (e instanceof APIConnectionError) return { ok: false, status: 0, erro: `falha de rede: ${(e.message || "erro").slice(0, 120)}`, retryAfter: null, demorou: false, rede: true };
    if (e instanceof APIError) {
      const corpoErro = e.error as { error?: { message?: string } } | undefined;
      return { ok: false, status: e.status ?? 0, erro: corpoErro?.error?.message ?? e.message ?? "", retryAfter: e.headers?.get("retry-after") ?? null, demorou: false, rede: false };
    }
    return { ok: false, status: 0, erro: e instanceof Error ? e.message.slice(0, 200) : "erro", retryAfter: null, demorou: false, rede: true };
  }
}

/** O texto da resposta (os blocos de texto juntos). */
export const textoDe = (m: MensagemClaude) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

/** A entrada da primeira chamada de ferramenta da resposta (ou a da ferramenta `nome`), ou null. */
export function entradaDe<T = Record<string, unknown>>(m: MensagemClaude, nome?: string): T | null {
  const b = m.content.find((x) => x.type === "tool_use" && (!nome || x.name === nome));
  return b && b.type === "tool_use" ? (b.input as T) : null;
}
