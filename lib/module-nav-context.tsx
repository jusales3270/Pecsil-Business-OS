"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

export interface ModuleNavItem {
  id: string;
  label: string;
  icon?: string;
}

export interface ModuleNavState {
  moduleId: string;
  moduleName: string;
  items: ModuleNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

interface ModuleNavContextType {
  navState: ModuleNavState | null;
  registerNav: (state: ModuleNavState | null) => void;
}

export const ModuleNavContext = createContext<ModuleNavContextType>({
  navState: null,
  registerNav: () => {},
});

export function ModuleNavProvider({ children }: { children: React.ReactNode }) {
  const [navState, setNavState] = useState<ModuleNavState | null>(null);

  const registerNav = useCallback((state: ModuleNavState | null) => {
    setNavState(prev => {
      if (!prev && !state) return null;
      if (
        prev &&
        state &&
        prev.moduleId === state.moduleId &&
        prev.activeId === state.activeId &&
        prev.items.length === state.items.length &&
        prev.items.every((it, i) => it.id === state.items[i]?.id && it.label === state.items[i]?.label && it.icon === state.items[i]?.icon)
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
