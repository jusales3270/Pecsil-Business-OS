"use client";

import { useEffect, useState } from "react";
import { demoFinanceSnapshot, type FinanceSnapshot } from "./finance";

type FinanceDataState = {
  snapshot: FinanceSnapshot;
  loading: boolean;
  error: string | null;
};

export function useFinanceData(): FinanceDataState {
  const [state, setState] = useState<FinanceDataState>({
    snapshot: demoFinanceSnapshot,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadFinance() {
      try {
        const response = await fetch("/api/finance", { cache:"no-store", signal:controller.signal });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) throw new Error("FINANCE_UNAVAILABLE");
        const snapshot = (await response.json()) as FinanceSnapshot;
        setState({ snapshot, loading:false, error:null });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          snapshot: demoFinanceSnapshot,
          loading: false,
          error: "Os dados reais estão indisponíveis; exibindo a base financeira demonstrativa.",
        });
      }
    }

    void loadFinance();
    return () => controller.abort();
  }, []);

  return state;
}

