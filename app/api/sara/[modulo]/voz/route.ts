import { AudioInvalido, lerAudioLimitado } from "../../../../../lib/sara/audio-limitado";
import { reservarTranscricao } from "../../../../../lib/sara/uso-servidor";
import { NextResponse } from "next/server";
import { preparar } from "../../../../../lib/sara/sessao";
import { transcrever } from "../../../../../lib/sara/voz";
import { conferirAudio } from "../../../../../lib/sara/voz-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pergunta falada para a SARA (E2): o áudio vira texto no Whisper da Cloudflare e volta para a tela,
 * que manda a pergunta normal. Mesma regra de acesso da SARA; o áudio não fica guardado.
 */
export async function POST(request: Request, context: { params: Promise<{ modulo: string }> }) {
  const { modulo } = await context.params;
  const p = await preparar(modulo);
  if ("erro" in p) return p.erro;
  let audio: ArrayBuffer;
  try { audio = await lerAudioLimitado(request); }
  catch (e) { return NextResponse.json({ error: e instanceof AudioInvalido ? e.message : "Envio do áudio interrompido." }, { status: e instanceof AudioInvalido ? e.status : 400 }); }
  const conferido = conferirAudio(request.headers.get("content-type"), audio?.byteLength ?? 0);
  if (!audio || !conferido.ok) return NextResponse.json({ error: conferido.ok ? "Áudio vazio." : conferido.erro }, { status: 400 });
  try { await reservarTranscricao(p.sb, modulo, audio.byteLength); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Transcrição indisponível." }, { status: 429 }); }
  const r = await transcrever(audio);
  return "erro" in r ? NextResponse.json({ error: r.erro }, { status: 502 }) : NextResponse.json({ texto: r.texto });
}
