"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { UpdateNotice } from "./update-notice";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Plataformas sem prompt nativo: a instalação é manual, com guia na tela. */
type GuidePlatform = "ios" | "mac-safari";

interface PwaContextType {
  isInstallable: boolean;
  isInstalled: boolean;
  isIos: boolean;
  isMacSafari: boolean;
  /** true quando há algum caminho de instalação a oferecer (prompt nativo ou guia). */
  canInstall: boolean;
  promptInstall: () => Promise<void>;
  showIosGuide: boolean;
  setShowIosGuide: (show: boolean) => void;
}

const PwaContext = createContext<PwaContextType>({
  isInstallable: false,
  isInstalled: false,
  isIos: false,
  isMacSafari: false,
  canInstall: false,
  promptInstall: async () => {},
  showIosGuide: false,
  setShowIosGuide: () => {},
});

export function usePwa() {
  return useContext(PwaContext);
}

const guides: Record<GuidePlatform, { subtitle: string; steps: React.ReactNode[] }> = {
  ios: {
    subtitle: "Instale no seu iPhone/iPad para abrir direto em tela cheia.",
    steps: [
      <>Toque no botão <b>Compartilhar</b> <span className="ios-icon-share">⎋</span> na barra inferior do Safari.</>,
      <>Role para cima e selecione <b>Adicionar à Tela de Início</b> <span className="ios-icon-plus">＋</span>.</>,
      <>Toque em <b>Adicionar</b> no canto superior direito para confirmar.</>,
    ],
  },
  "mac-safari": {
    subtitle: "Instale no seu Mac para abrir pelo Dock, em janela própria.",
    steps: [
      <>No menu do Safari, abra <b>Arquivo</b>.</>,
      <>Selecione <b>Adicionar ao Dock…</b></>,
      <>Confirme em <b>Adicionar</b>. O Pecsil OS aparece no Dock e no Launchpad.</>,
    ],
  },
};

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isMacSafari, setIsMacSafari] = useState(false);
  const [guide, setGuide] = useState<GuidePlatform | null>(null);

  useEffect(() => {
    // 1. Registro do Service Worker
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          // Registrado com sucesso
        })
        .catch((err) => {
          console.warn("[PWA] Falha no registro do Service Worker:", err);
        });
    }

    // 2. Verificar se já está rodando como standalone (instalado)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    // 3. Detectar plataformas sem prompt nativo
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleMobile =
      (/iphone|ipad|ipod/.test(userAgent) ||
        // iPadOS se apresenta como Mac, mas tem toque
        (/macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)) &&
      !isStandalone;
    setIsIos(isAppleMobile);
    // Safari do macOS (Sonoma+) instala por "Arquivo → Adicionar ao Dock"
    const isSafariEngineOnly = /safari/.test(userAgent) && !/chrome|chromium|crios|edg|opr|firefox|fxios/.test(userAgent);
    setIsMacSafari(/macintosh/.test(userAgent) && isSafariEngineOnly && !isAppleMobile && !isStandalone);

    // 4. Capturar evento de instalação (Chromium / Android / Edge)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
        setIsInstallable(false);
      }
      setDeferredPrompt(null);
    } else if (isIos) {
      setGuide("ios");
    } else if (isMacSafari) {
      setGuide("mac-safari");
    }
  };

  const canInstall = !isInstalled && (isInstallable || isIos || isMacSafari);
  const activeGuide = guide ? guides[guide] : null;

  return (
    <PwaContext.Provider
      value={{
        isInstallable,
        isInstalled,
        isIos,
        isMacSafari,
        canInstall,
        promptInstall,
        showIosGuide: guide !== null,
        setShowIosGuide: (show) => setGuide(show ? (isMacSafari ? "mac-safari" : "ios") : null),
      }}
    >
      {children}

      <UpdateNotice />

      {/* Instruções de instalação para plataformas sem prompt nativo (iOS e Safari do Mac) */}
      {activeGuide && (
        <div className="pwa-ios-modal-overlay" onClick={() => setGuide(null)}>
          <div className="pwa-ios-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pwa-ios-modal-header">
              <div className="pwa-modal-icon">
                <img src="/icons/icon-192.png" alt="Pecsil OS" width={48} height={48} />
              </div>
              <div>
                <h3>Instalar Pecsil Business OS</h3>
                <p>{activeGuide.subtitle}</p>
              </div>
              <button
                className="pwa-close-btn"
                onClick={() => setGuide(null)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <ol className="pwa-ios-steps">
              {activeGuide.steps.map((step, index) => (
                <li key={index}>
                  <span className="step-num">{index + 1}</span>
                  <div>{step}</div>
                </li>
              ))}
            </ol>

            <div className="pwa-ios-modal-footer">
              <button
                type="button"
                className="ds-button primary"
                onClick={() => setGuide(null)}
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </PwaContext.Provider>
  );
}
