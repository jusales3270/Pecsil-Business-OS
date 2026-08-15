"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "pecsil-theme";

/**
 * Script executado antes da primeira pintura. Sem ele a página nasce clara e
 * pisca para escura, que é o defeito mais visível de um tema mal implementado.
 * Precisa ser síncrono e independente do bundle.
 */
export const themeBootstrapScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(p==="light"||p==="dark"){document.documentElement.setAttribute("data-theme",p)}}catch(e){}})();`;

/* ============================================================================
   Store externo
   A preferência vive no localStorage e o tema do sistema no matchMedia — ambos
   são fontes externas ao React. useSyncExternalStore lê as duas sem efeito de
   montagem, o que evita render em cascata e mantém a hidratação consistente.
   ============================================================================ */

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  // Mantém abas sincronizadas quando o tema muda em outra janela.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage indisponível (modo privado, iframe restrito) — usa o sistema. */
  }
  return "system";
}

function readResolved(): ResolvedTheme {
  const preference = readPreference();
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Snapshots do servidor: o script de bootstrap corrige antes da pintura.
const serverPreference = (): ThemePreference => "system";
const serverResolved = (): ResolvedTheme => "light";

/* ============================================================================
   Contexto
   ============================================================================ */

type ThemeContextValue = {
  /** O que o usuário escolheu, incluindo "system". */
  preference: ThemePreference;
  /** O tema efetivamente pintado agora. */
  theme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, readPreference, serverPreference);
  const theme = useSyncExternalStore(subscribe, readResolved, serverResolved);

  // Sincroniza o DOM com a preferência. Efeito legítimo: escreve em um
  // sistema externo, não realimenta o estado do React.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    if (preference === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", preference);
    const timer = window.setTimeout(() => root.classList.remove("theme-switching"), 60);
    return () => window.clearTimeout(timer);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Sem persistência disponível: a escolha vale para a sessão atual. */
    }
    emit();
  }, []);

  const toggle = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [theme, setPreference]);

  return (
    <ThemeContext.Provider value={{ preference, theme, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme precisa estar dentro de ThemeProvider.");
  return context;
}

/** Botão de troca de tema do cabeçalho. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Modo claro" : "Modo escuro";

  return (
    <button className="header-icon" onClick={toggle} title={label} aria-label={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        )}
      </svg>
    </button>
  );
}
