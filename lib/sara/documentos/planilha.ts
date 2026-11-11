import type { Visual } from "../visual.ts";
import type { Aba, FormatoCelula } from "./xlsx.ts";

/**
 * Do visual da SARA (o que a plataforma preencheu com o resultado da consulta) para a aba da planilha (I-27). Os
 * números vão crus, antes de virar texto formatado: na planilha eles somam. O modelo só escolhe quais visuais
 * entram e o nome da aba; nenhum número é digitado por ele.
 */

const formato = (f: string): FormatoCelula => (f === "moeda" || f === "numero" || f === "dias" || f === "data" ? f : "texto");

export function abaDoVisual(v: Visual, nome?: string | null): Aba {
  const titulo = (nome ?? "").trim() || v.titulo;
  switch (v.componente) {
    case "tabela":
      return { nome: titulo, colunas: v.colunas.map((c) => ({ rotulo: c.rotulo, formato: formato(c.formato) })), linhas: v.linhas };
    case "indicadores":
      // Cada indicador tem o seu formato: a coluna Valor vai célula a célula.
      return { nome: titulo, colunas: [{ rotulo: "Indicador", formato: "texto" }, { rotulo: "Valor", formato: "numero" }],
        linhas: v.itens.map((i) => [i.rotulo, i.valor]), formatos: v.itens.map((i) => ["texto", formato(i.formato)]) };
    case "lista_de_datas":
      return { nome: titulo, colunas: [{ rotulo: "Data", formato: "data" }, { rotulo: "Item", formato: "texto" }, { rotulo: "Valor", formato: formato(v.formato) }],
        linhas: v.itens.map((i) => [i.data, i.rotulo, i.valor]) };
    default:
      // Barras, linha e rosca: cada ponto vira uma linha (nome e valor).
      return { nome: titulo, colunas: [{ rotulo: v.campoRotulo ? v.campoRotulo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Item", formato: "texto" }, { rotulo: v.titulo, formato: formato(v.formato) }],
        linhas: v.pontos.map((p) => [p.rotulo, p.valor]) };
  }
}

export type PedidoPlanilha = { titulo: string; abas: { visual: number; nome?: string | null }[] };

/** Confere o pedido do modelo: cada visual tem de existir nesta conversa (pelo número que a plataforma deu). */
export function montarPlanilha(e: Record<string, unknown>, visuais: Visual[]): { titulo: string; abas: Aba[] } | { erro: string } {
  const titulo = String(e.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (titulo.length < 3) return { erro: "Dê um título à planilha." };
  const pedidas = (Array.isArray(e.abas) ? e.abas : []).slice(0, 12) as { visual?: unknown; nome?: unknown }[];
  if (!pedidas.length) return { erro: "Diga quais visuais entram (o número que a plataforma deu a cada um), uma aba por visual." };
  const faltam = pedidas.map((a) => Number(a.visual)).filter((n) => !Number.isInteger(n) || n < 1 || n > visuais.length);
  if (faltam.length) return { erro: `Visual ${faltam.join(", ")} não existe nesta conversa (há ${visuais.length}). Peça às áreas a tabela ou o gráfico (ou monte com mostrar) e use o número que a plataforma devolveu.` };
  return { titulo, abas: pedidas.map((a) => abaDoVisual(visuais[Number(a.visual) - 1], typeof a.nome === "string" ? a.nome.slice(0, 60) : null)) };
}

const celula = (c: unknown) => (typeof c === "number" && Number.isFinite(c) ? c : typeof c === "string" ? c.slice(0, 500) : null);
const textoCurto = (t: unknown, n = 120) => String(t ?? "").slice(0, n);

/**
 * "Baixar em Excel" num visual da tela: o navegador manda o visual que está mostrando. Aceita só o formato de
 * visual da plataforma, com limite de tamanho; o que não for número ou texto vira vazio.
 */
export function visualDaTela(x: unknown): Visual | null {
  const v = (x ?? {}) as Record<string, unknown>;
  const comum = { titulo: textoCurto(v.titulo) || "Planilha", origem: textoCurto(v.origem), fonte: null };
  if (v.componente === "tabela" && Array.isArray(v.colunas) && Array.isArray(v.linhas)) {
    const colunas = (v.colunas as { rotulo?: unknown; formato?: unknown }[]).slice(0, 20).map((c) => ({ rotulo: textoCurto(c?.rotulo, 80), formato: formato(String(c?.formato ?? "texto")) }));
    const linhas = (v.linhas as unknown[]).slice(0, 2000).map((l) => (Array.isArray(l) ? l.slice(0, colunas.length).map(celula) : []));
    return { ...comum, componente: "tabela", colunas, linhas, total: linhas.length };
  }
  if ((v.componente === "barras" || v.componente === "linha" || v.componente === "rosca") && Array.isArray(v.pontos)) {
    const pontos = (v.pontos as { rotulo?: unknown; valor?: unknown }[]).slice(0, 500).filter((p) => typeof p?.valor === "number").map((p) => ({ rotulo: textoCurto(p.rotulo), valor: p.valor as number }));
    return { ...comum, componente: v.componente, formato: formato(String(v.formato ?? "numero")), pontos, total: pontos.length, campoRotulo: typeof v.campoRotulo === "string" ? textoCurto(v.campoRotulo, 60) : undefined };
  }
  if (v.componente === "indicadores" && Array.isArray(v.itens)) {
    const itens = (v.itens as { rotulo?: unknown; valor?: unknown; formato?: unknown }[]).slice(0, 50).map((i) => ({ rotulo: textoCurto(i?.rotulo), valor: celula(i?.valor), formato: formato(String(i?.formato ?? "numero")) }));
    return { ...comum, componente: "indicadores", itens };
  }
  if (v.componente === "lista_de_datas" && Array.isArray(v.itens)) {
    const itens = (v.itens as { data?: unknown; rotulo?: unknown; valor?: unknown }[]).slice(0, 2000).map((i) => ({ data: textoCurto(i?.data, 30), rotulo: textoCurto(i?.rotulo), valor: typeof i?.valor === "number" ? i.valor : null }));
    return { ...comum, componente: "lista_de_datas", formato: formato(String(v.formato ?? "moeda")), itens, total: itens.length };
  }
  return null;
}
