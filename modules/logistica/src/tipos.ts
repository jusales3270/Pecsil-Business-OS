import { useEffect, useState } from "react";
import type { StatusTone } from "../../../packages/design-system";

/** Tipos, rótulos e formatos da Logística (docs/PLANO-LOGISTICA.md). */

export type Situacao = "criada" | "enviada" | "a_caminho" | "entregue" | "falhou" | "cancelada";

export type Entrega = {
  id: string; numero: number; origem_tipo?: "os" | "pedido" | "nota" | "avulsa"; origem_rotulo: string | null; customer_id?: string;
  cliente_nome: string; descricao: string; destino_endereco: string | null; destino_lat: number | null; destino_lng: number | null;
  situacao: Situacao; fleetbase_ordem: string | null; rastreio: string | null; motorista: string | null; veiculo: string | null;
  previsao: string | null; saiu_em: string | null; entregue_em: string | null; erro: string | null; created_at?: string; updated_at?: string; created_by_nome?: string | null;
};

export type Origem = { origem_nome: string; origem_endereco: string; origem_lat: number; origem_lng: number; updated_at?: string; updated_by_nome?: string | null };

export type Motorista = {
  id: string; nome: string; posicao: { lat: number; lng: number } | null; online: boolean; velocidade: number | null; direcao: number | null;
  atualizado: string | null; veiculo: { placa: string | null; modelo: string | null } | null;
};

export type Andamento = { percentual: number; faltaM: number | null; chegada: string | null; confianca: string | null; provedor: string | null; comTransito: boolean; estimativaEmLinhaReta: boolean; trajeto: [number, number][] };

export type AoVivo = { servico: boolean; origem: Origem | null; entregas: Entrega[]; motoristas: Motorista[]; andamento: Record<string, Andamento | null>; lidoEm?: string };

export const SITUACAO: Record<Situacao, { rotulo: string; tom: StatusTone; cor: string }> = {
  criada: { rotulo: "Criada", tom: "neutral", cor: "#8a94a6" },
  enviada: { rotulo: "Com a frota", tom: "info", cor: "#3b82f6" },
  a_caminho: { rotulo: "A caminho", tom: "attention", cor: "#f59e0b" },
  entregue: { rotulo: "Entregue", tom: "success", cor: "#10b981" },
  falhou: { rotulo: "Não entregue", tom: "danger", cor: "#ef4444" },
  cancelada: { rotulo: "Cancelada", tom: "neutral", cor: "#94a3b8" },
};
export const ABERTAS: Situacao[] = ["criada", "enviada", "a_caminho"];

export async function chamarLogistica<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = String((j as { error?: string })?.error ?? "");
      return { ok: false, error: e === "FORBIDDEN" ? "Sem acesso às entregas." : e && !/^[A-Z_]+$/.test(e) ? e : "Não foi possível falar com a Logística." };
    }
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, error: "Sem conexão com a plataforma." };
  }
}

export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");
export const km = (m: number | null | undefined) => (m === null || m === undefined ? "—" : m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`);
export const haQuanto = (iso: string | null | undefined, agora: number) => {
  if (!iso || !agora) return "—";
  const s = Math.max(0, (agora - Date.parse(iso)) / 1000);
  return s < 60 ? "agora" : s < 3600 ? `há ${Math.round(s / 60)} min` : s < 86_400 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86_400)} d`;
};

/** Relógio para "há quanto tempo" (atualiza a cada 15 s; 0 até montar, para não divergir do servidor). */
export function useAgora(ms = 15_000) {
  const [agora, setAgora] = useState(0);
  useEffect(() => {
    const t0 = setTimeout(() => setAgora(Date.now()), 0);
    const id = setInterval(() => setAgora(Date.now()), ms);
    return () => { clearTimeout(t0); clearInterval(id); };
  }, [ms]);
  return agora;
}
