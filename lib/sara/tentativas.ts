/**
 * Provedor reserva da SARA (I-20, 30/10/2026). A chamada ao modelo é repetida em cada rodada, nunca a conversa
 * inteira: repetir a conversa rodaria de novo as consultas e prepararia as ações em dobro.
 *
 * Falha passageira (limite de uso, sobrecarga, rede, demora): uma nova tentativa com espera curta no modelo
 * escolhido e depois o reserva. Demora não repete no mesmo modelo: a pessoa já esperou 60 s. Falha de configuração
 * (chave errada, modelo que não existe, pedido recusado) não aciona o reserva: é para arrumar, não é queda.
 * Não lê o ambiente, então é testável.
 */

const TENTATIVAS_POR_MODELO = 2;
const ESPERA_MS = 1_000;
/** Pede para esperar mais do que isto (retry-after): vale mais ir direto ao reserva. */
const ESPERA_MAXIMA_MS = 5_000;

export type FalhaRegistrada = { modelo: string; motivo: string };

export class FalhaDoModelo extends Error {
  readonly passageira: boolean;
  /** A chamada estourou o tempo: não vale repetir no mesmo modelo. */
  readonly demorou: boolean;
  /** Quanto o provedor pediu para esperar (retry-after), se pediu. */
  readonly esperaMs: number | null;
  constructor(motivo: string, o: { passageira: boolean; demorou?: boolean; esperaMs?: number | null }) {
    super(`MODELO_INDISPONIVEL: ${motivo}`);
    this.passageira = o.passageira;
    this.demorou = o.demorou ?? false;
    this.esperaMs = o.esperaMs ?? null;
  }
  get motivo() { return this.message.replace(/^MODELO_INDISPONIVEL: /, ""); }
}

/** 408, 429 e 5xx (529 = sobrecarga) passam; 400, 401, 403 e 404 são configuração. 200 sem conteúdo veio quebrado. */
export const statusPassageiro = (status: number) => status === 200 || status === 408 || status === 429 || status >= 500;

/** Segundos do retry-after (a data HTTP também é válida, mas a Anthropic manda segundos). */
export function lerRetryAfter(valor: string | null | undefined): number | null {
  const n = Number(valor);
  return valor && Number.isFinite(n) && n >= 0 ? n * 1000 : null;
}

export const falhaDaResposta = (status: number, mensagem: string, retryAfter?: string | null) =>
  new FalhaDoModelo(`${status} ${mensagem}`.trim(), { passageira: statusPassageiro(status), esperaMs: lerRetryAfter(retryAfter) });

function dormir(ms: number, sinal?: AbortSignal) {
  return new Promise<void>((pronto) => {
    if (sinal?.aborted) return pronto();
    const fim = () => { clearTimeout(t); sinal?.removeEventListener("abort", fim); pronto(); };
    const t = setTimeout(fim, ms);
    sinal?.addEventListener("abort", fim);
  });
}

/**
 * Chama o modelo com nova tentativa e reserva. `falhas` traz tudo o que falhou antes de dar certo, para o registro
 * da mensagem. Quando nenhum dos dois responde, o erro lista todos os motivos.
 */
export async function comReserva<T>(a: {
  modelo: string; reserva: string | null; chamar: (modelo: string) => Promise<T>; sinal?: AbortSignal;
  esperar?: (ms: number, sinal?: AbortSignal) => Promise<void>;
}): Promise<{ resultado: T; modelo: string; falhas: FalhaRegistrada[] }> {
  const esperar = a.esperar ?? dormir;
  const falhas: FalhaRegistrada[] = [];
  for (const modelo of a.reserva && a.reserva !== a.modelo ? [a.modelo, a.reserva] : [a.modelo]) {
    for (let tentativa = 1; tentativa <= TENTATIVAS_POR_MODELO; tentativa++) {
      try {
        return { resultado: await a.chamar(modelo), modelo, falhas };
      } catch (e) {
        if (!(e instanceof FalhaDoModelo) || !e.passageira) throw e;
        falhas.push({ modelo, motivo: e.motivo });
        console.warn("[sara] modelo falhou", modelo, e.motivo.slice(0, 200));
        if (e.demorou || (e.esperaMs ?? 0) > ESPERA_MAXIMA_MS || tentativa === TENTATIVAS_POR_MODELO) break;
        await esperar(e.esperaMs ?? ESPERA_MS, a.sinal);
        if (a.sinal?.aborted) throw new Error("CANCELADA");
      }
    }
  }
  throw new FalhaDoModelo(falhas.map((f) => `${f.modelo}: ${f.motivo}`).join(" | "), { passageira: true });
}
