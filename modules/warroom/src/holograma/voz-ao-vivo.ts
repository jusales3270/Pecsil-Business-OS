"use client";

import type { EstadoHolo } from "./motor";

/**
 * Motor da voz da SARA central no navegador (Grok Voice Realtime, xAI, voz "luna", pt-BR). É a ÚNICA voz
 * dela: o cumprimento, as respostas digitadas e a conversa por voz saem por esta sessão (nunca a voz do
 * navegador). Liga direto ao Grok com o token temporário que a plataforma pede (a chave nunca vem para cá),
 * toca a voz que volta medindo a altura do som (o holograma reage à voz de verdade) e, com o microfone
 * ligado, manda o áudio em PCM 16 bits / 24 kHz.
 *
 * - `falar(texto)`: fala o texto EXATAMENTE como veio (frase exata, `force_message`), sem o modelo reformular.
 * - Microfone: a sessão abre sem ele (só fala); tocar no microfone liga e desliga a escuta na mesma sessão.
 * - Agir enquanto fala: cada função pedida pelo Grok é executada NO INSTANTE em que chega, com o áudio ainda
 *   tocando; a resposta conferida da SARA central é falada exatamente como veio.
 */

export type AoVivo = {
  estado: (e: EstadoHolo) => void;
  nivel: (n: number) => void;
  pessoaDisse: (texto: string) => void;
  saraDisse: (texto: string) => void;
  /** Executa a função pedida. `falar`: a resposta conferida, para ser dita palavra por palavra. */
  executar: (nome: string, args: Record<string, unknown>) => Promise<{ saida: unknown; falar?: string }>;
  erro: (mensagem: string) => void;
  fim: () => void;
};
export type SessaoDeVoz = {
  parar: () => void;
  /** Fala o texto exatamente como veio, na voz da SARA. */
  falar: (texto: string) => void;
  /** Cala o que está falando agora. */
  calar: () => void;
  ligarMicrofone: () => Promise<void>;
  desligarMicrofone: () => void;
  escutando: () => boolean;
};

const TAXA = 24000;
const PROCESSADOR = `class Captura extends AudioWorkletProcessor {
  process(entradas) { const c = entradas[0] && entradas[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor("sara-captura", Captura);`;

const paraBase64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const deBase64 = (b64: string) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

/** Float32 na taxa do aparelho → PCM 16 bits a 24 kHz (reamostragem linear quando a taxa é outra). */
function paraPcm16(amostras: Float32Array, taxaOrigem: number): Uint8Array {
  const fator = taxaOrigem / TAXA;
  const n = Math.floor(amostras.length / fator);
  const saida = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * fator, a = Math.floor(pos), b = Math.min(a + 1, amostras.length - 1), f = pos - a;
    const v = Math.max(-1, Math.min(1, amostras[a] * (1 - f) + amostras[b] * f));
    saida[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return new Uint8Array(saida.buffer);
}

export async function iniciarVozAoVivo(modulo: string, ev: AoVivo, o: { microfone?: boolean } = {}): Promise<SessaoDeVoz> {
  const r = await fetch(`/api/sara/${modulo}/voz-ao-vivo`, { method: "POST" });
  const j = await r.json().catch(() => null) as { token?: string; url?: string; sessao?: unknown; error?: string } | null;
  if (!r.ok || !j?.token || !j.url) throw new Error(j?.error ?? "A voz da SARA está indisponível agora.");

  // Áudio: tenta a taxa do Grok (24 kHz); se o aparelho não aceitar, reamostra na captura.
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext;
  try { ctx = new Ctx({ sampleRate: TAXA }); } catch { ctx = new Ctx(); }
  void ctx.resume().catch(() => null);
  const saidaGanho = ctx.createGain();
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 512;
  saidaGanho.connect(analisador); analisador.connect(ctx.destination);
  const urlProcessador = URL.createObjectURL(new Blob([PROCESSADOR], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(urlProcessador);
  URL.revokeObjectURL(urlProcessador);

  const ws = new WebSocket(j.url, [`xai-client-secret.${j.token}`]);
  let aberto = false, encerrado = false;
  const enviar = (m: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
  // O que pedirem para falar antes de a sessão abrir sai assim que ela abrir.
  let esperando: string[] = [];

  // Microfone → Grok, em pedaços de ~100 ms (só com a escuta ligada).
  let mic: { fluxo: MediaStream; fonte: MediaStreamAudioSourceNode; captura: AudioWorkletNode; silencio: GainNode } | null = null;
  let acumulado: Float32Array[] = [], tamanho = 0;
  const aoCapturar = (e: MessageEvent<Float32Array>) => {
    if (!aberto || !mic) return;
    acumulado.push(e.data); tamanho += e.data.length;
    if (tamanho < ctx.sampleRate / 10) return;
    const junto = new Float32Array(tamanho); let off = 0;
    for (const a of acumulado) { junto.set(a, off); off += a.length; }
    acumulado = []; tamanho = 0;
    enviar({ type: "input_audio_buffer.append", audio: paraBase64(paraPcm16(junto, ctx.sampleRate)) });
  };
  const ligarMicrofone = async () => {
    if (mic || encerrado) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este aparelho não usa o microfone no navegador.");
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch(() => { throw new Error("Libere o microfone para a plataforma nas permissões do navegador."); });
    void ctx.resume().catch(() => null);
    const fonte = ctx.createMediaStreamSource(fluxo);
    const captura = new AudioWorkletNode(ctx, "sara-captura");
    const silencio = ctx.createGain(); silencio.gain.value = 0; // o nó precisa de destino para rodar (sem eco)
    fonte.connect(captura); captura.connect(silencio); silencio.connect(ctx.destination);
    captura.port.onmessage = aoCapturar;
    mic = { fluxo, fonte, captura, silencio };
  };
  const desligarMicrofone = () => {
    if (!mic) return;
    mic.captura.port.onmessage = null;
    try { mic.fonte.disconnect(); mic.captura.disconnect(); mic.silencio.disconnect(); } catch { /* já desligado */ }
    mic.fluxo.getTracks().forEach((t) => t.stop());
    mic = null; acumulado = []; tamanho = 0;
    enviar({ type: "input_audio_buffer.clear" });
  };

  // Grok → alto-falante, na ordem, sem buracos; interrompível.
  let proxima = 0;
  const tocando = new Set<AudioBufferSourceNode>();
  const tocar = (b64: string) => {
    const bytes = deBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buf = ctx.createBuffer(1, pcm.length, TAXA);
    const canal = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(saidaGanho);
    const inicio = Math.max(ctx.currentTime + 0.03, proxima);
    src.start(inicio); proxima = inicio + buf.duration;
    tocando.add(src); src.onended = () => tocando.delete(src);
  };
  const calar = () => { for (const s of tocando) { try { s.stop(); } catch { /* já parou */ } } tocando.clear(); proxima = 0; };
  const falando = () => proxima > ctx.currentTime + 0.02;
  const fimDaFala = () => new Promise<void>((ok) => { const t = setInterval(() => { if (!falando() || encerrado) { clearInterval(t); ok(); } }, 120); });

  // Altura do som (para a esfera) e o estado (falando / ouvindo / parada), a cada quadro.
  const bytesNivel = new Uint8Array(analisador.fftSize);
  let quadro = 0, ocupada = false, ultimo: EstadoHolo | null = null;
  const marcar = (e: EstadoHolo) => { if (e !== ultimo) { ultimo = e; ev.estado(e); } };
  const medir = () => {
    analisador.getByteTimeDomainData(bytesNivel);
    let soma = 0;
    for (let i = 0; i < bytesNivel.length; i++) { const v = (bytesNivel[i] - 128) / 128; soma += v * v; }
    ev.nivel(Math.min(1.3, Math.sqrt(soma / bytesNivel.length) * 4.2));
    marcar(falando() ? "speaking" : ocupada ? "thinking" : mic ? "listening" : "idle");
    quadro = requestAnimationFrame(medir);
  };

  // Texto pronto sendo falado: a legenda já é ele inteiro (a transcrição do Grok não a reescreve aos pedaços).
  let textoPronto = false;
  /** Fala exatamente este texto (frase exata, sem o modelo reformular). */
  const falar = (texto: string) => {
    const t = texto.trim();
    if (!t || encerrado) return;
    if (!aberto) { esperando.push(t); return; }
    calar();
    textoPronto = true;
    ev.saraDisse(t);
    enviar({ type: "conversation.item.create", item: { type: "force_message", role: "assistant", content: [{ type: "output_text", text: t }] } });
  };

  // Funções: executadas no instante em que chegam (com o áudio ainda tocando).
  let pendentes: Promise<{ falar?: string }>[] = [];
  let falaSara = "";
  const executarChamada = (nome: string, callId: string, bruto: string) => {
    let args: Record<string, unknown> = {};
    try { args = bruto ? JSON.parse(bruto) : {}; } catch { args = {}; }
    if (nome === "consultar_sara_central") ocupada = true;
    const p = ev.executar(nome, args)
      .catch((e) => ({ saida: { erro: e instanceof Error ? e.message : "falhou" }, falar: undefined }))
      .then((res) => { enviar({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(res.saida ?? { ok: true }) } }); return { falar: res.falar }; });
    pendentes.push(p);
  };
  // Fim da vez do Grok: com todas as respostas das funções entregues, ou fala a resposta conferida (frase
  // exata, depois de terminar o que ele está dizendo), ou deixa o Grok continuar.
  const fecharVez = async () => {
    if (!pendentes.length) return;
    const lote = pendentes; pendentes = [];
    const res = await Promise.all(lote);
    ocupada = false;
    await fimDaFala();
    if (encerrado) return;
    const dizer = res.map((x) => x.falar).filter(Boolean).join(" ");
    if (dizer) { textoPronto = true; ev.saraDisse(dizer); enviar({ type: "conversation.item.create", item: { type: "force_message", role: "assistant", content: [{ type: "output_text", text: dizer }] } }); }
    else enviar({ type: "response.create" });
  };

  ws.onopen = () => {
    aberto = true;
    enviar({ type: "session.update", session: j.sessao });
    quadro = requestAnimationFrame(medir);
    const fila = esperando; esperando = [];
    for (const t of fila) falar(t);
  };
  ws.onmessage = (m) => {
    let e: Record<string, unknown>;
    try { e = JSON.parse(String(m.data)); } catch { return; }
    const tipo = String(e.type ?? "");
    if (tipo === "response.output_audio.delta" || tipo === "response.audio.delta") { if (typeof e.delta === "string") tocar(e.delta); return; }
    if (tipo === "response.created") { falaSara = ""; return; }
    if (tipo === "response.output_audio_transcript.delta" || tipo === "response.audio_transcript.delta") { falaSara += String(e.delta ?? ""); if (!textoPronto) ev.saraDisse(falaSara); return; }
    if (tipo.startsWith("conversation.item.input_audio_transcription")) {
      const t = String(e.transcript ?? (e as { item?: { transcript?: string } }).item?.transcript ?? "").trim();
      if (t) { if (falando()) calar(); ev.pessoaDisse(t); }
      return;
    }
    if (tipo === "input_audio_buffer.speech_started") { if (mic) calar(); return; }
    if (tipo === "response.function_call_arguments.done") { executarChamada(String(e.name ?? ""), String(e.call_id ?? ""), String(e.arguments ?? "")); return; }
    if (tipo === "response.done") { textoPronto = false; void fecharVez(); return; }
    if (tipo === "error") { const er = e.error as { message?: string } | undefined; ev.erro(er?.message ?? "A voz da SARA teve um problema."); }
  };
  const parar = () => {
    if (encerrado) return;
    encerrado = true;
    cancelAnimationFrame(quadro); calar(); desligarMicrofone();
    try { ws.close(); } catch { /* já fechado */ }
    void ctx.close().catch(() => null);
    ev.fim();
  };
  ws.onerror = () => { ev.erro("Perdi a conexão com a voz da SARA."); parar(); };
  ws.onclose = () => parar();
  if (o.microfone) await ligarMicrofone().catch((e) => { parar(); throw e; });
  return { parar, falar, calar, ligarMicrofone, desligarMicrofone, escutando: () => Boolean(mic) };
}
