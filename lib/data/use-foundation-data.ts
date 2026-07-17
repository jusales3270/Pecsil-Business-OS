"use client";

import { useEffect, useState } from "react";
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
        const response = await fetch("/api/foundation", {
          cache: "no-store",
          signal: controller.signal,
        });

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
