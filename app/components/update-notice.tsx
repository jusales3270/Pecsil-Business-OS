"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Aviso "Nova versão disponível".
 *
 * Um app aberto (aba, atalho instalado no computador ou app no celular) segue
 * rodando a versão com que foi carregado — no celular o sistema quase nunca o
 * fecha de verdade. Aqui o app pergunta ao servidor qual versão está no ar ao
 * abrir, ao voltar para a tela e a cada poucos minutos; se mudou, mostra o
 * aviso. Não recarrega sozinho: quem está no meio de um registro termina e
 * atualiza quando quiser.
 */

const VERSAO_CARREGADA = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const INTERVALO_MS = 5 * 60_000;
const REAVISAR_MS = 30 * 60_000;

export function UpdateNotice() {
  const [disponivel, setDisponivel] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const adiadoAte = useRef(0);

  const verificar = useCallback(async () => {
    if (!VERSAO_CARREGADA || document.visibilityState === "hidden") return;
    try {
      const resposta = await fetch("/api/version", { cache: "no-store" });
      if (!resposta.ok) return;
      const { version } = (await resposta.json()) as { version: string | null };
      if (version && version !== VERSAO_CARREGADA && Date.now() >= adiadoAte.current) {
        setDisponivel(true);
        // Já baixa o service worker novo, para a atualização ser imediata.
        navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
      }
    } catch {
      // Sem conexão: tenta de novo na próxima vez.
    }
  }, []);

  useEffect(() => {
    const inicial = window.setTimeout(verificar, 3000);
    const intervalo = window.setInterval(verificar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === "visible") verificar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", verificar);
    window.addEventListener("online", verificar);
    return () => {
      window.clearTimeout(inicial);
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", verificar);
      window.removeEventListener("online", verificar);
    };
  }, [verificar]);

  const atualizar = async () => {
    setAtualizando(true);
    try {
      const registro = await navigator.serviceWorker?.getRegistration();
      await registro?.update();
      registro?.waiting?.postMessage({ type: "SKIP_WAITING" });
    } catch {
      // Segue para o recarregamento mesmo assim.
    }
    window.location.reload();
  };

  const depois = () => {
    adiadoAte.current = Date.now() + REAVISAR_MS;
    setDisponivel(false);
  };

  if (!disponivel) return null;

  return (
    <div className="update-notice" role="status" aria-live="polite">
      <span className="update-notice-dot" aria-hidden />
      <div>
        <b>Nova versão disponível</b>
        <small>Atualize para usar as últimas melhorias.</small>
      </div>
      <button type="button" className="update-notice-later" onClick={depois} disabled={atualizando}>Depois</button>
      <button type="button" className="ds-button primary compact" onClick={atualizar} disabled={atualizando}>
        {atualizando ? "Atualizando…" : "Atualizar"}
      </button>
    </div>
  );
}
