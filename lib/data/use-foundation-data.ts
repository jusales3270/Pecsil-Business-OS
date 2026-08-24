"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../supabase/client";
import {
  demoFoundationSnapshot,
  type FoundationSnapshot,
} from "./foundation";

type FoundationDataState = {
  snapshot: FoundationSnapshot;
  loading: boolean;
  error: string | null;
};

export function useFoundationData(): FoundationDataState {
  const [state, setState] = useState<FoundationDataState>({
    snapshot: demoFoundationSnapshot,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadFoundation() {
      try {
        let response = await fetch("/api/foundation", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401) {
          // Verifica se o navegador tem sessão ativa e tenta revalidar antes de deslogar
          try {
            const supabase = createSupabaseBrowserClient();
            const { data } = await supabase.auth.getSession();
            if (data?.session) {
              await supabase.auth.refreshSession();
              response = await fetch("/api/foundation", {
                cache: "no-store",
                signal: controller.signal,
              });
            }
          } catch {
            // Se falhar ao checar sessão, segue para verificação de status
          }
        }

        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) throw new Error("FOUNDATION_UNAVAILABLE");

        const snapshot = (await response.json()) as FoundationSnapshot;
        setState({ snapshot, loading: false, error: null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          snapshot: demoFoundationSnapshot,
          loading: false,
          error: "Os dados reais estão indisponíveis; exibindo a base demonstrativa.",
        });
      }
    }

    void loadFoundation();
    return () => controller.abort();
  }, []);

  return state;
}
