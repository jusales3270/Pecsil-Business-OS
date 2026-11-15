/**
 * Decisão do roteador para um pedido (I-32, etapa 3): a política da empresa + a classificação do pedido viram o
 * modelo e o esforço da resposta. Regras puras (testadas em tests/sara-roteador.test.mjs):
 *   - política desligada: nada (a SARA segue como sempre);
 *   - "sombra" (só registrar): anota o que escolheria, sem trocar o modelo, para comparar antes de ligar;
 *   - "ligado": troca o modelo e o esforço; o número de WhatsApp com modelo fixo (escolha do proprietário) vence;
 *   - a SARA central nunca fica abaixo do nível padrão (ela coordena as outras SARAs);
 *   - quem não pode a análise profunda para no critério (podeProfundo da política).
 * O custo da resposta soma o que as SARAs das áreas gastaram quando a central as consultou (antes ficava de fora).
 */

import { custoUsd } from "./custo.ts";
import { ESFORCOS, doCatalogo, type Esforco } from "./modelos.ts";
import { degrauAcima, nivelFinal, ROTULO_NIVEL, type Classificacao, type Nivel } from "./nivel.ts";
import { escolhaDoNivel, podeProfundo, type ModoRoteador, type Politica } from "./politica.ts";

export type Roteamento = {
  modo: Exclude<ModoRoteador, "desligado">;
  nivel: Nivel;
  sugerido: Nivel | null;
  motivo: string | null;
  risco: boolean;
  modelo: string;
  esforco: Esforco;
  /** Trocou de fato o modelo desta resposta. */
  aplicado: boolean;
  porque_nao?: string;
  classificador_ms?: number;
  classificador_usd?: number;
  /** Perto do teto do mês (80%): ficou no máximo no nível padrão, sem os modelos caros. */
  limitado?: string;
  /** Subiu um degrau porque a primeira resposta não passou na conferência (a escada). */
  subiu?: { de: string; para: string; como: "esforço" | "modelo"; porque: string; melhorou: boolean };
};

export function decidirRoteamento(a: {
  politica: Politica; classificacao: Classificacao | null; anterior: Nivel | null; pergunta: string;
  dono: boolean; diretor: boolean; central: boolean; modeloDoCanal: string | null;
  /** O gasto do mês passou de 80% do teto em reais: nada de critério ou profundo (modelos caros). */
  economizar?: boolean;
}): Roteamento | null {
  if (a.politica.modo === "desligado") return null;
  let nivel = nivelFinal(a.classificacao, {
    anterior: a.anterior, pergunta: a.pergunta, padrao: "padrao",
    podeProfundo: podeProfundo(a.politica, { dono: a.dono, diretor: a.diretor }),
    minimo: a.central ? "padrao" : undefined,
  });
  const limitado = a.economizar && (nivel === "criterio" || nivel === "profundo") ? "perto do teto do mês" : undefined;
  if (limitado) nivel = "padrao";
  const e = escolhaDoNivel(a.politica, nivel);
  const porqueNao = a.politica.modo === "sombra" ? "só registrar" : a.modeloDoCanal ? "o número de WhatsApp tem modelo fixo" : null;
  return {
    modo: a.politica.modo, nivel, sugerido: a.classificacao?.nivel ?? null, motivo: a.classificacao?.motivo ?? null, risco: a.classificacao?.risco ?? false,
    modelo: e.modelo, esforco: e.esforco, aplicado: !porqueNao, ...(porqueNao ? { porque_nao: porqueNao } : {}), ...(limitado ? { limitado } : {}),
  };
}

/**
 * A escada (guia da Anthropic): quando a resposta não passa na conferência, sobe um degrau. Primeiro mais esforço
 * no mesmo modelo, até o alto (acima disso, um nível de esforço custa como um modelo maior); depois o modelo do
 * nível de cima, dentro da política e da permissão. null: já está no topo permitido.
 */
export function degrauAcimaDe(p: Politica, atual: { nivel: Nivel; modelo: string; esforco: Esforco }, podeProfundo: boolean): { nivel: Nivel; modelo: string; esforco: Esforco; como: "esforço" | "modelo" } | null {
  const m = doCatalogo(atual.modelo), i = ESFORCOS.indexOf(atual.esforco), alto = ESFORCOS.indexOf("high");
  if (m && i >= 0 && i < alto && m.esforcos.includes(ESFORCOS[i + 1])) return { nivel: atual.nivel, modelo: atual.modelo, esforco: ESFORCOS[i + 1], como: "esforço" };
  const n = degrauAcima(atual.nivel, podeProfundo);
  if (!n) return null;
  const e = escolhaDoNivel(p, n);
  const mesmo = e.modelo === atual.modelo && ESFORCOS.indexOf(e.esforco) <= i;
  return mesmo ? null : { nivel: n, modelo: e.modelo, esforco: e.esforco, como: "modelo" };
}

/** "Análise com critério · Opus 5.5" (o passo da resposta e o registro). */
export const rotuloDoRoteamento = (r: Pick<Roteamento, "nivel" | "modelo">) => `${ROTULO_NIVEL[r.nivel]} · ${(doCatalogo(r.modelo)?.rotulo ?? r.modelo).replace(/^Claude /, "")}`;

type UsoDoModelo = { modelo: string; tokensEntrada: number; tokensSaida: number; cacheLido: number; cacheGravado: number };

/** Custo da resposta em US$: o modelo principal + as SARAs das áreas consultadas + extras (o classificador). */
export function custoDaResposta(r: UsoDoModelo, subagentes: Partial<UsoDoModelo>[] = [], extraUsd = 0): number {
  const uso = (x: Partial<UsoDoModelo>) => custoUsd({ modelo: String(x.modelo ?? ""), tokens_entrada: Number(x.tokensEntrada) || 0, tokens_saida: Number(x.tokensSaida) || 0, cache_lido: Number(x.cacheLido) || 0, cache_gravado: Number(x.cacheGravado) || 0 });
  const total = uso(r) + subagentes.reduce((t, s) => t + uso(s), 0) + (Number(extraUsd) || 0);
  return Math.round(total * 1e6) / 1e6;
}
