/**
 * Resposta do medidor 3D (services/medidor-3d) com `?progresso=1`: NDJSON, uma linha { etapa } a cada passo e a
 * última com { ok, resultado } ou { ok: false, erro }. Sem NDJSON (medidor antigo), lê o JSON inteiro.
 */
export type RespostaMedidor = {
  ok: boolean;
  resultado?: { versao_motor: string; tempo_ms: number; corpos: unknown[]; imagens: Record<string, string> };
  erro?: { codigo: string; mensagem: string };
};

/** Lê o NDJSON do medidor: cada { etapa } avança a tela; a linha com ok fecha. */
export async function lerRespostaComEtapas(resposta: Response, aoAvancar: (texto: string) => void): Promise<RespostaMedidor> {
  if (!(resposta.headers.get("content-type") ?? "").includes("ndjson") || !resposta.body) {
    return (await resposta.json().catch(() => ({ ok: false, erro: { codigo: "RESPOSTA", mensagem: `O medidor respondeu ${resposta.status}.` } }))) as RespostaMedidor;
  }
  const leitor = resposta.body.getReader();
  const texto = new TextDecoder();
  let resto = "";
  let final: RespostaMedidor | null = null;
  const tratar = (linha: string) => {
    if (!linha.trim()) return;
    const o = JSON.parse(linha) as { etapa?: string } & Partial<RespostaMedidor>;
    if (typeof o.etapa === "string") aoAvancar(o.etapa);
    else if (typeof o.ok === "boolean") final = o as RespostaMedidor;
  };
  for (;;) {
    const { value, done } = await leitor.read();
    resto += texto.decode(value ?? new Uint8Array(), { stream: !done });
    const linhas = resto.split("\n");
    resto = linhas.pop() ?? "";
    for (const l of linhas) tratar(l);
    if (done) break;
  }
  tratar(resto);
  return final ?? { ok: false, erro: { codigo: "RESPOSTA", mensagem: "O medidor parou no meio da resposta." } };
}

