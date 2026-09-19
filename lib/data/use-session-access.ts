"use client";

import { useEffect, useState } from "react";
import type { AccessGrants } from "../../modules/access-catalog";
import { demoOwnerAccess, type ModuleAccessContext } from "../../modules";

/** Dados da conta que a interface mostra fora do contexto de permissões. */
export type SessionProfile = {
  email: string;
  avatarUrl: string | null;
  profileId: string | null;
};

type SessionAccessState = {
  access: ModuleAccessContext;
  /** true quando o contexto veio do banco; false quando é o fallback demonstrativo. */
  real: boolean;
  loading: boolean;
  profile: SessionProfile;
  /** Recarrega a identidade (após editar nome ou foto). */
  reload: () => void;
};

type MePayload = {
  userId: string;
  profileId: string;
  email: string;
  avatarUrl: string | null;
  name: string;
  initials: string;
  role: string;
  roleCode?: string | null;
  scopeLabel: string;
  isOwner?: boolean;
  grants?: AccessGrants;
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
const EMPTY_PROFILE: SessionProfile = { email: "", avatarUrl: null, profileId: null };

export function useSessionAccess(): SessionAccessState {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Omit<SessionAccessState, "reload">>({
    access: demoOwnerAccess,
    real: false,
    loading: true,
    profile: EMPTY_PROFILE,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        // 401 = o Supabase está configurado e respondeu que não há sessão válida:
        // o lugar certo é o login, não uma plataforma "logada" em modo demonstrativo.
        if (response.status === 401) {
          window.location.assign("/login");
          return null;
        }
        // Acesso de terceiro vencido: encerra a sessão e o login explica.
        if (response.status === 403) {
          const body = await response.json().catch(() => ({}));
          if (body?.error === "ACCESS_EXPIRED") {
            await fetch("/auth/signout", { method: "POST" }).catch(() => {});
            const until = typeof body.expiresAt === "string" ? body.expiresAt : "";
            window.location.assign(`/login?expirado=${encodeURIComponent(until)}`);
            return null;
          }
        }
        if (!response.ok) return null; // 503/500 (rede ou sem configuração): mantém o fallback demonstrativo
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
            roleCode: payload.roleCode ?? null,
            scopeLabel: payload.scopeLabel,
            isOwner: payload.isOwner === true,
            grants: payload.grants ?? {},
            permissions: payload.permissions,
            scopes: payload.scopes as ModuleAccessContext["scopes"],
          },
          real: true,
          loading: false,
          profile: {
            email: payload.email,
            avatarUrl: payload.avatarUrl,
            profileId: payload.profileId,
          },
        });
      })
      .catch(() => {
        setState((current) => ({ ...current, loading: false }));
      });

    return () => controller.abort();
  }, [version]);

  return { ...state, reload: () => setVersion((current) => current + 1) };
}
