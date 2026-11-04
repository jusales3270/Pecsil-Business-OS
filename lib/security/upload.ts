/** Teto aplicado aos bytes recebidos, inclusive upload chunked e multipart mentiroso. */
export class EnvioInvalido extends Error {
  status: number;
  constructor(mensagem: string, status = 400) { super(mensagem); this.status = status; }
}

export async function lerFormularioLimitado(request: Request, { bytes = 15_256_000, prazoMs = 30_000, partes = 8 } = {}): Promise<FormData> {
  const tipo = request.headers.get("content-type") ?? "";
  const boundary = tipo.match(/^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,\-./:=? ]{1,70})"|([A-Za-z0-9'()+_,\-./:=?]{1,70}))\s*$/i);
  if (!boundary || request.headers.has("content-encoding")) throw new EnvioInvalido("Envio inválido.", 415);
  const declarado = request.headers.get("content-length");
  if (declarado !== null && (!/^\d+$/.test(declarado) || Number(declarado) > bytes)) throw new EnvioInvalido("Envio acima do limite permitido.", 413);
  if (!request.body) throw new EnvioInvalido("Envio inválido.");
  const leitor = request.body.getReader(), chunks: Uint8Array[] = [];
  let tamanho = 0, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const expirou = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new EnvioInvalido("Tempo de envio excedido.", 408)), prazoMs); });
    for (;;) {
      const { done, value } = await Promise.race([leitor.read(), expirou]);
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > bytes) throw new EnvioInvalido("Envio acima do limite permitido.", 413);
      chunks.push(value);
    }
  } catch (e) {
    void leitor.cancel().catch(() => undefined);
    if (e instanceof EnvioInvalido) throw e;
    throw new EnvioInvalido("Envio interrompido.");
  } finally { clearTimeout(timer); leitor.releaseLock(); }
  const corpo = Buffer.concat(chunks, tamanho);
  const separador = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  // Limita também a quantidade de objetos criados pelo parser multipart nativo.
  let p = 0, encontrados = 0;
  while ((p = corpo.indexOf(separador, p)) !== -1) {
    if (++encontrados > partes + 1) throw new EnvioInvalido("Muitos campos no envio.");
    p += separador.length;
  }
  try { return await new Response(corpo, { headers: { "content-type": tipo } }).formData(); }
  catch { throw new EnvioInvalido("Envio inválido."); }
}
