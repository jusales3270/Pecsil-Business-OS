import { LIMITE_AUDIO } from "./voz-core";

export class AudioInvalido extends Error {
  status: number;
  constructor(mensagem: string, status = 400) { super(mensagem); this.status = status; }
}

/** Bound actual received bytes and total elapsed time before assembling an audio buffer. */
export async function lerAudioLimitado(request: Request, { bytes = LIMITE_AUDIO, prazoMs = 15_000 } = {}): Promise<ArrayBuffer> {
  if (request.headers.has("content-encoding")) throw new AudioInvalido("Formato de áudio não aceito.", 415);
  const declarado = request.headers.get("content-length");
  if (declarado !== null && (!/^\d+$/.test(declarado) || !Number.isSafeInteger(Number(declarado)) || Number(declarado) > bytes)) {
    void request.body?.cancel().catch(() => undefined);
    throw new AudioInvalido("O áudio ficou longo demais. Fale em até um minuto.", 413);
  }
  if (!request.body) throw new AudioInvalido("Áudio vazio.");
  const leitor = request.body.getReader();
  let buffer = new Uint8Array(0);
  const limiteEm = Date.now() + prazoMs;
  let tamanho = 0, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expirou = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AudioInvalido("Tempo de envio do áudio excedido.", 408)), prazoMs);
    });
    for (;;) {
      if (Date.now() >= limiteEm) throw new AudioInvalido("Tempo de envio do áudio excedido.", 408);
      const { done, value } = await Promise.race([leitor.read(), expirou]);
      if (Date.now() >= limiteEm) throw new AudioInvalido("Tempo de envio do áudio excedido.", 408);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new AudioInvalido("Envio do áudio inválido.");
      const total = tamanho + value.byteLength;
      if (total > bytes) throw new AudioInvalido("O áudio ficou longo demais. Fale em até um minuto.", 413);
      // A bounded growing buffer also prevents millions of tiny chunks from retaining millions of objects.
      if (total > buffer.length) {
        const maior = new Uint8Array(Math.min(bytes, Math.max(total, buffer.length * 2, 16_384)));
        maior.set(buffer);
        buffer = maior;
      }
      buffer.set(value, tamanho);
      tamanho = total;
    }
    return buffer.buffer.slice(0, tamanho);
  } catch (e) {
    // Do not wait on a slow peer's cancel implementation while denying this upload.
    void leitor.cancel().catch(() => undefined);
    if (e instanceof AudioInvalido) throw e;
    throw new AudioInvalido("Envio do áudio interrompido.");
  } finally { clearTimeout(timer); leitor.releaseLock(); }
}
