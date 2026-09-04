"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaContextType {
  isInstallable: boolean;
  isInstalled: boolean;
  isIos: boolean;
  promptInstall: () => Promise<void>;
  showIosGuide: boolean;
  setShowIosGuide: (show: boolean) => void;
}

const PwaContext = createContext<PwaContextType>({
  isInstallable: false,
  isInstalled: false,
  isIos: false,
  promptInstall: async () => {},
  showIosGuide: false,
  setShowIosGuide: () => {},
});

export function usePwa() {
  return useContext(PwaContext);
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

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

    // 3. Detectar dispositivo iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleMobile = /iphone|ipad|ipod/.test(userAgent) && !isStandalone;
    setIsIos(isAppleMobile);

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
      setShowIosGuide(true);
    }
  };

  return (
    <PwaContext.Provider
      value={{
        isInstallable,
        isInstalled,
        isIos,
        promptInstall,
        showIosGuide,
        setShowIosGuide,
      }}
    >
      {children}

      {/* Modal / Diálogo de instruções para instalação no iOS Safari */}
      {showIosGuide && (
        <div className="pwa-ios-modal-overlay" onClick={() => setShowIosGuide(false)}>
          <div className="pwa-ios-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pwa-ios-modal-header">
              <div className="pwa-modal-icon">
                <img src="/icons/icon-192.png" alt="Pecsil OS" width={48} height={48} />
              </div>
              <div>
                <h3>Instalar Pecsil Business OS</h3>
                <p>Instale no seu iPhone/iPad para abrir direto em tela cheia.</p>
              </div>
              <button
                className="pwa-close-btn"
                onClick={() => setShowIosGuide(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <ol className="pwa-ios-steps">
              <li>
                <span className="step-num">1</span>
                <div>
                  Toque no botão <b>Compartilhar</b>{" "}
                  <span className="ios-icon-share">⎋</span> na barra inferior do Safari.
                </div>
              </li>
              <li>
                <span className="step-num">2</span>
                <div>
                  Role para cima e selecione <b>Adicionar à Tela de Início</b>{" "}
                  <span className="ios-icon-plus">＋</span>.
                </div>
              </li>
              <li>
                <span className="step-num">3</span>
                <div>
                  Toque em <b>Adicionar</b> no canto superior direito para confirmar.
                </div>
              </li>
            </ol>

            <div className="pwa-ios-modal-footer">
              <button
                type="button"
                className="ds-button primary"
                onClick={() => setShowIosGuide(false)}
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
