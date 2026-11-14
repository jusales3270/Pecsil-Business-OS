/**
 * Política de modelos de uma empresa (I-32): que modelo e que esforço cada nível usa, o modo do roteador, o teto do
 * mês em reais e o nível de cada trabalho fixo da SARA. É configuração da empresa (o "harness business" do ECOS),
 * guardada no banco (`sara_politica_modelos`, uma linha por organização); aqui ficam o padrão e as regras puras.
 * O padrão segue o guia da Anthropic: o mais barato que resolve, Opus no julgamento, Fable disponível e desligado.
 */

import { doCatalogo, esforcoValido, type Esforco } from "./modelos.ts";
import type { Nivel } from "./nivel.ts";

export type Escolha = { modelo: string; esforco: Esforco };
export type ModoRoteador = "desligado" | "sombra" | "ligado";
/** Trabalhos da SARA que rodam sozinhos ou ajudam a conversa: cada um aponta para um nível. */
export type Trabalho = "bom_dia" | "vigia" | "crescimento" | "sentinela" | "memoria" | "conferir_saida" | "roteador_voz" | "tarefas" | "habilidades" | "classificador";

export type Politica = {
  niveis: Record<Nivel, Escolha>;
  modo: ModoRoteador;
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
