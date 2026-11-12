/**
 * Gravar um texto na voz da SARA (OpenAI GPT-Live, voz "gleam"), no servidor. Decisão do proprietário em 11/11/2026:
 * "quero a mesma voz em tudo". A voz "gleam" só existe no GPT-Live (a API de texto para fala da OpenAI tem outras
 * vozes), então a mensagem de voz do WhatsApp é gravada por uma sessão do próprio GPT-Live:
 *   - a sessão abre por WebSocket com a chave do servidor (OPENAI_API_KEY), com áudio PCM 16 bits a 24 kHz;
 *   - o texto vai em partes (cada instrução cabe em 500 tokens), uma depois que a anterior terminou de ser dita;
 *   - o GPT-Live manda áudio sem parar, no ritmo da fala (medido em 11/11: 27 s de fala levam 27 s), inclusive
 *     silêncio: o fim de cada parte é o silêncio depois da voz, e os silêncios longos são encurtados no fim;
 *   - a transcrição da própria voz confere se a gravação saiu inteira.
 * Sai um WAV (o Evolution converte para nota de voz do WhatsApp; o navegador toca direto).
 * Regras puras testadas em tests/sara-voz-openai.test.mjs; a rede entra por parâmetro (o WebSocket), para os testes.
 */

import { semTagsDeVoz } from "./fala-ao-vivo.ts";
import { MODELO_AO_VIVO, VOZ_AO_VIVO } from "./voz-ao-vivo.ts";

export const TAXA = 24_000;
export const URL_SESSAO_WS = "wss://api.openai.com/v1/live/sessions";
/** Silêncio depois da voz que encerra uma parte. */
const FIM_DA_PARTE_MS = 1300;
/** Sem voz depois de mandar uma parte: algo deu errado. */
const SEM_VOZ_MS = 10_000;

/** As instruções da sessão de gravação: só ler, como a SARA, na língua do texto, no ritmo ágil escolhido pelo dono. */
export function instrucoesDeGravacao(): string {
  return `Você é a SARA, a voz da empresa, gravando uma mensagem de voz que será enviada pelo WhatsApp. Você não conversa: só lê, em voz alta, os textos que a plataforma mandar, um de cada vez, e depois fica em silêncio.
- Leia exatamente o texto, palavra por palavra, sem acrescentar, cortar ou trocar nada, sem cumprimentar nem comentar.
- Leia na língua em que o texto está escrito. Em português, fale português do Brasil, com pronúncia e entonação brasileiras naturais, sem sotaque estrangeiro.
- Tom: cordial, seguro e claro, de quem fala com um colega de trabalho. Ritmo um pouco mais rápido que o normal, fluente, com os números bem claros.
- Leia valores e números como se fala (R$ 1.234,56 = mil duzentos e trinta e quatro reais e cinquenta e seis centavos).
- Se ouvir qualquer som, ignore: ninguém vai falar com você.`;
}

/** A instrução de cada parte: ler exatamente, na língua do texto. */
export function lerParaGravar(bruto: string): string {
  const { texto, expressao } = semTagsDeVoz(bruto);
  return `Leia agora, em voz alta, exatamente o texto entre « e », palavra por palavra e na língua em que ele está escrito, sem acrescentar nem cortar nada; depois fique em silêncio.${expressao ? ` Faça ${expressao} antes de começar (o som, nunca a palavra).` : ""}\n«${texto}»`;
}

/** O texto em partes de até `max` letras, cortando nas frases (e, numa frase longa demais, nas vírgulas ou espaços). */
export function partesParaGravar(texto: string, max = 650): string[] {
  const frases = texto.replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]*["»”)]*\s*/g) ?? [];
  const partes: string[] = [];
  let atual = "";
  const fechar = () => { if (atual.trim()) partes.push(atual.trim()); atual = ""; };
  for (let f of frases) {
    while (f.length > max) {
      const corte = Math.max(f.lastIndexOf(", ", max), f.lastIndexOf(" ", max));
      const ate = corte > max / 3 ? corte + 1 : max;
      fechar(); partes.push(f.slice(0, ate).trim()); f = f.slice(ate);
    }
    if ((atual + f).length > max) fechar();
    atual += f;
  }
  fechar();
  return partes;
}

/** Altura do som de um trecho PCM (0 a 1). */
export function energia(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let soma = 0;
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; soma += v * v; }
  return Math.sqrt(soma / pcm.length);
}

/**
 * Tira o silêncio do começo e do fim e encurta as pausas longas (a espera entre as partes): fica só a fala, com
 * pausas naturais. Uma pausa de até `pausaMaxMs` fica inteira; uma maior vira `pausaMs`.
 */
export function apararSilencios(pcm: Int16Array, o: { limiar?: number; janelaMs?: number; pausaMaxMs?: number; pausaMs?: number; bordaMs?: number } = {}): Int16Array {
  const ms = o.janelaMs ?? 40, janela = Math.round((ms / 1000) * TAXA);
  const limiar = o.limiar ?? 0.008, pausaMax = Math.round((o.pausaMaxMs ?? 700) / ms), pausa = Math.round((o.pausaMs ?? 450) / ms), borda = Math.round((o.bordaMs ?? 150) / ms);
  const n = Math.ceil(pcm.length / janela);
  const voz = Array.from({ length: n }, (_, i) => energia(pcm.subarray(i * janela, (i + 1) * janela)) > limiar);
  const primeira = voz.indexOf(true), ultima = voz.lastIndexOf(true);
  if (primeira < 0) return new Int16Array(0);
  const ini = Math.max(0, primeira - borda), fim = Math.min(n - 1, ultima + borda);
  const manter: number[] = [];
  for (let i = ini; i <= fim; i++) {
    if (voz[i]) { manter.push(i); continue; }
    let j = i;
    while (j <= fim && !voz[j]) j++;
    const tamanho = j - i, fica = tamanho > pausaMax ? pausa : tamanho;
    for (let k = 0; k < fica; k++) manter.push(i + k);
    i = j - 1;
  }
  const saida = new Int16Array(manter.length * janela);
  let k = 0;
  for (const i of manter) { const t = pcm.subarray(i * janela, (i + 1) * janela); saida.set(t, k); k += t.length; }
  return saida.subarray(0, k);
}

/** O WAV (PCM 16 bits, mono) do áudio gravado. */
export function wav(pcm: Int16Array, taxa = TAXA): Uint8Array {
  const dados = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const saida = new Uint8Array(44 + dados.length);
  const v = new DataView(saida.buffer);
  const txt = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) saida[pos + i] = s.charCodeAt(i); };
  txt(0, "RIFF"); v.setUint32(4, 36 + dados.length, true); txt(8, "WAVE"); txt(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, "data"); v.setUint32(40, dados.length, true);
  saida.set(dados, 44);
  return saida;
}

/** A gravação saiu inteira? A transcrição da própria voz tem de cobrir boa parte das palavras do texto. */
export function gravacaoCompleta(texto: string, transcrito: string): boolean {
  const palavras = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z]{3,}/g) ?? [];
  const esperadas = new Set(palavras(semTagsDeVoz(texto).texto));
  if (!esperadas.size) return transcrito.trim().length > 0;
  const ditas = new Set(palavras(transcrito));
  let achadas = 0;
  for (const p of esperadas) if (ditas.has(p)) achadas++;
  return achadas / esperadas.size >= 0.6;
}

type Ws = { send: (s: string) => void; close: () => void; onopen: ((e: unknown) => void) | null; onmessage: ((m: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onclose: ((e: unknown) => void) | null };
type CriarWs = (url: string, chave: string) => Ws;
/** O WebSocket do Node (undici) aceita cabeçalhos: a chave vai no Authorization, só no servidor. */
const wsDoNode: CriarWs = (url, chave) => new (WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => Ws)(url, { headers: { Authorization: `Bearer ${chave}` } });

/** Grava o texto na voz da SARA e devolve o WAV. */
export function gravarNaVozAoVivo(texto: string, o: { chave: string; voz?: string; criarWs?: CriarWs; limiteMs?: number; agora?: () => number }): Promise<Uint8Array> {
  const partes = partesParaGravar(texto);
  if (!partes.length) return Promise.reject(new Error("Nada para gravar."));
  const agora = o.agora ?? Date.now;
  return new Promise<Uint8Array>((ok, falhou) => {
    const ws = (o.criarWs ?? wsDoNode)(URL_SESSAO_WS, o.chave);
    const pedacos: Int16Array[] = [];
    let iniciou = false, terminou = false, parte = -1, falou = false, ultimaVoz = 0, mandouEm = 0, transcrito = "";
    let silencio: ReturnType<typeof setInterval> | null = null;
    const limite = setTimeout(() => acabar(new Error("A gravação da voz demorou demais.")), o.limiteMs ?? 150_000);
    const enviar = (m: unknown) => { try { ws.send(JSON.stringify(m)); } catch { /* fechando */ } };
    const acabar = (erro?: Error) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(limite);
      if (silencio) clearInterval(silencio);
      if (iniciou) enviar({ type: "session.close" });
      setTimeout(() => { try { ws.close(); } catch { /* já fechado */ } }, 300);
      if (erro) { falhou(erro); return; }
      const total = pedacos.reduce((s, p) => s + p.length, 0);
      const junto = new Int16Array(total);
      let k = 0;
      for (const p of pedacos) { junto.set(p, k); k += p.length; }
      const fala = apararSilencios(junto);
      if (fala.length < TAXA / 2) { falhou(new Error("A gravação da voz saiu vazia.")); return; }
      if (!gravacaoCompleta(texto, transcrito)) { falhou(new Error("A gravação da voz saiu incompleta.")); return; }
      ok(wav(fala));
    };
    const proxima = () => {
      parte++;
      if (parte >= partes.length) { acabar(); return; }
      falou = false; mandouEm = agora();
      enviar({ type: "session.instructions.append", event_id: `gravar_${parte}`, delegation_id: null, content: lerParaGravar(partes[parte]) });
    };
    ws.onopen = () => enviar({ type: "session.start", session: { model: MODELO_AO_VIVO, instructions: instrucoesDeGravacao(), audio: { format: { type: "audio/pcm", rate: TAXA }, output: { voice: o.voz ?? VOZ_AO_VIVO } }, delegation: { type: "client" } } });
    ws.onmessage = (m) => {
      if (terminou) return;
      let e: Record<string, unknown>;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      const tipo = String(e.type ?? "");
      if (tipo === "session.started") {
        iniciou = true;
        // A sessão anda com áudio de entrada: silêncio, a cada 100 ms (ninguém fala com a gravação).
        const mudo = Buffer.alloc(4800).toString("base64");
        silencio = setInterval(() => enviar({ type: "session.input_audio.append", audio: mudo }), 100);
        proxima();
        return;
      }
      if (tipo === "session.output_audio.delta" && parte >= 0) {
        const b = Buffer.from(String(e.delta ?? ""), "base64");
        const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~1)));
        pedacos.push(pcm);
        const t = agora();
        if (energia(pcm) > 0.01) { falou = true; ultimaVoz = t; }
        if (falou && t - ultimaVoz > FIM_DA_PARTE_MS) proxima();
        else if (!falou && t - mandouEm > SEM_VOZ_MS) acabar(new Error("A voz não começou a gravação."));
        return;
      }
      if (tipo === "session.output_transcript.delta") { transcrito += String(e.delta ?? ""); return; }
      if (tipo === "error") { const er = e.error as { message?: string } | undefined; acabar(new Error(`A gravação da voz falhou: ${er?.message ?? "erro da sessão"}`.slice(0, 200))); return; }
      if (tipo === "session.closed") acabar(new Error("A sessão de voz fechou antes do fim da gravação."));
    };
    ws.onerror = () => acabar(new Error("Sem conexão com a voz da SARA."));
    ws.onclose = () => acabar(new Error("A conexão com a voz da SARA caiu."));
  });
}
