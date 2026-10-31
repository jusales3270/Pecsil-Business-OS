import type { Celula, Visual } from "./visual.ts";

/**
 * Visuais ligados (T4 do E7.T, 31/10/2026): tocar numa fatia ou barra filtra a tabela da MESMA consulta que tenha a coluna
 * do gráfico. O caminho pode ser outro: o comum é a rosca vir do resumo por fornecedor e a tabela, do detalhe. Nada aqui
 * inventa número: a tabela só mostra as linhas que a plataforma já montou. Puro, testado em tests/sara-tela.test.mjs.
 */

export type Selecao = { consulta: string; rotulo: string };
type ComPontos = Extract<Visual, { pontos: unknown }>;
type Tabela = Extract<Visual, { componente: "tabela" }>;

/** Sem filtro, a tabela segue mostrando até 30 linhas; as demais servem ao filtro. */
export const LINHAS_SEM_FILTRO = 30;

const mesmaOrigem = (a: Visual, l: { consulta: string }) => a.ligacao?.consulta === l.consulta;
const temPontos = (v: Visual): v is ComPontos => v.componente === "barras" || v.componente === "rosca";
/** "Outros (n)" soma vários itens: não dá para filtrar. */
export const ehOutros = (rotulo: string) => /^Outros \(\d+\)$/.test(rotulo);

/** A tabela da mesma consulta que tem a coluna do gráfico, ou null. */
export function tabelaLigada(v: Visual, visuais: Visual[]): Tabela | null {
  if (!temPontos(v) || !v.ligacao || !v.campoRotulo) return null;
  const { ligacao, campoRotulo } = v;
  return (visuais.find((t): t is Tabela => t.componente === "tabela" && mesmaOrigem(t, ligacao) && Boolean(t.campos?.includes(campoRotulo))) ?? null);
}

/** O campo do gráfico ligado a esta tabela pela seleção. */
export function campoDaSelecao(t: Tabela, s: Selecao | null, visuais: Visual[]): string | null {
  if (!s || !mesmaOrigem(t, s)) return null;
  const g = visuais.find((v) => temPontos(v) && mesmaOrigem(v, s) && v.pontos.some((p) => p.rotulo === s.rotulo)) as ComPontos | undefined;
  return g?.campoRotulo && t.campos?.includes(g.campoRotulo) ? g.campoRotulo : null;
}

/** O nome no gráfico é cortado em 40 letras: a linha casa pelo mesmo corte. */
export function filtrarTabela(t: Tabela, campo: string, rotulo: string): Celula[][] {
  const i = t.campos?.indexOf(campo) ?? -1;
  return i < 0 ? [] : t.linhas.filter((l) => String(l[i] ?? "—").slice(0, 40) === rotulo);
}

/** Voz: acha um item que existe nos gráficos na tela, sem diferença de maiúscula; devolve também a lista dos que existem. */
export function acharNoVisual(visuais: Visual[], pedido: string): { selecao: Selecao | null; existem: string[] } {
  const graficos = visuais.filter(temPontos);
  const existem = [...new Set(graficos.flatMap((g) => g.pontos.map((p) => p.rotulo)))];
  const alvo = pedido.trim().toLowerCase();
  for (const g of graficos) {
    const p = g.pontos.find((x) => x.rotulo.toLowerCase() === alvo) ?? g.pontos.find((x) => alvo.length >= 3 && x.rotulo.toLowerCase().includes(alvo));
    if (p && g.ligacao) return { selecao: { consulta: g.ligacao.consulta, rotulo: p.rotulo }, existem };
  }
  return { selecao: null, existem };
}
