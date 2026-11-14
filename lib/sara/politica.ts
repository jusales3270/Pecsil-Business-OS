/**
 * Política de modelos de uma empresa (I-32): que modelo e que esforço cada nível usa, o modo do roteador, o teto do
 * mês em reais e o nível de cada trabalho fixo da SARA. É configuração da empresa (o "harness business" do ECOS),
 * guardada no banco (`sara_politica_modelos`, uma linha por organização); aqui ficam o padrão e as regras puras.
 * O padrão segue o guia da Anthropic: o mais barato que resolve, Opus no julgamento, Fable disponível e desligado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ESFORCOS, doCatalogo, esforcoValido, type Esforco } from "./modelos.ts";
import { NIVEIS, type Nivel } from "./nivel.ts";

export type Escolha = { modelo: string; esforco: Esforco };
export type ModoRoteador = "desligado" | "sombra" | "ligado";
export const MODOS: ModoRoteador[] = ["desligado", "sombra", "ligado"];
/** Quem pode a análise profunda: o proprietário; a diretoria (cargo Diretor em Pessoas e Acessos); ou todos. */
export type QuemProfundo = "proprietario" | "diretoria" | "todos";
export const QUEM_PROFUNDO: QuemProfundo[] = ["proprietario", "diretoria", "todos"];
/** Trabalhos da SARA que rodam sozinhos ou ajudam a conversa: cada um aponta para um nível. */
export type Trabalho = "bom_dia" | "vigia" | "crescimento" | "sentinela" | "memoria" | "conferir_saida" | "roteador_voz" | "tarefas" | "habilidades" | "classificador";
export const TRABALHOS: Trabalho[] = ["bom_dia", "vigia", "crescimento", "sentinela", "memoria", "conferir_saida", "roteador_voz", "tarefas", "habilidades", "classificador"];
export const ROTULO_TRABALHO: Record<Trabalho, string> = {
  bom_dia: "Bom dia", vigia: "Vigia (gargalos)", crescimento: "Relatório de crescimento", sentinela: "Sentinela do Contábil-Fiscal", memoria: "Memória da pessoa",
  conferir_saida: "Conferência do que sai da empresa", roteador_voz: "Roteador da voz", tarefas: "Leitura de reunião (tarefas)", habilidades: "Habilidades", classificador: "Classificador de nível",
};

export type Politica = {
  niveis: Record<Nivel, Escolha>;
  modo: ModoRoteador;
  profundoPara: QuemProfundo;
  /** Teto do mês em reais (null: sem teto em reais; vale o teto de tokens de cada SARA). */
  tetoMesReais: number | null;
  trabalhos: Record<Trabalho, Nivel>;
};

export const POLITICA_PADRAO: Politica = {
  niveis: {
    rapido: { modelo: "claude-haiku-5-5", esforco: "low" },
    padrao: { modelo: "claude-sonnet-5-5", esforco: "medium" },
    criterio: { modelo: "claude-opus-5-5", esforco: "medium" },
    profundo: { modelo: "claude-opus-5-5", esforco: "high" },
  },
  modo: "desligado",
  profundoPara: "diretoria",
  tetoMesReais: null,
  trabalhos: { bom_dia: "rapido", vigia: "criterio", crescimento: "profundo", sentinela: "rapido", memoria: "rapido", conferir_saida: "rapido", roteador_voz: "rapido", tarefas: "rapido", habilidades: "rapido", classificador: "rapido" },
};

/** A escolha de um nível, conferida no catálogo (modelo desconhecido volta ao padrão; esforço fora do aceito, ao do modelo). */
export function escolhaDoNivel(p: Politica, n: Nivel): Escolha {
  const e = p.niveis[n] ?? POLITICA_PADRAO.niveis[n];
  const modelo = doCatalogo(e.modelo) ? e.modelo : POLITICA_PADRAO.niveis[n].modelo;
  return { modelo, esforco: esforcoValido(modelo, e.esforco) };
}

/** O nível e a escolha de um trabalho fixo. */
export function escolhaDoTrabalho(p: Politica, t: Trabalho): Escolha & { nivel: Nivel } {
  const nivel = p.trabalhos[t] ?? POLITICA_PADRAO.trabalhos[t];
  return { nivel, ...escolhaDoNivel(p, nivel) };
}

/** Quem fala pode a análise profunda? */
export function podeProfundo(p: Politica, pessoa: { dono: boolean; diretor: boolean }): boolean {
  if (pessoa.dono) return true;
  if (p.profundoPara === "todos") return true;
  return p.profundoPara === "diretoria" && pessoa.diretor;
}

/** A linha do banco (`sara_politica_modelos`). */
export type LinhaPolitica = {
  modo: string; rapido_modelo: string; rapido_esforco: string; padrao_modelo: string; padrao_esforco: string;
  criterio_modelo: string; criterio_esforco: string; profundo_modelo: string; profundo_esforco: string;
  profundo_para: string; teto_mes_reais: number | string | null; trabalhos: Record<string, unknown> | null;
};

const ehEsforco = (v: unknown): v is Esforco => ESFORCOS.includes(v as Esforco);

/** A política a partir da linha do banco: o que estiver fora do catálogo ou faltar vale o padrão. */
export function politicaDaLinha(l: Partial<LinhaPolitica> | null | undefined): Politica {
  if (!l) return POLITICA_PADRAO;
  const niveis = Object.fromEntries(NIVEIS.map((n) => {
    const modelo = String((l as Record<string, unknown>)[`${n}_modelo`] ?? "");
    const esforco = (l as Record<string, unknown>)[`${n}_esforco`];
    const escolha: Escolha = doCatalogo(modelo) ? { modelo, esforco: ehEsforco(esforco) ? esforcoValido(modelo, esforco) : POLITICA_PADRAO.niveis[n].esforco } : POLITICA_PADRAO.niveis[n];
    return [n, escolha];
  })) as Record<Nivel, Escolha>;
  const teto = l.teto_mes_reais == null || l.teto_mes_reais === "" ? null : Number(l.teto_mes_reais);
  const trabalhos = { ...POLITICA_PADRAO.trabalhos };
  for (const t of TRABALHOS) { const v = (l.trabalhos ?? {})[t]; if (NIVEIS.includes(v as Nivel)) trabalhos[t] = v as Nivel; }
  return {
    niveis,
    modo: MODOS.includes(l.modo as ModoRoteador) ? (l.modo as ModoRoteador) : POLITICA_PADRAO.modo,
    profundoPara: QUEM_PROFUNDO.includes(l.profundo_para as QuemProfundo) ? (l.profundo_para as QuemProfundo) : POLITICA_PADRAO.profundoPara,
    tetoMesReais: teto != null && Number.isFinite(teto) && teto >= 0 ? teto : null,
    trabalhos,
  };
}

/** A linha para gravar. */
export function linhaDaPolitica(p: Politica): LinhaPolitica {
  return {
    modo: p.modo, profundo_para: p.profundoPara, teto_mes_reais: p.tetoMesReais, trabalhos: { ...p.trabalhos },
    rapido_modelo: p.niveis.rapido.modelo, rapido_esforco: p.niveis.rapido.esforco, padrao_modelo: p.niveis.padrao.modelo, padrao_esforco: p.niveis.padrao.esforco,
    criterio_modelo: p.niveis.criterio.modelo, criterio_esforco: p.niveis.criterio.esforco, profundo_modelo: p.niveis.profundo.modelo, profundo_esforco: p.niveis.profundo.esforco,
  };
}

/**
 * O que a tela do proprietário manda, conferido com rigor (o padrão não entra calado: modelo fora do catálogo ou
 * esforço que o modelo não aceita é recusado com o motivo).
 */
export function validarPolitica(bruto: unknown): { ok: true; politica: Politica } | { ok: false; erro: string } {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const niveisBrutos = (b.niveis ?? {}) as Record<string, { modelo?: unknown; esforco?: unknown }>;
  const niveis = {} as Record<Nivel, Escolha>;
  for (const n of NIVEIS) {
    const e = niveisBrutos[n] ?? {};
    const m = doCatalogo(String(e.modelo ?? ""));
    if (!m) return { ok: false, erro: `Modelo desconhecido no nível ${n}.` };
    if (!ehEsforco(e.esforco) || !m.esforcos.includes(e.esforco)) return { ok: false, erro: `Esforço inválido para ${m.rotulo} no nível ${n}.` };
    niveis[n] = { modelo: m.id, esforco: e.esforco };
  }
  if (!MODOS.includes(b.modo as ModoRoteador)) return { ok: false, erro: "Modo do roteador inválido." };
  if (!QUEM_PROFUNDO.includes(b.profundoPara as QuemProfundo)) return { ok: false, erro: "Diga quem pode a análise profunda." };
  let teto: number | null = null;
  if (b.tetoMesReais !== null && b.tetoMesReais !== undefined && b.tetoMesReais !== "") {
    teto = Number(String(b.tetoMesReais).replace(",", "."));
    if (!Number.isFinite(teto) || teto < 0 || teto > 1_000_000) return { ok: false, erro: "Teto do mês inválido." };
    teto = Math.round(teto * 100) / 100;
  }
  const trabalhos = { ...POLITICA_PADRAO.trabalhos };
  const tb = (b.trabalhos ?? {}) as Record<string, unknown>;
  for (const t of TRABALHOS) {
    if (tb[t] === undefined) continue;
    if (!NIVEIS.includes(tb[t] as Nivel)) return { ok: false, erro: `Nível inválido para ${ROTULO_TRABALHO[t]}.` };
    trabalhos[t] = tb[t] as Nivel;
  }
  return { ok: true, politica: { niveis, modo: b.modo as ModoRoteador, profundoPara: b.profundoPara as QuemProfundo, tetoMesReais: teto, trabalhos } };
}

/** A política da empresa de quem pergunta (sem a tabela ou sem a linha: o padrão, que nasce desligado). */
export async function lerPolitica(sb: SupabaseClient): Promise<Politica> {
  const { data, error } = await sb.from("sara_politica_modelos").select("*").limit(1).maybeSingle();
  if (error || !data) return POLITICA_PADRAO;
  return politicaDaLinha(data as Partial<LinhaPolitica>);
}
