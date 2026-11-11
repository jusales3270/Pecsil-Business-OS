"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Callout, Modal } from "../../packages/design-system";
import { CHAVE_REUNIAO, faltaPouco, juntarTrechos, motivoParaParar, relogio, REUNIAO, type Trecho } from "../../lib/tarefas/reuniao";

/**
 * Gravar reunião (I-29): o navegador grava em pedaços de ~50 s e cada pedaço vira texto (Whisper na Cloudflare);
 * o áudio é descartado. Um pedaço que falha é tentado de novo e, se não der, vira uma marca com o horário. No fim,
 * o texto vai para "Montar quadro" (a SARA lista os combinados; a pessoa confere antes de virar tarefa).
 * Até 60 minutos. O texto fica na aba (sessionStorage) até virar quadro, para não se perder num fechar sem querer.
 */

type Fase = "antes" | "gravando" | "pausada" | "terminando";
type Gravador = {
  fluxo: MediaStream; tipo: string; rec: MediaRecorder | null; atual: Trecho | null; i: number;
  desde: number; acumulado: number; timer: ReturnType<typeof setTimeout> | null; fechando: Promise<void> | null;
  envios: Promise<void>[]; trava: WakeLockSentinel | null; escondidaDesde: number | null; fim: boolean; descartar: boolean;
};

export function guardarReuniao(texto: string) {
  try { if (texto) sessionStorage.setItem(CHAVE_REUNIAO, JSON.stringify({ texto, em: Date.now() })); else sessionStorage.removeItem(CHAVE_REUNIAO); } catch { /* sem armazenamento: segue */ }
}
export function reuniaoGuardada(): { texto: string; em: number } | null {
  try { const j = JSON.parse(sessionStorage.getItem(CHAVE_REUNIAO) ?? "null"); return j && typeof j.texto === "string" && j.texto.trim() ? j : null; } catch { return null; }
}

export function GravarReuniao({ onClose, onTexto }: { onClose: () => void; onTexto: (texto: string) => void }) {
  const [fase, setFase] = useState<Fase>("antes");
  const [trechos, setTrechos] = useState<Trecho[]>([]);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmarSair, setConfirmarSair] = useState(false);
  const g = useRef<Gravador | null>(null);
  const lista = useRef<Trecho[]>([]);
  const caixa = useRef<HTMLDivElement>(null);
  const texto = juntarTrechos(trechos);

  const mudar = useCallback((i: number, campos: Partial<Trecho>) => {
    lista.current = lista.current.map((t) => (t.i === i ? { ...t, ...campos } : t));
    setTrechos(lista.current);
    guardarReuniao(juntarTrechos(lista.current));
  }, []);

  const enviar = useCallback(async (t: Trecho, audio: Blob) => {
    for (let k = 0; k < REUNIAO.tentativas; k++) {
      if (k) await new Promise((r) => setTimeout(r, k * 2500));
      const r = await fetch("/api/tarefas/transcrever", { method: "POST", headers: { "content-type": audio.type, "x-trecho": String(t.i) }, body: audio })
        .then(async (x) => ({ status: x.status, j: (await x.json().catch(() => null)) as { texto?: string } | null })).catch(() => ({ status: 0, j: null }));
      if (r.status === 200) { mudar(t.i, r.j?.texto ? { situacao: "ok", texto: r.j.texto } : { situacao: "silencio" }); return; }
      if (r.status === 400 || r.status === 401 || r.status === 403) break; // áudio recusado ou sessão: tentar de novo não resolve
    }
    mudar(t.i, { situacao: "falhou" });
  }, [mudar]);

  const decorrido = () => { const x = g.current; return x ? x.acumulado + (x.rec ? (Date.now() - x.desde) / 1000 : 0) : 0; };

  /** Fecha o pedaço que está gravando; o arquivo dele vai para a transcrição. */
  const fecharPedaco = useCallback((): Promise<void> => {
    const x = g.current;
    if (!x?.rec || !x.atual) return x?.fechando ?? Promise.resolve();
    if (x.timer) clearTimeout(x.timer);
    x.timer = null;
    x.acumulado += (Date.now() - x.desde) / 1000;
    x.atual.fim = x.acumulado;
    const rec = x.rec;
    x.rec = null; x.atual = null;
    const fechando = x.fechando;
    rec.stop();
    return fechando ?? Promise.resolve();
  }, []);

  // O pedaço seguinte começa assim que o anterior fecha (o temporizador chama pela referência).
  const proximo = useRef<() => void>(() => {});
  const novoPedaco = useCallback(() => {
    const x = g.current;
    if (!x || x.fim) return;
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(x.fluxo, { ...(x.tipo ? { mimeType: x.tipo } : {}), audioBitsPerSecond: 32_000 }); }
    catch { rec = new MediaRecorder(x.fluxo); }
    const partes: Blob[] = [];
    const t: Trecho = { i: x.i++, inicio: x.acumulado, fim: x.acumulado, situacao: "enviando" };
    let pronto: () => void = () => {};
    x.fechando = new Promise<void>((r) => { pronto = r; });
    rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
    rec.onstop = () => {
      const audio = new Blob(partes, { type: (rec.mimeType || x.tipo || "audio/webm").split(";")[0] });
      // Pedaço de menos de 1 s (parou logo depois de virar) não tem fala: não vai.
      if (!x.descartar && audio.size >= 1000 && t.fim - t.inicio >= 1) {
        lista.current = [...lista.current, { ...t }];
        setTrechos(lista.current);
        x.envios.push(enviar(t, audio));
      }
      pronto();
    };
    x.rec = rec; x.atual = t; x.desde = Date.now();
    rec.start();
    x.timer = setTimeout(() => { void fecharPedaco(); proximo.current(); }, REUNIAO.pedacoSegundos * 1000);
  }, [enviar, fecharPedaco]);
  useEffect(() => { proximo.current = novoPedaco; }, [novoPedaco]);

  const travarTela = useCallback(async () => {
    const x = g.current;
    if (!x || x.fim) return;
    try { x.trava = (await navigator.wakeLock?.request("screen")) ?? null; } catch { /* sem trava de tela: segue gravando */ }
  }, []);

  const desligar = useCallback(() => {
    const x = g.current;
    if (!x) return;
    x.fim = true;
    if (x.timer) clearTimeout(x.timer);
    x.fluxo.getTracks().forEach((t) => t.stop());
    void x.trava?.release().catch(() => null);
  }, []);

  const parar = useCallback(async (motivo?: "tempo" | "texto" | "microfone") => {
    const x = g.current;
    if (!x || x.fim) return;
    setFase("terminando");
    if (motivo === "tempo") setAviso(`Chegou a ${REUNIAO.maxSegundos / 60} minutos: a gravação parou sozinha.`);
    else if (motivo === "texto") setAviso("O texto chegou ao tamanho máximo do quadro: a gravação parou sozinha.");
    else if (motivo === "microfone") setAviso("O microfone foi desligado: a gravação parou.");
    await fecharPedaco();
    x.fim = true;
    await Promise.all(x.envios);
    desligar();
    const final = juntarTrechos(lista.current);
    if (final.replace(/\[trecho não transcrito[^\]]*\]/g, "").trim().length < 20) {
      setFase("antes"); g.current = null;
      setErro(final ? "Nenhum trecho virou texto (o serviço de transcrição falhou). Tente gravar de novo." : "Não deu para ouvir nada que virasse texto. Confira o microfone e tente de novo.");
      return;
    }
    guardarReuniao(final);
    onTexto(final);
  }, [desligar, fecharPedaco, onTexto]);

  const comecar = async () => {
    setErro(""); setAviso("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setErro("Este aparelho não grava áudio no navegador."); return; }
    let fluxo: MediaStream;
    try { fluxo = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErro("Não foi possível usar o microfone. Libere o microfone para a plataforma nas permissões do navegador."); return; }
    const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    lista.current = []; setTrechos([]); setSegundos(0);
    g.current = { fluxo, tipo, rec: null, atual: null, i: 0, desde: Date.now(), acumulado: 0, timer: null, fechando: null, envios: [], trava: null, escondidaDesde: null, fim: false, descartar: false };
    fluxo.getAudioTracks()[0]?.addEventListener("ended", () => void parar("microfone"));
    novoPedaco();
    setFase("gravando");
    void travarTela();
  };

  const pausar = async () => { setFase("pausada"); await fecharPedaco(); setSegundos(decorrido()); };
  const continuar = () => { novoPedaco(); setFase("gravando"); };
  const descartar = () => {
    const x = g.current;
    if (x) { x.descartar = true; x.rec?.stop(); desligar(); }
    guardarReuniao("");
    onClose();
  };
  const pedirFechar = () => { if (fase === "antes") onClose(); else setConfirmarSair(true); };

  // Relógio, aviso do limite e parada automática.
  useEffect(() => {
    if (fase !== "gravando") return;
    const t = setInterval(() => {
      const s = decorrido();
      setSegundos(s);
      const motivo = motivoParaParar(s, juntarTrechos(lista.current).length);
      if (motivo) void parar(motivo);
    }, 500);
    return () => clearInterval(t);
  }, [fase, parar]);

  // A tela não apaga sozinha; se a plataforma ficou em segundo plano, a pessoa fica sabendo.
  useEffect(() => {
    const ver = () => {
      const x = g.current;
      if (!x || x.fim) return;
      if (document.visibilityState === "hidden") { x.escondidaDesde = Date.now(); return; }
      if (x.escondidaDesde && Date.now() - x.escondidaDesde > 3000)
        setAviso(`A plataforma ficou em segundo plano por ${Math.round((Date.now() - x.escondidaDesde) / 1000)} s. No celular, o que foi falado nesse tempo pode não ter sido gravado: deixe esta tela aberta.`);
      x.escondidaDesde = null;
      void travarTela();
    };
    document.addEventListener("visibilitychange", ver);
    return () => document.removeEventListener("visibilitychange", ver);
  }, [travarTela]);

  // Recarregar ou fechar a aba gravando: o navegador pergunta antes.
  useEffect(() => {
    if (fase === "antes") return;
    const segurar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", segurar);
    return () => window.removeEventListener("beforeunload", segurar);
  }, [fase]);

  // Saiu da tela (fechou a janela ou trocou de área): desliga o microfone.
  useEffect(() => () => { const x = g.current; if (x && !x.fim) { x.descartar = true; x.rec?.stop(); x.fim = true; x.fluxo.getTracks().forEach((t) => t.stop()); void x.trava?.release().catch(() => null); } }, []);

  useEffect(() => { if (caixa.current) caixa.current.scrollTop = caixa.current.scrollHeight; }, [texto]);

  const n = (s: Trecho["situacao"]) => trechos.filter((t) => t.situacao === s).length;
  const limite = faltaPouco(segundos);
  return (
    <Modal eyebrow="Tarefas" title="Gravar reunião" subtitle={fase === "antes" ? "A reunião vira texto e a SARA monta o quadro de combinados. Você confere antes de virar tarefa." : undefined} onClose={pedirFechar}>
      <div className="reuniao">
        {fase === "antes" ? (
          <>
            <Callout variant="warning" title="Avise os presentes que a reunião está sendo transcrita">
              O áudio não é guardado: cada trecho vira texto e é descartado. Não grave assunto sensível de RH (salário, saúde, documentos de colaborador).
            </Callout>
            <ul className="reuniao-dicas">
              <li>Até {REUNIAO.maxSegundos / 60} minutos. Perto do limite aparece um aviso; no limite, a gravação para sozinha.</li>
              <li>Deixe a plataforma aberta nesta tela (no celular, sem trocar de aplicativo) e o aparelho perto de quem fala.</li>
              <li>Diga quem fica com cada coisa e até quando (&quot;o Rafa revisa o roteiro até sexta&quot;): é assim que a SARA acha o responsável e o prazo.</li>
            </ul>
            {erro && <p className="almox-erro" role="alert">{erro}</p>}
            <footer><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="button" onClick={() => void comecar()}>Começar a gravar</Button></footer>
          </>
        ) : (
          <>
            <div className="reuniao-topo">
              <span className={`reuniao-estado ${fase}`}><i className="reuniao-ponto" aria-hidden="true" />{fase === "gravando" ? "Gravando" : fase === "pausada" ? "Pausada" : "Terminando"}</span>
              <b className="reuniao-relogio" aria-label={`Tempo de gravação ${relogio(segundos)}`}>{relogio(segundos)}<small> / {relogio(REUNIAO.maxSegundos)}</small></b>
            </div>
            <span className="reuniao-barra" aria-hidden="true"><i className="reuniao-progresso" style={{ width: `${Math.min(100, (segundos / REUNIAO.maxSegundos) * 100)}%` }} /></span>
            {limite && <Callout variant="warning" title="Perto do limite">{limite}</Callout>}
            {aviso && <Callout variant="info" title="Atenção">{aviso}</Callout>}
            <div className="reuniao-texto" ref={caixa} aria-live="polite" aria-label="Texto da reunião até agora">
              {texto ? texto.split("\n").map((l, k) => (l.startsWith("[trecho não transcrito") ? <p key={k} className="reuniao-falha">{l}</p> : <p key={k}>{l}</p>)) : <p className="reuniao-vazio">O texto aparece aqui a cada {REUNIAO.pedacoSegundos} segundos de fala.</p>}
              {n("enviando") > 0 && <p className="reuniao-vazio">Transcrevendo…</p>}
            </div>
            <small className="reuniao-contagem">{[`${n("ok")} ${n("ok") === 1 ? "trecho transcrito" : "trechos transcritos"}`, n("enviando") ? `${n("enviando")} transcrevendo` : "", n("falhou") ? `${n("falhou")} sem transcrição` : ""].filter(Boolean).join(" · ")}</small>
            {confirmarSair ? (
              <div className="reuniao-sair" role="alertdialog" aria-label="Descartar a gravação?">
                <p><b>Descartar a gravação?</b> O texto até aqui se perde.</p>
                <footer><Button type="button" variant="ghost" onClick={() => setConfirmarSair(false)}>Continuar gravando</Button><Button type="button" variant="secondary" onClick={descartar}>Descartar</Button></footer>
              </div>
            ) : (
              <footer>
                <Button type="button" variant="ghost" disabled={fase === "terminando"} onClick={() => setConfirmarSair(true)}>Descartar</Button>
                {fase === "gravando" && <Button type="button" variant="secondary" onClick={() => void pausar()}>Pausar</Button>}
                {fase === "pausada" && <Button type="button" variant="secondary" onClick={continuar}>Continuar</Button>}
                <Button type="button" disabled={fase === "terminando"} onClick={() => void parar()}>{fase === "terminando" ? "Terminando a transcrição…" : "Parar e montar o quadro"}</Button>
              </footer>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
