import "server-only";

import { lerConfigClef } from "../decisao/client";
import { CONTEXTO_VOZ, MODELO_VOZ, lerTranscricao } from "./voz-core";

/**
 * Transcrição da pergunta falada (Whisper na Cloudflare, conta e token só de Workers AI do Clef).
 * O áudio não é guardado nem aqui nem lá: vai, volta o texto e acabou.
 */
export async function transcrever(audio: ArrayBuffer): Promise<{ texto: string } | { erro: string }> {
  const config = lerConfigClef();
  if (!config) return { erro: "A voz ainda não está configurada no servidor." };
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.conta)}/ai/run/${MODELO_VOZ}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ audio: Buffer.from(audio).toString("base64"), language: "pt", vad_filter: true, initial_prompt: CONTEXTO_VOZ }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return { erro: r.status === 401 || r.status === 403 ? "A chave da voz foi recusada." : "O serviço de voz não respondeu. Tente de novo." };
    return lerTranscricao(await r.json().catch(() => null));
  } catch {
    return { erro: "O serviço de voz não respondeu. Tente de novo." };
  }
}
