"use client";

import type { EstadoHolo } from "./motor";
import { OCIOSA_MS, PARE_DE_FALAR, avisoDeTela, conversaParaEnviar, dizerExatamente, juntarFala, semTagsDeVoz, type Fala } from "../../../../lib/sara/central/fala-ao-vivo";

/**
 * Motor da voz da SARA central no navegador: OpenAI GPT-Live (`gpt-live-1`, voz "gleam"), desde 11/11/2026, no
 * lugar do Grok. É a ÚNICA voz dela: o cumprimento, as respostas digitadas e a conversa por voz saem por esta
 * sessão (nunca a voz do navegador).
 *
 * - Conexão WebRTC: o navegador cria a oferta e a plataforma abre a sessão na OpenAI com a chave do servidor
 *   (a chave nunca vem para cá). A voz chega numa trilha de áudio (tocada num <audio>, o que deixa o cancelamento
 *   de eco do navegador funcionar) e a altura do som é medida para o holograma reagir à voz de verdade.
 * - Microfone: a sessão abre com uma trilha muda (só fala); tocar no microfone troca a trilha muda pela do
 *   microfone na mesma sessão, sem reconectar.
 * - Pedidos: o GPT-Live avisa quando a pessoa pede algo da empresa (`session.delegation.created`); o roteador da
 *   plataforma escolhe a função (área, central ou tela) pelo fim da conversa, a função roda aqui (com a sessão da
 *   pessoa) e a resposta conferida volta para ser dita palavra por palavra, na língua da pessoa.
 * - `falar(texto)`: diz o texto exatamente (cumprimento e respostas digitadas). A legenda mostra sempre o texto
 *   conferido, não o que a voz transcreve.
 * - Custo: o GPT-Live cobra por minuto de sessão aberta. Dois minutos sem nada acontecer e a sessão fecha; o
 *   próximo toque abre outra, com a conversa anterior (o que foi dito continua valendo).
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

/** A conversa das sessões desta aba: a sessão nova (depois da pausa por inatividade) começa sabendo o que foi dito. */
let conversaDaAba: Fala[] = [];
/** A língua da última fala (vinda do roteador): a resposta digitada também sai nela. */
let linguaDaAba = "pt";

export async function iniciarVozAoVivo(modulo: string, ev: AoVivo, o: { microfone?: boolean } = {}): Promise<SessaoDeVoz> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  void ctx.resume().catch(() => null);
  // Trilha muda: a sessão anda (e fala) mesmo antes de a pessoa ligar o microfone.
  const destinoMudo = ctx.createMediaStreamDestination();
  const fonteMuda = ctx.createConstantSource();
  fonteMuda.offset.value = 0; fonteMuda.connect(destinoMudo); fonteMuda.start();
  const trilhaMuda = destinoMudo.stream.getAudioTracks()[0];

  const pc = new RTCPeerConnection();
  const transceptor = pc.addTransceiver(trilhaMuda, { direction: "sendrecv", streams: [destinoMudo.stream] });
  const som = new Audio();
  som.autoplay = true;
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 512;
  let fonteDaVoz: MediaStreamAudioSourceNode | null = null;
  pc.ontrack = (e) => {
    const fluxo = e.streams[0] ?? new MediaStream([e.track]);
    som.srcObject = fluxo;
    void som.play().catch(() => null);
    try { fonteDaVoz = ctx.createMediaStreamSource(fluxo); fonteDaVoz.connect(analisador); } catch { /* sem medição: o holograma só não pulsa */ }
  };
  const canal = pc.createDataChannel("oai-events");

  let aberto = false, encerrado = false, ultimaAtividade = Date.now(), ocupada = 0, n = 0;
  let mudo = false, textoPronto = false, fimDaEntrada = 0, delegacaoAtual = "";
  let conversa: Fala[] = [...conversaDaAba];
  let esperando: string[] = [];
  const ativo = () => { ultimaAtividade = Date.now(); };
  const novoId = (p: string) => `${p}_${Date.now().toString(36)}_${++n}`;
  const enviar = (m: Record<string, unknown>) => { if (canal.readyState === "open") canal.send(JSON.stringify(m)); };
  const guardar = () => { conversaDaAba = conversaParaEnviar(conversa, 20); };

  /* ---- microfone ---- */
  let mic: MediaStream | null = null;
  const ligarMicrofone = async () => {
    if (mic || encerrado) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este aparelho não usa o microfone no navegador.");
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch(() => { throw new Error("Libere o microfone para a plataforma nas permissões do navegador."); });
    if (encerrado) { fluxo.getTracks().forEach((t) => t.stop()); return; }
    void ctx.resume().catch(() => null);
    await transceptor.sender.replaceTrack(fluxo.getAudioTracks()[0]);
    mic = fluxo; ativo();
  };
  const desligarMicrofone = () => {
    if (!mic) return;
    void transceptor.sender.replaceTrack(trilhaMuda).catch(() => null);
    mic.getTracks().forEach((t) => t.stop());
    mic = null;
  };

  /* ---- a voz que volta: altura do som e estado ---- */
  const bytes = new Uint8Array(analisador.fftSize);
  let quadro = 0, ultimoSom = 0, ultimo: EstadoHolo | null = null;
  const falando = () => Date.now() - ultimoSom < 350;
  const marcar = (e: EstadoHolo) => { if (e !== ultimo) { ultimo = e; ev.estado(e); } };
  const medir = () => {
    analisador.getByteTimeDomainData(bytes);
    let soma = 0;
    for (let i = 0; i < bytes.length; i++) { const v = (bytes[i] - 128) / 128; soma += v * v; }
    const rms = mudo ? 0 : Math.sqrt(soma / bytes.length);
    if (rms > 0.012) { ultimoSom = Date.now(); ativo(); }
    ev.nivel(Math.min(1.3, rms * 4.2));
    marcar(falando() ? "speaking" : ocupada ? "thinking" : mic ? "listening" : "idle");
    quadro = requestAnimationFrame(medir);
  };
  const desmutar = () => { if (mudo) { mudo = false; som.muted = false; } };

  /** Fala o texto conferido palavra por palavra (na língua da pessoa); a legenda é o próprio texto. */
  const dizer = (texto: string, delegacao: string | null, lingua = linguaDaAba) => {
    desmutar(); textoPronto = true; ativo();
    ev.saraDisse(texto);
    conversa = [...conversa, { quem: "sara" as const, texto: semTagsDeVoz(texto).texto }].slice(-40); guardar();
    enviar({ type: "session.instructions.append", event_id: novoId("dizer"), delegation_id: delegacao, content: dizerExatamente(texto, lingua) });
  };
  const falar = (texto: string) => {
    const t = texto.trim();
    if (!t || encerrado) return;
    if (!aberto) { esperando.push(t); return; }
    dizer(t, null);
  };
  const calar = () => {
    if (!falando() || encerrado) return;
    mudo = true; som.muted = true;
    enviar({ type: "session.instructions.append", event_id: novoId("calar"), delegation_id: null, content: PARE_DE_FALAR });
  };

  /* ---- pedidos: o GPT-Live pede a plataforma; o roteador escolhe; a função roda aqui ---- */
  const atender = async (id: string, momento: number) => {
    delegacaoAtual = id; ocupada++; ativo();
    try {
      // A delegação pode chegar antes do fim da transcrição da fala: espera até ~1 s pela parte que falta.
      for (let i = 0; i < 10 && fimDaEntrada < momento - 50 && !encerrado; i++) await new Promise((ok) => setTimeout(ok, 100));
      const r = await fetch(`/api/sara/${modulo}/voz-ao-vivo/rotear`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversa: conversaParaEnviar(conversa, 12) }) }).catch(() => null);
      const escolha = await r?.json().catch(() => null) as { nome?: string; args?: Record<string, unknown>; lingua?: string; error?: string } | null;
      if (encerrado) return;
      if (!r?.ok || !escolha?.nome) {
        enviar({ type: "session.commentary.append", event_id: novoId("falhou"), delegation_id: id, content: "Não consegui entender o pedido agora. Peça à pessoa, em uma frase curta e na língua dela, para repetir." });
        return;
      }
      if (escolha.lingua) linguaDaAba = escolha.lingua;
      const lingua = linguaDaAba;
      const res = await ev.executar(escolha.nome, escolha.args ?? {}).catch((e) => ({ saida: { erro: e instanceof Error ? e.message : "falhou" }, falar: undefined }));
      if (encerrado) return;
      // A pessoa já pediu outra coisa: o resultado antigo vira só contexto (não atropela a resposta nova).
      if (id !== delegacaoAtual) {
        enviar({ type: "session.thinking.append", event_id: novoId("antigo"), delegation_id: id, content: `Resultado de um pedido anterior, que a pessoa já trocou: ${JSON.stringify(res.saida ?? {}).slice(0, 900)}` });
        return;
      }
      if (res.falar) dizer(res.falar, id, lingua);
      else enviar({ type: "session.commentary.append", event_id: novoId("tela"), delegation_id: id, content: avisoDeTela(escolha.nome, res.saida, lingua) });
    } finally { ocupada = Math.max(0, ocupada - 1); ativo(); }
  };

  /* ---- eventos da sessão ---- */
  let iniciou: (ok: boolean) => void = () => {};
  const comecou = new Promise<boolean>((ok) => { iniciou = ok; });
  canal.onmessage = (m) => {
    let e: Record<string, unknown>;
    try { e = JSON.parse(String(m.data)); } catch { return; }
    const tipo = String(e.type ?? "");
    if (tipo === "session.started") {
      aberto = true; ativo(); iniciou(true);
      quadro = requestAnimationFrame(medir);
      const fila = esperando; esperando = [];
      for (const t of fila) falar(t);
      return;
    }
    if (tipo === "session.input_transcript.delta") {
      ativo(); desmutar(); textoPronto = false;
      fimDaEntrada = Math.max(fimDaEntrada, Number(e.end_ms ?? 0));
      conversa = juntarFala(conversa, "pessoa", String(e.delta ?? "")); guardar();
      const ultima = conversa[conversa.length - 1];
      if (ultima?.quem === "pessoa") ev.pessoaDisse(ultima.texto.trim());
      return;
    }
    if (tipo === "session.output_transcript.delta") {
      ativo();
      // Texto conferido sendo dito: a legenda e a conversa já são ele (a transcrição da voz não o reescreve).
      if (textoPronto) return;
      conversa = juntarFala(conversa, "sara", String(e.delta ?? "")); guardar();
      const ultima = conversa[conversa.length - 1];
      if (ultima?.quem === "sara") ev.saraDisse(ultima.texto.trim());
      return;
    }
    if (tipo === "session.delegation.created") {
      const d = e.delegation as { id?: string } | undefined;
      if (d?.id) void atender(d.id, Number(e.offset_ms ?? 0));
      return;
    }
    if (tipo === "session.closed") { iniciou(false); encerrar(); return; }
    if (tipo === "error") {
      const er = e.error as { message?: string; code?: string } | undefined;
      console.warn("[sara] voz ao vivo:", er?.code ?? "", er?.message ?? "");
      if (!aberto) { iniciou(false); return; }
      ev.erro("A voz da SARA teve um problema. Se ela parar de responder, toque no microfone de novo.");
    }
  };

  /* ---- fim: fecha com educação (a OpenAI fecha a conta da sessão) e solta o microfone ---- */
  let vigia: ReturnType<typeof setInterval> | null = null;
  const encerrar = () => {
    if (encerrado) return;
    encerrado = true; aberto = false; guardar();
    if (vigia) clearInterval(vigia);
    cancelAnimationFrame(quadro);
    desligarMicrofone();
    try { fonteDaVoz?.disconnect(); fonteMuda.stop(); } catch { /* já parado */ }
    som.srcObject = null;
    try { canal.close(); } catch { /* já fechado */ }
    try { pc.close(); } catch { /* já fechado */ }
    void ctx.close().catch(() => null);
    ev.fim();
  };
  const parar = () => {
    if (encerrado) return;
    if (canal.readyState !== "open" || !aberto) { encerrar(); return; }
    aberto = false;
    enviar({ type: "session.close" });
    setTimeout(encerrar, 2500);
  };
  canal.onclose = () => encerrar();
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") { ev.erro("Perdi a conexão com a voz da SARA."); encerrar(); }
  };
  vigia = setInterval(() => {
    if (aberto && !ocupada && !falando() && Date.now() - ultimaAtividade > OCIOSA_MS) parar();
  }, 5000);

  /* ---- abre a sessão: oferta → plataforma (que fala com a OpenAI) → resposta ---- */
  try {
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.iceGatheringState !== "complete") {
      await new Promise<void>((ok) => {
        const fim = setTimeout(ok, 4000);
        pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(fim); ok(); } });
      });
    }
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("A voz da SARA está indisponível agora.");
    const r = await fetch(`/api/sara/${modulo}/voz-ao-vivo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp, historico: conversaParaEnviar(conversa, 20) }) });
    const j = await r.json().catch(() => null) as { sdp?: string; error?: string } | null;
    if (!r.ok || !j?.sdp) throw new Error(j?.error ?? "A voz da SARA está indisponível agora.");
    await pc.setRemoteDescription({ type: "answer", sdp: j.sdp });
    const limite = setTimeout(() => iniciou(false), 12_000);
    const ok = await comecou;
    clearTimeout(limite);
    if (!ok) throw new Error("A voz da SARA não respondeu. Tente de novo em instantes.");
  } catch (e) {
    encerrar();
    throw e instanceof Error ? e : new Error("A voz da SARA está indisponível agora.");
  }
  if (o.microfone) await ligarMicrofone().catch((e) => { parar(); throw e; });
  return { parar, falar, calar, ligarMicrofone, desligarMicrofone, escutando: () => Boolean(mic) };
}
