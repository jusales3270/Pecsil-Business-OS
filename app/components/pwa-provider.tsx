"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { UpdateNotice } from "./update-notice";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * Plataformas sem prompt nativo: a instalação é manual, com guia na tela. No Android o Chrome
 * normalmente oferece o prompt; quando não oferece (outro navegador, prompt recusado antes), o guia
 * explica o caminho pelo menu — em celular e em tablet.
 */
type GuidePlatform = "iphone" | "ipad" | "android" | "mac-safari";

interface PwaContextType {
  isInstallable: boolean;
  isInstalled: boolean;
  isIos: boolean;
  isMacSafari: boolean;
  isAndroid: boolean;
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
  isAndroid: false,
  canInstall: false,
  promptInstall: async () => {},
  showIosGuide: false,
  setShowIosGuide: () => {},
});

export function usePwa() {
  return useContext(PwaContext);
}

/** O botão Compartilhar do iPhone/iPad: quadrado com a seta para cima (o símbolo ⎋ parecia "recarregar"). */
function IconeCompartilhar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Compartilhar">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5v10h14V11h-1" />
    </svg>
  );
}

const guides: Record<GuidePlatform, { subtitle: string; steps: React.ReactNode[] }> = {
  iphone: {
    subtitle: "Instale no seu iPhone para abrir direto em tela cheia.",
    steps: [
      <>Toque no botão <b>Compartilhar</b> <span className="ios-icon-share"><IconeCompartilhar /></span> na barra de baixo do Safari (no Chrome, ao lado do endereço).</>,
      <>Role a lista e selecione <b>Adicionar à Tela de Início</b> <span className="ios-icon-plus">＋</span>.</>,
      <>Toque em <b>Adicionar</b> no canto superior direito para confirmar.</>,
    ],
  },
  ipad: {
    subtitle: "Instale no seu iPad para abrir direto em tela cheia, deitado ou em pé.",
    steps: [
      <>Toque no botão <b>Compartilhar</b> <span className="ios-icon-share"><IconeCompartilhar /></span> no alto da tela, à direita do endereço.</>,
      <>Na lista que abre, selecione <b>Adicionar à Tela de Início</b> <span className="ios-icon-plus">＋</span>.</>,
      <>Toque em <b>Adicionar</b> para confirmar. O ícone do Pecsil OS aparece na tela de início do iPad.</>,
    ],
  },
  android: {
    subtitle: "Instale no seu tablet ou celular Android para abrir direto em tela cheia.",
    steps: [
      <>No <b>Chrome</b>, toque no menu <b>⋮</b> no canto superior direito (no Samsung Internet, no menu <b>☰</b> embaixo).</>,
      <>Selecione <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</>,
      <>Confirme em <b>Instalar</b>. O Pecsil OS aparece entre os aplicativos do aparelho.</>,
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
  const [isAndroid, setIsAndroid] = useState(false);
  const [isIpad, setIsIpad] = useState(false);
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
    setIsIpad(isAppleMobile && (/ipad/.test(userAgent) || /macintosh/.test(userAgent)));
    setIsAndroid(/android/.test(userAgent) && !isStandalone);
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
      setGuide(isIpad ? "ipad" : "iphone");
    } else if (isAndroid) {
      setGuide("android");
    } else if (isMacSafari) {
      setGuide("mac-safari");
    }
  };

  const canInstall = !isInstalled && (isInstallable || isIos || isAndroid || isMacSafari);
  const activeGuide = guide ? guides[guide] : null;

  return (
    <PwaContext.Provider
      value={{
        isInstallable,
        isInstalled,
        isIos,
        isMacSafari,
        isAndroid,
        canInstall,
        promptInstall,
        showIosGuide: guide !== null,
        setShowIosGuide: (show) => setGuide(show ? (isMacSafari ? "mac-safari" : isAndroid ? "android" : isIpad ? "ipad" : "iphone") : null),
      }}
    >
      {children}

      <UpdateNotice />

      {/* Instruções de instalação sem prompt nativo (iPhone, iPad, Android sem prompt e Safari do Mac) */}
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
