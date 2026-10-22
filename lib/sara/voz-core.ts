/**
 * Voz da SARA (E2, 22/10/2026): regras puras da transcrição (sem rede). O áudio vai ao Whisper da
 * Cloudflare (Workers AI, a mesma conta do Clef), que não treina nem guarda o conteúdo (política
 * oficial conferida em 22/10). Aqui: que áudio aceitar e como ler a resposta.
 */

export const MODELO_VOZ = "@cf/openai/whisper-large-v3-turbo";
/** Até ~1 minuto de fala: Opus do Android fica bem abaixo; m4a do iPhone, perto de 1 MB. */
export const LIMITE_AUDIO = 4 * 1024 * 1024;
const TIPOS = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"];

/** Vocabulário da fábrica para guiar a transcrição (sem dado da empresa). */
export const CONTEXTO_VOZ = "Fábrica de moldes para vidro: fundição, usinagem, almoxarifado, compras, pedido de material, eletrodo, molde, forma, peça, desenho, ordem de serviço.";

export function conferirAudio(tipo: string | null, tamanho: number): { ok: true } | { ok: false; erro: string } {
  const t = String(tipo ?? "").split(";")[0].trim().toLowerCase();
  if (!TIPOS.includes(t)) return { ok: false, erro: "Formato de áudio não aceito." };
  if (tamanho < 1000) return { ok: false, erro: "Não deu para ouvir. Segure um pouco mais e fale perto do celular." };
  if (tamanho > LIMITE_AUDIO) return { ok: false, erro: "O áudio ficou longo demais. Fale em até um minuto." };
  return { ok: true };
}

/** Texto da resposta do Whisper (Workers AI): `result.text`. Vazio ou só ruído vira "não entendi". */
export function lerTranscricao(json: unknown): { texto: string } | { erro: string } {
  const r = (json as { result?: { text?: unknown } } | null)?.result;
  const texto = typeof r?.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
  if (texto.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return { erro: "Não entendi o áudio. Tente de novo, falando perto do celular." };
  return { texto: texto.slice(0, 2000) };
}
