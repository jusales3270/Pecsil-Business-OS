"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Texto } from "../../../../app/components/sara-painel";
import { SaraVisual } from "../../../../app/components/sara-visual";
import { pedirRegistro, type PedidoRegistro } from "../../../../lib/abrir-registro";
import { resumoFalado } from "../../../../lib/sara/central/fala";
import type { Visual } from "../../../../lib/sara/visual";
import { criarSistema, desenhar, novoPulso, type EstadoHolo, type Sistema } from "./motor";
import { iniciarVozAoVivo } from "./voz-ao-vivo";

/**
 * A SARA central em holograma (E7): a entrada da SARA na War Room. Visual criado pelo proprietário
 * (saraholo.zip, 23/10/2026): uma presença invocada, não um chat. Ela fala o essencial com legenda que
 * acende palavra por palavra e mostra a resposta completa (tabelas, fontes, aviso do verificador) no painel.
 * Ela apresenta como alguém da empresa apresentando à diretoria: começa em tela cheia e, quando precisa
 * mostrar algo — a tela de onde veio o número, ou os gráficos que as áreas montaram —, minimiza para o canto
 * inferior direito, mostra na tela principal e continua falando. Vive na plataforma inteira (montada no
 * app), para seguir viva quando abre a tela de outro módulo; a esfera para invocar só aparece na War Room.
 *
 * Na plataforma:
 *   - conversa com a SARA central (`/api/sara/warroom`), com a sessão de quem pergunta (as conversas ficam gravadas);
 *   - ouve pelo Whisper da Cloudflare (`/voz`, que não treina nem guarda), não pelo reconhecimento do navegador
 *     (que manda o áudio ao Google);
 *   - fala só com as vozes instaladas no aparelho (`localService`): voz online mandaria o texto da resposta,
 *     com os números da empresa, a um serviço externo. Sem voz local, a legenda acende sozinha.
 */

type Fonte = { rotulo: string; link: string };
type Resposta = { texto: string; fontes: Fonte[] };
type DocCriado = { id: string; numero: string; titulo: string; tipo: string; paginas: number };
type CartaoAcao = { id: string; resumo: string; detalhes: string[]; risco: string; situacao: string; feito?: string | null; erro?: string | null };
type Abrir = { modulo: string; secao: string | null; rotulo: string; registro?: PedidoRegistro };
type Modo = "fechado" | "cheio" | "mini";
const ROTULO: Record<EstadoHolo, string> = { idle: "PRONTA", listening: "OUVINDO", thinking: "CONSULTANDO AS ÁREAS", speaking: "FALANDO" };
const CHAVE_VOZ = "pecsil.sara-holo.voz";
const VOZES_FEMININAS = ["francisca", "maria", "luciana", "leticia", "camila", "vitoria", "fernanda", "female", "feminina"];

/** Voz do próprio aparelho, em português (feminina quando houver). Nunca uma voz online. */
function vozLocal(): SpeechSynthesisVoice | null {
  const todas = typeof window !== "undefined" ? window.speechSynthesis?.getVoices?.() ?? [] : [];
  const locais = todas.filter((v) => v.localService);
  const pt = locais.filter((v) => /pt[-_]BR/i.test(v.lang)).length ? locais.filter((v) => /pt[-_]BR/i.test(v.lang)) : locais.filter((v) => /^pt/i.test(v.lang));
  return pt.find((v) => VOZES_FEMININAS.some((h) => v.name.toLowerCase().includes(h))) ?? pt[0] ?? null;
}
const lerVozLigada = () => { try { return window.localStorage.getItem(CHAVE_VOZ) !== "0"; } catch { return true; } };
const guardarVozLigada = (v: boolean) => { try { window.localStorage.setItem(CHAVE_VOZ, v ? "1" : "0"); } catch { /* sem armazenamento: só não lembra */ } };

export function SaraHolograma({ naWarRoom, navegar }: { naWarRoom: boolean; navegar: (modulo: string, secao?: string) => void }) {
  const [modo, setModo] = useState<Modo>("fechado");
  const [estado, setEstadoTela] = useState<EstadoHolo>("idle");
  const [legenda, setLegenda] = useState("");
  const [aceso, setAceso] = useState(0);
  const [linhaPessoa, setLinhaPessoa] = useState("");
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [painel, setPainel] = useState(false);
  const [entrada, setEntrada] = useState("");
  const [vozLigada, setVozLigada] = useState(true);
  const [semVozLocal, setSemVozLocal] = useState(false);
  const [aviso, setAviso] = useState("");
  // Palco: os gráficos que ela apresenta na tela principal (um de cada vez, como slides).
  const [palco, setPalco] = useState<Visual[]>([]);
  // Documentos que a central montou nesta resposta e os envios esperando o Permitir.
  const [docs, setDocs] = useState<{ documentos: DocCriado[]; acoes: CartaoAcao[] } | null>(null);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  // Voz ao vivo (Grok, voz "luna"): conversa contínua; o microfone abre e fecha.
  const [aoVivo, setAoVivo] = useState(false);
  const vozAoVivo = useRef<{ parar: () => void } | null>(null);

  const canvas = useRef<HTMLCanvasElement | null>(null);
  const quadro = useRef<number | null>(null);
  const sistema = useRef<Sistema | null>(null);
  const pulso = useRef(novoPulso());
  const conversa = useRef<string | null>(null);
  const cumprimentou = useRef(false);
  const ocupado = useRef(false);
  const relogioPalavras = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cada fala tem um número: o relógio (ou a voz) de uma fala antiga não mexe no estado da nova.
  const falaAtual = useRef(0);
  const gravador = useRef<{ rec: MediaRecorder; partes: Blob[]; fluxo: MediaStream; enviar: boolean; limite: ReturnType<typeof setTimeout> } | null>(null);
  const arraste = useRef({ ligado: false, x: 0, y: 0, moveu: false });
  const palavras = legenda.split(" ").filter(Boolean);

  const setEstado = useCallback((e: EstadoHolo) => { pulso.current.estado = e; setEstadoTela(e); }, []);
  // Enquanto ela está ativa, o botão da SARA do módulo sai do canto (o canto é dela).
  useEffect(() => {
    document.documentElement.classList.toggle("sh-ativa", modo !== "fechado");
    return () => document.documentElement.classList.remove("sh-ativa");
  }, [modo]);
  useEffect(() => { const t = setTimeout(() => setVozLigada(lerVozLigada()), 0); return () => clearTimeout(t); }, []);

  /* ---- motor (canvas) ---- */
  const dimensionar = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = r.width * dpr; c.height = r.height * dpr;
    c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);
  useEffect(() => {
    if (modo === "fechado") return;
    if (!sistema.current) sistema.current = criarSistema(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 900 : 2200);
    dimensionar();
    const passo = () => {
      const c = canvas.current, ctx = c?.getContext("2d");
      if (c && ctx && sistema.current) { const r = c.getBoundingClientRect(); desenhar(ctx, r.width, r.height, sistema.current, pulso.current); }
      quadro.current = requestAnimationFrame(passo);
    };
    quadro.current = requestAnimationFrame(passo);
    const redimensionar = () => dimensionar();
    window.addEventListener("resize", redimensionar);
    const t = setTimeout(dimensionar, 850); // depois da transição entre cheio e mini
    return () => { if (quadro.current) cancelAnimationFrame(quadro.current); quadro.current = null; window.removeEventListener("resize", redimensionar); clearTimeout(t); };
  }, [modo, dimensionar]);

  /* ---- fala (legenda palavra por palavra; voz só do aparelho) ---- */
  const pararFala = useCallback(() => {
    falaAtual.current++;
    if (relogioPalavras.current) clearInterval(relogioPalavras.current);
    window.speechSynthesis?.cancel();
    if (pulso.current.estado === "speaking") setEstado("idle");
  }, [setEstado]);

  const falar = useCallback((texto: string) => {
    if (relogioPalavras.current) clearInterval(relogioPalavras.current);
    const esta = ++falaAtual.current;
    const terminou = () => { if (esta === falaAtual.current && pulso.current.estado === "speaking") setEstado("idle"); };
    setLegenda(texto); setAceso(0);
    const total = texto.split(" ").filter(Boolean).length;
    const voz = vozLigada ? vozLocal() : null;
    setSemVozLocal(vozLigada && !voz && typeof window !== "undefined" && "speechSynthesis" in window);
    if (!voz) {
      setEstado("speaking");
      let i = 0;
      const relogio = setInterval(() => {
        if (esta !== falaAtual.current) { clearInterval(relogio); return; }
        setAceso(++i); pulso.current.fala = 0.9;
        if (i >= total) { clearInterval(relogio); terminou(); }
      }, 150);
      relogioPalavras.current = relogio;
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.voice = voz; u.lang = voz.lang || "pt-BR"; u.rate = 1.04; u.pitch = 1.05;
    let i = 0;
    u.onstart = () => { if (esta === falaAtual.current) setEstado("speaking"); };
    u.onboundary = () => { if (esta !== falaAtual.current) return; setAceso(++i); pulso.current.fala = 1; };
    u.onend = () => { if (esta === falaAtual.current) setAceso(1e9); terminou(); };
    u.onerror = () => { if (esta === falaAtual.current) setAceso(1e9); terminou(); };
    window.speechSynthesis.speak(u);
  }, [vozLigada, setEstado]);

  /* ---- conversa com a SARA central ---- */
  // Apresentação: logo depois de começar a falar, minimiza e mostra a tela ou os gráficos.
  const apresentar = useCallback((abrir: Abrir | null, visuais: Visual[]) => {
    if (!abrir && !visuais.length) return;
    setTimeout(() => {
      setPainel(false); setModo("mini");
      if (visuais.length) { setPalco(visuais); setSlide(0); }
      if (abrir) {
        navegar(abrir.modulo, abrir.secao ?? undefined);
        const registro = abrir.registro;
        if (registro) setTimeout(() => pedirRegistro(registro), 400);
      }
    }, 1200);
  }, [navegar]);

  /** Pergunta à SARA central (Claude + áreas + verificador). Devolve o texto conferido ou o erro. */
  const consultar = useCallback(async (pergunta: string, voz: boolean): Promise<{ texto: string } | { erro: string }> => {
    try {
      const r = await fetch("/api/sara/warroom", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pergunta, conversa: conversa.current, voz }) });
      const j = await r.json().catch(() => null) as { conversa?: string; texto?: string; fontes?: Fonte[]; abrir?: Abrir | null; visuais?: Visual[]; documentos?: DocCriado[]; acoes?: CartaoAcao[]; error?: string } | null;
      if (!r.ok || !j?.texto) return { erro: j?.error ?? "Não consegui falar com as áreas agora. Tente de novo em instantes." };
      conversa.current = j.conversa ?? conversa.current;
      setResposta({ texto: j.texto, fontes: j.fontes ?? [] });
      const envios = (j.acoes ?? []).filter((a) => a.situacao === "pendente");
      if (j.documentos?.length || envios.length) setDocs({ documentos: j.documentos ?? [], acoes: envios });
      apresentar(j.abrir ?? null, j.visuais ?? []);
      return { texto: j.texto };
    } catch { return { erro: "Perdi a conexão com a plataforma por um instante. Tente de novo." }; }
  }, [apresentar]);

  const perguntar = useCallback(async (q: string, voz = false) => {
    const pergunta = q.trim();
    if (pergunta.length < 2 || ocupado.current) return;
    ocupado.current = true;
    pararFala(); setAviso(""); setEntrada("");
    setLinhaPessoa(`▸ ${pergunta}`); setLegenda(""); setAceso(0);
    setEstado("thinking");
    try {
      const r = await consultar(pergunta, voz);
      if ("erro" in r) { setEstado("idle"); falar(r.erro); return; }
      falar(resumoFalado(r.texto));
    } finally { ocupado.current = false; }
  }, [consultar, falar, pararFala, setEstado]);

  /* ---- voz ao vivo (Grok Voice, "luna", pt-BR) ---- */
  const legendaAoVivo = useRef<ReturnType<typeof setInterval> | null>(null);
  const acenderAosPoucos = useCallback((texto: string) => {
    if (legendaAoVivo.current) clearInterval(legendaAoVivo.current);
    setLegenda(texto); setAceso(0);
    let i = 0; const total = texto.split(" ").filter(Boolean).length;
    legendaAoVivo.current = setInterval(() => { setAceso(++i); if (i >= total && legendaAoVivo.current) clearInterval(legendaAoVivo.current); }, 380);
  }, []);
  const executarDaVoz = useCallback(async (nome: string, args: Record<string, unknown>) => {
    if (nome === "consultar_sara_central") {
      const pergunta = String(args.pergunta ?? "").trim();
      if (pergunta) setLinhaPessoa(`▸ ${pergunta}`);
      const r = await consultar(pergunta || "Resumo da empresa hoje.", true);
      if ("erro" in r) return { saida: { erro: r.erro }, falar: r.erro };
      const fala = resumoFalado(r.texto);
      return { saida: { ok: true, resposta_conferida: fala, observacao: "A plataforma já vai falar esta resposta, exatamente como está. Não repita os números." }, falar: fala };
    }
    if (nome === "minimizar") { setPainel(false); setModo("mini"); return { saida: { ok: true } }; }
    if (nome === "tela_cheia") { setModo("cheio"); return { saida: { ok: true } }; }
    if (nome === "proximo_visual") { setSlide((n) => n + 1); return { saida: { ok: true } }; }
    if (nome === "visual_anterior") { setSlide((n) => Math.max(0, n - 1)); return { saida: { ok: true } }; }
    if (nome === "fechar_apresentacao") { setPalco([]); return { saida: { ok: true } }; }
    return { saida: { erro: `Função desconhecida: ${nome}` } };
  }, [consultar]);
  const pararAoVivo = useCallback(() => { vozAoVivo.current?.parar(); vozAoVivo.current = null; setAoVivo(false); }, []);

  const invocar = useCallback(async () => {
    setModo("cheio");
    if (cumprimentou.current) return;
    cumprimentou.current = true;
    const r = await fetch("/api/sara/warroom", { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => null) as { saudacao?: string; pessoa?: string; conversa?: { id: string } | null; error?: string } | null;
    if (!r?.ok) { falar(j?.error === "FORBIDDEN" ? "A SARA central não está liberada para você." : "A SARA central está indisponível agora."); return; }
    conversa.current = j?.conversa?.id ?? null;
    setTimeout(() => falar(`${j?.saudacao ?? "Olá"}${j?.pessoa ? `, ${j.pessoa}` : ""}. Sou a SARA central: pergunto às áreas da empresa e confiro cada número. O que você quer saber?`), 600);
  }, [falar]);

  // De fora (War Room › Conselho): invocar, ou invocar já perguntando.
  const perguntarRef = useRef(perguntar);
  const invocarRef = useRef(invocar);
  useEffect(() => { perguntarRef.current = perguntar; invocarRef.current = invocar; });
  useEffect(() => {
    const aoPerguntar = (ev: Event) => {
      const q = String((ev as CustomEvent<{ pergunta?: string }>).detail?.pergunta ?? "").trim();
      cumprimentou.current = true; setModo("cheio");
      if (q) void perguntarRef.current(q);
    };
    const aoInvocar = () => void invocarRef.current();
    window.addEventListener("pecsil:sara-perguntar", aoPerguntar);
    window.addEventListener("pecsil:sara-invocar", aoInvocar);
    return () => { window.removeEventListener("pecsil:sara-perguntar", aoPerguntar); window.removeEventListener("pecsil:sara-invocar", aoInvocar); };
  }, []);

  /* ---- microfone (Whisper na Cloudflare) ---- */
  const pararGravacao = useCallback((enviar: boolean) => {
    const g = gravador.current;
    if (!g) return;
    g.enviar = enviar; clearTimeout(g.limite);
    if (g.rec.state !== "inactive") g.rec.stop(); else g.fluxo.getTracks().forEach((t) => t.stop());
  }, []);
  const microfone = useCallback(async () => {
    if (vozAoVivo.current) { pararAoVivo(); return; }
    if (gravador.current) { pararGravacao(true); return; }
    // Primeiro, a conversa ao vivo (Grok, voz "luna"). Sem ela configurada, grava e transcreve (Whisper).
    setAviso(""); pararFala(); setEstado("thinking");
    try {
      vozAoVivo.current = await iniciarVozAoVivo("warroom", {
        estado: setEstado, nivel: (n) => { pulso.current.fala = Math.max(pulso.current.fala, n); },
        pessoaDisse: (t) => setLinhaPessoa(`▸ ${t}`), saraDisse: acenderAosPoucos,
        executar: executarDaVoz, erro: (m) => setAviso(m), fim: () => { vozAoVivo.current = null; setAoVivo(false); setEstado("idle"); },
      });
      setAoVivo(true);
      return;
    } catch (e) {
      setEstado("idle");
      const m = e instanceof Error ? e.message : "";
      if (!/não está configurada/.test(m)) { setAviso(m || "A voz ao vivo está indisponível agora."); return; }
    }
    setAviso("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setAviso("Este aparelho não grava áudio no navegador. Digite a pergunta."); return; }
    let fluxo: MediaStream;
    try { fluxo = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setAviso("Libere o microfone para a plataforma nas permissões do navegador."); return; }
    pararFala();
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const rec = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
    const g = { rec, partes: [] as Blob[], fluxo, enviar: false, limite: setTimeout(() => pararGravacao(true), 60_000) };
    gravador.current = g;
    rec.ondataavailable = (e) => { if (e.data.size) g.partes.push(e.data); };
    rec.onstop = async () => {
      fluxo.getTracks().forEach((t) => t.stop());
      gravador.current = null;
      if (!g.enviar) { setEstado("idle"); return; }
      const audio = new Blob(g.partes, { type: (rec.mimeType || tipo || "audio/webm").split(";")[0] });
      setEstado("thinking");
      const r = await fetch("/api/sara/warroom/voz", { method: "POST", headers: { "content-type": audio.type }, body: audio })
        .then(async (x) => ({ ok: x.ok, body: await x.json().catch(() => null) as { texto?: string; error?: string } | null })).catch(() => ({ ok: false, body: null }));
      if (!r.ok || !r.body?.texto) { setEstado("idle"); setAviso(r.body?.error ?? "Não entendi o áudio. Tente de novo."); return; }
      void perguntar(r.body.texto, true);
    };
    rec.start(500);
    setEstado("listening");
  }, [pararGravacao, pararFala, perguntar, setEstado, pararAoVivo, acenderAosPoucos, executarDaVoz]);
  useEffect(() => () => { pararGravacao(false); vozAoVivo.current?.parar(); }, [pararGravacao]);

  /* ---- arrastar para girar ---- */
  const aoApertar = (e: React.PointerEvent) => { arraste.current = { ligado: true, x: e.clientX, y: e.clientY, moveu: false }; };
  const aoMover = (e: React.PointerEvent) => {
    const d = arraste.current;
    if (!d.ligado) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moveu = true;
    pulso.current.rot.dragY = dx * 0.006; pulso.current.rot.dragX = -dy * 0.006;
    d.x = e.clientX; d.y = e.clientY;
  };
  const aoSoltar = () => { arraste.current.ligado = false; };

  const fechar = () => { pararFala(); pararGravacao(false); pararAoVivo(); setPainel(false); setPalco([]); setDocs(null); setModo("fechado"); };
  // Permitir (ou não) o envio de um documento: a mesma rota das ações da SARA, com a sessão de quem pediu.
  const decidir = async (a: CartaoAcao, permitir: boolean) => {
    setDecidindo(a.id);
    const r = await fetch(`/api/sara/warroom/acoes/${a.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ permitir }) }).catch(() => null);
    const j = await r?.json().catch(() => null) as { situacao?: string; texto?: string; error?: string } | null;
    setDecidindo(null);
    setDocs((d) => d && { ...d, acoes: d.acoes.map((x) => (x.id === a.id ? { ...x, situacao: j?.situacao ?? "falhou", feito: j?.texto ?? j?.error ?? "Não foi possível agora." } : x)) });
  };
  const alternarVoz = () => { const v = !vozLigada; setVozLigada(v); guardarVozLigada(v); if (!v) window.speechSynthesis?.cancel(); };

  // Fora da War Room, ela só aparece quando já está trabalhando (apresentando uma tela de outro módulo).
  if (!naWarRoom && modo === "fechado") return null;
  const visual = palco[Math.min(slide, palco.length - 1)];
  return (
    <>
      {palco.length > 0 && visual && (
        <section className="sh-palco" aria-label="Apresentação da SARA">
          <header>
            <b>Apresentação da SARA</b>
            {palco.length > 1 && <span>{slide + 1} de {palco.length}</span>}
            <span className="sh-palco-acoes">
              {palco.length > 1 && <button type="button" onClick={() => setSlide((n) => Math.max(0, n - 1))} disabled={slide === 0} aria-label="Anterior">‹</button>}
              {palco.length > 1 && <button type="button" onClick={() => setSlide((n) => Math.min(palco.length - 1, n + 1))} disabled={slide >= palco.length - 1} aria-label="Próximo">›</button>}
              <button type="button" onClick={() => setPalco([])} aria-label="Fechar a apresentação">✕</button>
            </span>
          </header>
          <div className="sh-palco-corpo"><SaraVisual v={visual} /></div>
        </section>
      )}
      {docs && (docs.documentos.length > 0 || docs.acoes.length > 0) && (
        <section className="sh-doc" aria-label="Documento da SARA central">
          <header><b>Documento</b><button type="button" onClick={() => setDocs(null)} aria-label="Fechar">✕</button></header>
          {docs.documentos.map((d) => (
            <div key={d.id} className="sh-doc-item">
              <span className="sh-doc-icone" aria-hidden>PDF</span>
              <div><b>{d.titulo}</b><small>{d.tipo === "carta" ? "Carta" : "Relatório"} {d.numero} · {d.paginas} {d.paginas === 1 ? "página" : "páginas"}</small></div>
              <a href={`/api/sara/documentos/${d.id}/pdf`} target="_blank" rel="noopener noreferrer">Abrir o PDF</a>
            </div>
          ))}
          {docs.acoes.map((a) => (
            <div key={a.id} className={`sh-doc-envio${a.risco === "alto" ? " alto" : ""}`}>
              <p>{a.resumo}</p>
              {a.detalhes.length > 0 && <ul>{a.detalhes.map((x, k) => <li key={k}>{x}</li>)}</ul>}
              {a.situacao === "pendente" ? (
                <div className="sh-doc-botoes">
                  <button type="button" className="permitir" disabled={decidindo === a.id} onClick={() => void decidir(a, true)}>{decidindo === a.id ? "Enviando…" : "Permitir o envio"}</button>
                  <button type="button" disabled={decidindo === a.id} onClick={() => void decidir(a, false)}>Não enviar</button>
                </div>
              ) : <p className={`sh-doc-feito ${a.situacao}`} role="status">{a.feito}</p>}
            </div>
          ))}
        </section>
      )}
      {naWarRoom && <button type="button" className={`sh-summon${modo !== "fechado" ? " hidden" : ""}`} onClick={() => void invocar()} aria-label="Invocar a SARA central" title="Invocar a SARA central">
        <span className="halo" /><span className="halo h2" /><span className="spark" /><span className="lbl">SARA</span>
      </button>}

      <div className={`sh-holo${modo !== "fechado" ? " on" : ""}${modo === "cheio" ? " full" : ""}${modo === "mini" ? " mini" : ""}${painel && resposta ? " com-painel" : ""}`} aria-hidden={modo === "fechado"}>
        <div className="sh-dim" />
        <div className="sh-stage" onClick={() => { if (modo === "mini" && !arraste.current.moveu) setModo("cheio"); }}
          onPointerDown={aoApertar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerLeave={aoSoltar}>
          <canvas ref={canvas} className="sh-canvas" />
          <div className="sh-name"><div className="n">S A R A</div><div className="r">CEO · SISTEMA ATIVO</div></div>
        </div>

        <div className="sh-topo">
          <button type="button" className="sh-btn" onClick={alternarVoz} aria-pressed={vozLigada} title={vozLigada ? "Silenciar a voz" : "Ligar a voz"} aria-label={vozLigada ? "Silenciar a voz" : "Ligar a voz"}>{vozLigada ? "🔊" : "🔇"}</button>
          <button type="button" className="sh-btn" onClick={() => setModo("mini")} title="Minimizar (ela continua falando)" aria-label="Minimizar">▁</button>
          <button type="button" className="sh-btn" onClick={fechar} aria-label="Fechar a SARA central" title="Fechar">✕</button>
        </div>
        <div className="sh-status"><i /><span>{ROTULO[estado]}</span>{aoVivo ? <em className="ao-vivo"> · AO VIVO</em> : semVozLocal && <em> · sem voz no aparelho (só legenda)</em>}</div>

        <div className="sh-caption" aria-live="polite">
          {linhaPessoa && <div className="uline show">{linhaPessoa}</div>}
          <div className="who" style={{ opacity: legenda ? 1 : 0 }}>S A R A</div>
          <div className="line">{palavras.map((p, i) => <span key={i} className={`w${i < aceso ? " lit" : ""}`}>{p} </span>)}</div>
          {resposta && !painel && estado !== "thinking" && <button type="button" className="sh-ver" onClick={() => setPainel(true)}>Ver a resposta completa</button>}
        </div>

        {painel && resposta && (
          <aside className="sh-painel" aria-label="Resposta completa da SARA central">
            <header><b>Resposta completa</b><button type="button" className="sh-btn" onClick={() => setPainel(false)} aria-label="Fechar o painel">✕</button></header>
            <div className="sh-painel-texto"><Texto texto={resposta.texto} /></div>
            {resposta.fontes.length > 0 && <footer><small>De onde veio:</small>{resposta.fontes.slice(0, 12).map((f) => <span key={f.link + f.rotulo}>{f.rotulo}</span>)}</footer>}
          </aside>
        )}

        <form className="sh-console" onSubmit={(e) => { e.preventDefault(); void perguntar(entrada); }}>
          <button type="button" className={`hbtn${aoVivo || estado === "listening" ? " rec" : ""}`} onClick={() => void microfone()} aria-pressed={aoVivo}
            aria-label={aoVivo ? "Encerrar a conversa por voz" : estado === "listening" ? "Parar e enviar o áudio" : "Conversar por voz com a SARA"} title={aoVivo ? "Encerrar a conversa por voz" : "Conversar por voz"}>🎙</button>
          <div className="cline">
            <span className="caret">▸</span>
            <input value={entrada} placeholder="fale ou digite uma pergunta sobre a empresa…" maxLength={2000} onChange={(e) => setEntrada(e.target.value)} aria-label="Pergunta para a SARA central" />
          </div>
          <button type="submit" className="hbtn" aria-label="Enviar" disabled={entrada.trim().length < 2}>➤</button>
        </form>
        {aviso && <p className="sh-aviso" role="alert">{aviso}</p>}
      </div>
    </>
  );
}
