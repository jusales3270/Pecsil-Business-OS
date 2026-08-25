"use client";

import { useEffect, useState } from "react";
import { demoOwnerAccess, type ModuleAccessContext } from "../../modules";

type SessionAccessState = {
  access: ModuleAccessContext;
  /** true quando o contexto veio do banco; false quando é o fallback demonstrativo. */
  real: boolean;
  loading: boolean;
};

type MePayload = {
  userId: string;
  name: string;
  initials: string;
  role: string;
  scopeLabel: string;
  permissions: string[];
  scopes: { type: string; referenceId?: string; moduleCode?: string }[];
};

/**
 * Carrega a identidade real do usuário autenticado (`/api/me`).
 *
 * Enquanto carrega — e quando o Supabase está inacessível — devolve o contexto
 * demonstrativo, para a aplicação não quebrar offline. `real` diz qual dos dois
 * está em uso, para a interface poder sinalizar o modo demonstrativo.
 */
export function useSessionAccess(): SessionAccessState {
  const [state, setState] = useState<SessionAccessState>({
    access: demoOwnerAccess,
    real: false,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/login");
          return null;
        }
        if (!response.ok) return null; // 503/500: mantém o fallback
        return (await response.json()) as MePayload;
      })
      .then((payload) => {
        if (!payload) {
          setState((current) => ({ ...current, loading: false }));
          return;
        }
        setState({
          access: {
            userId: payload.userId,
            name: payload.name,
            initials: payload.initials,
            role: payload.role,
            scopeLabel: payload.scopeLabel,
            permissions: payload.permissions,
            scopes: payload.scopes as ModuleAccessContext["scopes"],
          },
          real: true,
          loading: false,
        });
      })
      .catch(() => {
        setState((current) => ({ ...current, loading: false }));
      });

    return () => controller.abort();
  }, []);

  return state;
}
