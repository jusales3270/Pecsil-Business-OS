"use client";

import dynamic from "next/dynamic";
import { AuthProvider } from "./contexts/AuthContext";
import type { ModuleRuntimeProps } from "@/modules/runtime";
import "./portaria.css";

const InnerApp = dynamic(() => import("./App"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-muted)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">Carregando Portaria & Controle de Acesso...</p>
      </div>
    </div>
  ),
});

export default function PortariaApp({ access, onExit }: ModuleRuntimeProps) {
  return (
    <div className="w-full h-full min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] portaria-app-root">
      <AuthProvider access={access}>
        <InnerApp onExit={onExit} />
      </AuthProvider>
    </div>
  );
}
