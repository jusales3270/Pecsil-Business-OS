"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

export interface ModuleNavItem {
  id: string;
  label: string;
  icon?: string;
  /** Contador ao lado do item (ex.: Terceiros na fábrica). */
  badge?: string | number;
  /** Tom do contador: "attention" destaca (âmbar), o padrão é neutro. */
  badgeTone?: "neutral" | "attention";
}

/**
 * Área de um módulo-departamento (ex.: CRM e Compras dentro do Comercial).
 * A barra lateral desenha as áreas recuadas sob o módulo, e as seções da área
 * aberta recuadas sob ela.
 */
export interface ModuleNavArea {
  id: string;
  label: string;
  icon?: string;
}

export interface ModuleNavState {
  moduleId: string;
  moduleName: string;
  /** Seções da área aberta (ou do módulo inteiro, quando não há áreas). */
  items: ModuleNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * As seções viram submenu em árvore sob o módulo, na barra lateral, em
   * qualquer largura de tela (em vez do bloco só de celular). Usado por
   * módulos que antes tinham menu lateral próprio (Portaria).
   */
  sidebarTree?: boolean;
  /** Só departamento manda áreas; módulo comum continua como sempre foi. */
  areas?: ModuleNavArea[];
  activeAreaId?: string;
  onSelectArea?: (id: string) => void;
}

interface ModuleNavContextType {
  navState: ModuleNavState | null;
  registerNav: (state: ModuleNavState | null) => void;
}

export const ModuleNavContext = createContext<ModuleNavContextType>({
  navState: null,
  registerNav: () => {},
});

/** Duas listas são iguais quando têm os mesmos itens, na mesma ordem. */
function mesmaLista(
  a: readonly ModuleNavItem[] | undefined,
  b: readonly ModuleNavItem[] | undefined,
) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, i) => item.id === b[i]?.id && item.label === b[i]?.label && item.icon === b[i]?.icon
    && item.badge === b[i]?.badge && item.badgeTone === b[i]?.badgeTone);
}

export function ModuleNavProvider({ children }: { children: React.ReactNode }) {
  const [navState, setNavState] = useState<ModuleNavState | null>(null);

  // Só troca o estado quando o conteúdo muda de verdade. Sem isso, cada render
  // do módulo registraria um objeto novo e a plataforma entraria em laço.
  const registerNav = useCallback((state: ModuleNavState | null) => {
    setNavState(prev => {
      if (!prev && !state) return null;
      if (
        prev &&
        state &&
        prev.moduleId === state.moduleId &&
        prev.activeId === state.activeId &&
        prev.activeAreaId === state.activeAreaId &&
        prev.sidebarTree === state.sidebarTree &&
        mesmaLista(prev.items, state.items) &&
        mesmaLista(prev.areas, state.areas)
      ) {
        return prev;
      }
      return state;
    });
  }, []);

  const value = useMemo(() => ({ navState, registerNav }), [navState, registerNav]);

  return <ModuleNavContext.Provider value={value}>{children}</ModuleNavContext.Provider>;
}

export function useModuleNav() {
  return useContext(ModuleNavContext);
}
