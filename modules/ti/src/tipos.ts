import { useEffect, useState } from "react";
import type { StatusTone } from "../../../packages/design-system";

/** Tipos, rótulos e formatos do módulo de TI (telas e menu da conta). */

export type Ativo = {
  id: string; numero: number; tipo: string; nome: string; local: string | null; responsavel: string | null;
  fabricante: string | null; modelo: string | null; numero_serie: string | null; patrimonio: string | null; ip: string | null;
  sistema_operacional: string | null; critico: boolean; situacao: string; vigia_alvo: string | null; observacao: string | null; updated_at: string;
};

export type Incidente = {
  id: string; origem: "vigia" | "manual"; alvo: string | null; alvo_nome: string | null; ativo_id?: string | null;
  inicio: string; fim: string | null; categoria: string | null; causa_vigia: string | null; causa: string | null;
  descricao?: string | null; confirmado_por_nome?: string | null; confirmado_em: string | null;
  ti_ativos?: { numero: number; nome: string } | null;
};

export type Chamado = {
  id: string; numero: number; titulo: string; descricao: string; categoria: string; prioridade: Prioridade; situacao: SituacaoChamado;
  ativo_id: string | null; local: string | null; solicitante_id: string | null; solicitante_nome: string; responsavel_id: string | null;
  responsavel_nome: string | null; prazo: string; primeira_resposta_em: string | null; resolvido_em: string | null; solucao: string | null;
  created_at: string; updated_at: string; ti_ativos?: { numero: number; nome: string } | null;
};
export type Andamento = { id: string; autor_id: string | null; autor_nome: string; tipo: string; texto: string; created_at: string };
export type Regras = { categorias: string[]; prazos_h: Record<Prioridade, number>; revisado_por_nome: string | null; revisado_em: string | null };

export type Prioridade = "urgente" | "alta" | "normal" | "baixa";
export type SituacaoChamado = "aberto" | "em_atendimento" | "aguardando" | "resolvido" | "cancelado";

export type Saude = {
  lidoEm: string | null;
  servidor: null | {
    nome: string; estado: string; desde: string; ultimoSinal: string | null; ligadoHaS: number | null; discoLivrePct: number | null;
    memoriaLivrePct: number | null; carga1m: number | null; cpus: number | null; servicos: { nome: string; ok: boolean; ms: number | null }[];
  };
  backup: null | { estado: string; ultimo: string | null; horasDesde: number | null; atrasado: boolean; arquivos: { nome: string; bytes: number | null }[]; totalBytes: number; duracaoS: number | null };
  externos: { id: string; nome: string; ativo: boolean; estado: string; ultimaChecagem: { em: string; ok: boolean; status: number | null; erro: string | null } | null }[];
  alertas: { destinatarios: number; canalConfigurado: boolean; ultimos30Dias: Record<string, number> };
  foraAgora: { alvo: string; nome: string; desde: string; causa: string }[];
};

export const TIPO_ATIVO: Record<string, string> = {
  servidor: "Servidor", estacao: "Computador", notebook: "Notebook", rede: "Rede (switch, roteador, Wi-Fi)", coletor_cnc: "Coletor das CNCs",
  impressora: "Impressora", nobreak: "Nobreak", camera: "Câmera", sistema: "Sistema (GRV, Forja…)", outro: "Outro",
};
export const SITUACAO_ATIVO: Record<string, { label: string; tone: StatusTone }> = {
  em_uso: { label: "Em uso", tone: "success" }, reserva: { label: "Reserva", tone: "neutral" },
  manutencao: { label: "Em manutenção", tone: "attention" }, baixado: { label: "Baixado", tone: "neutral" },
};
export const CATEGORIA_INCIDENTE: Record<string, string> = {
  energia: "Energia", internet: "Internet", rede: "Rede ou porta", servidor: "Servidor", estacao: "Computador",
  sistema: "Sistema", backup: "Backup", alarme_falso: "Alarme falso", outro: "Outro",
};
export const PRIORIDADE: Record<Prioridade, { label: string; tone: StatusTone }> = {
  urgente: { label: "Urgente", tone: "danger" }, alta: { label: "Alta", tone: "attention" },
  normal: { label: "Normal", tone: "info" }, baixa: { label: "Baixa", tone: "neutral" },
};
export const PRIORIDADES: Prioridade[] = ["urgente", "alta", "normal", "baixa"];
export const SITUACAO_CHAMADO: Record<SituacaoChamado, { label: string; tone: StatusTone }> = {
  aberto: { label: "Aberto", tone: "attention" }, em_atendimento: { label: "Em atendimento", tone: "info" },
  aguardando: { label: "Aguardando", tone: "purple" }, resolvido: { label: "Resolvido", tone: "success" }, cancelado: { label: "Cancelado", tone: "neutral" },
};
export const EM_ABERTO: SituacaoChamado[] = ["aberto", "em_atendimento", "aguardando"];

const BR = "America/Sao_Paulo";
export const dataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: BR, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const data = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: BR }) : "—");

/** 45 s · 12 min · 3 h 05 min · 2 d 4 h */
export function duracao(seg: number | null | undefined): string {
  if (seg === null || seg === undefined || !Number.isFinite(seg)) return "—";
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${String(Math.round(s / 60) % 60).padStart(2, "0")} min`;
  return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
}
export const segundosEntre = (de: string, ate: string | null, agora: number) => ((ate ? Date.parse(ate) : agora || Date.parse(de)) - Date.parse(de)) / 1000;
export const tamanho = (b: number | null | undefined) =>
  !b ? "—" : b >= 1e9 ? `${(b / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : `${(b / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/**
 * A hora de agora para prazos e durações, atualizada fora da renderização (a cada 30 s).
 * Vale 0 no primeiro quadro: quem usa mostra "…" até a primeira leitura.
 */
export function useAgora(ms = 30_000) {
  const [agora, setAgora] = useState(0);
  useEffect(() => {
    const ler = () => setAgora(Date.now());
    const t = setTimeout(ler, 0);
    const i = setInterval(ler, ms);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [ms]);
  return agora;
}

/** Prazo do chamado em palavras: "vence em 3 h", "venceu há 2 h", "resolvido no prazo". */
export function prazoTexto(c: Pick<Chamado, "prazo" | "situacao" | "resolvido_em">, agora: number): { texto: string; tone: StatusTone } {
  if (!agora) return { texto: "…", tone: "neutral" };
  const prazo = Date.parse(c.prazo);
  if (c.situacao === "cancelado") return { texto: "—", tone: "neutral" };
  if (c.situacao === "resolvido") {
    const fim = c.resolvido_em ? Date.parse(c.resolvido_em) : agora;
    return fim <= prazo ? { texto: "no prazo", tone: "success" } : { texto: `${duracao((fim - prazo) / 1000)} fora do prazo`, tone: "attention" };
  }
  const falta = (prazo - agora) / 1000;
  if (falta < 0) return { texto: `venceu há ${duracao(-falta)}`, tone: "danger" };
  return { texto: `vence em ${duracao(falta)}`, tone: falta < 3600 ? "attention" : "neutral" };
}

export async function chamarTi<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = String(corpo?.error ?? "");
      return { ok: false, error: e === "FORBIDDEN" ? "Sem permissão." : e === "UNAUTHENTICATED" ? "Sessão expirada: entre de novo." : e && !/^[A-Z_]+$/.test(e) ? e : "Não foi possível carregar. Tente de novo." };
    }
    return { ok: true, data: corpo as T };
  } catch {
    return { ok: false, error: "Sem conexão com a plataforma." };
  }
}
