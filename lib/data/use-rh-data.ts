"use client";

import { useEffect, useState } from "react";
import { demoRhSnapshot, type RhSnapshot } from "./rh";

type RhDataState = {
  snapshot: RhSnapshot;
  loading: boolean;
  error: string | null;
};

export function useRhData(): RhDataState {
  const [state, setState] = useState<RhDataState>({
    snapshot: demoRhSnapshot,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadRh() {
      try {
        const response = await fetch("/api/rh", { cache:"no-store", signal:controller.signal });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) throw new Error("RH_UNAVAILABLE");
        const snapshot = (await response.json()) as RhSnapshot;
        setState({ snapshot, loading:false, error:null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          snapshot: demoRhSnapshot,
          loading: false,
          error: "Os dados reais estão indisponíveis; exibindo a base de RH demonstrativa.",
        });
      }
    }

    void loadRh();
    return () => controller.abort();
  }, []);

  return state;
}
