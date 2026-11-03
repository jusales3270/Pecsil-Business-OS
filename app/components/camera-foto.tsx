"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tirar foto pela câmera, dentro da própria página (03/11/2026). O campo de arquivo com `capture` só abre a câmera
 * no celular: no computador, o navegador ignora e abre a janela de arquivos. Aqui a câmera abre nos dois (webcam
 * no computador, a traseira no celular), com a prévia ao vivo e o botão Capturar. Sem câmera ou sem permissão,
 * diz o motivo e oferece escolher a foto.
 */
export function CameraFoto({ onFoto, onFechar, onEscolher, sobreposta = false }: {
  onFoto: (arquivo: File) => void;
  onFechar: () => void;
  /** Sem câmera: abre a escolha de arquivo no lugar. */
  onEscolher?: () => void;
  /** Por cima do conteúdo (painel da SARA) em vez de dentro do fluxo (janela de registro). */
  sobreposta?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [frente, setFrente] = useState(false);
  const [cameras, setCameras] = useState(0);
  const [pronta, setPronta] = useState(false);
  const [erro, setErro] = useState(() => (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia ? "Este navegador não abre a câmera pela página." : ""));
  const fluxo = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    let parado = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: frente ? "user" : "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(async (f) => {
        if (parado) { f.getTracks().forEach((t) => t.stop()); return; }
        fluxo.current = f;
        if (video.current) { video.current.srcObject = f; await video.current.play().catch(() => { /* reabriu: o próximo quadro segue */ }); }
        setPronta(true); setErro("");
        const lista = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCameras(lista.filter((d) => d.kind === "videoinput").length);
      })
      .catch((e: unknown) => {
        const nome = e instanceof DOMException ? e.name : "";
        setErro(nome === "NotAllowedError" ? "A câmera está bloqueada para a plataforma. Libere a câmera nas permissões do navegador."
          : nome === "NotFoundError" ? "Nenhuma câmera encontrada neste aparelho." : "Não foi possível abrir a câmera agora.");
      });
    return () => { parado = true; setPronta(false); fluxo.current?.getTracks().forEach((t) => t.stop()); fluxo.current = null; };
  }, [frente]);

  const capturar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const tela = document.createElement("canvas");
    tela.width = v.videoWidth; tela.height = v.videoHeight;
    tela.getContext("2d")?.drawImage(v, 0, 0, tela.width, tela.height);
    tela.toBlob((b) => {
      if (!b) { setErro("Não foi possível capturar. Tente de novo."); return; }
      fluxo.current?.getTracks().forEach((t) => t.stop());
      onFoto(new File([b], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  };

  return (
    <div className={`camera-foto${sobreposta ? " sobreposta" : ""}`} role="dialog" aria-label="Tirar foto">
      {erro ? (
        <div className="camera-foto-erro">
          <p role="alert">{erro}</p>
          {onEscolher && <button type="button" className="camera-foto-botao" onClick={onEscolher}>Escolher foto</button>}
        </div>
      ) : (
        <div className="camera-foto-quadro">
          <video ref={video} muted playsInline autoPlay aria-label="Câmera ao vivo" />
          {!pronta && <span className="camera-foto-abrindo">Abrindo a câmera…</span>}
        </div>
      )}
      <div className="camera-foto-barra">
        <button type="button" className="camera-foto-botao" onClick={onFechar}>Cancelar</button>
        {!erro && <button type="button" className="camera-foto-disparo" onClick={capturar} disabled={!pronta} aria-label="Capturar a foto" title="Capturar" />}
        {!erro && cameras > 1 ? <button type="button" className="camera-foto-botao" onClick={() => setFrente((x) => !x)}>Virar câmera</button> : <span className="camera-foto-vazio" />}
      </div>
    </div>
  );
}
