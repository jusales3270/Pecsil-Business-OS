"use client";

import { useCallback, useEffect, useState } from "react";

/** Aviso endereçado à pessoa logada (public.notifications). */
export type InboxItem = {
  id: string;
  module: string;
  severity: "info" | "attention" | "critical" | "approval";
  title: string;
  body: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
};

const INTERVALO = 60_000;

/**
 * Avisos do sino: busca ao abrir, a cada minuto e quando a janela volta ao
 * foco (o app instalado fica horas aberto). Sem sessão real, fica vazio.
 */
export function useInbox(enabled: boolean) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/notificacoes", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { items: InboxItem[]; unread: number };
      setItems(body.items);
      setUnread(body.unread);
    } catch {
      // Sem conexão: mantém o que já estava na tela.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let ativo = true;
    const buscar = () => { if (ativo) void reload(); };
    const primeira = setTimeout(buscar, 0);
    const timer = setInterval(buscar, INTERVALO);
    window.addEventListener("focus", buscar);
    return () => { ativo = false; clearTimeout(primeira); clearInterval(timer); window.removeEventListener("focus", buscar); };
  }, [enabled, reload]);

  const markRead = useCallback(async (ids: string[] | "all") => {
    const lista = ids === "all" ? items.filter((item) => !item.read).map((item) => item.id) : ids;
    if (!lista.length) return;
    setItems((atual) => atual.map((item) => (lista.includes(item.id) ? { ...item, read: true } : item)));
    setUnread((atual) => Math.max(0, atual - lista.filter((id) => items.some((item) => item.id === id && !item.read)).length));
    await fetch("/api/notificacoes", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ids === "all" ? { all: true } : { ids: lista }),
    }).catch(() => {});
  }, [items]);

  return { items, unread, reload, markRead };
}
