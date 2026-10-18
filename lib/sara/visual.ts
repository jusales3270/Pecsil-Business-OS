import type { Ferramenta, Fonte } from "./base.ts";

/**
 * A SARA respondendo com visual (proprietário, 18/10/2026): indicadores, tabela, barras, linha, rosca e
 * lista de datas. O MODELO SÓ APONTA (qual consulta desta resposta, onde está a lista, quais campos);
 * a PLATAFORMA PREENCHE com o resultado real da consulta. Nenhum número do visual é digitado pelo
 * modelo: se o campo não existe ou não é número, o visual é recusado e ele recebe o motivo (e os campos
 * que existem) para corrigir. Catálogo fechado; nada de código gerado.
 */

export const COMPONENTES = ["indicadores", "tabela", "barras", "linha", "rosca", "lista_de_datas"] as const;
export type Componente = (typeof COMPONENTES)[number];
export type Formato = "moeda" | "numero" | "dias" | "data" | "texto";
export type Pedido = {
  componente: Componente; titulo: string; consulta: string; caminho?: string;
  campos?: { campo: string; rotulo?: string; formato?: Formato }[]; rotulo?: string; valor?: string; data?: string; formato?: Formato;
};
export type ResultadoConsulta = { nome: string; rotulo: string; dados: unknown; fontes: Fonte[] };
export type Celula = string | number | null;
export type Visual =
  | { componente: "indicadores"; titulo: string; origem: string; fonte: Fonte | null; itens: { rotulo: string; valor: Celula; formato: Formato }[] }
  | { componente: "tabela"; titulo: string; origem: string; fonte: Fonte | null; colunas: { rotulo: string; formato: Formato }[]; linhas: Celula[][]; total: number }
  | { componente: "barras" | "linha" | "rosca"; titulo: string; origem: string; fonte: Fonte | null; formato: Formato; pontos: { rotulo: string; valor: number }[]; total: number }
  | { componente: "lista_de_datas"; titulo: string; origem: string; fonte: Fonte | null; formato: Formato; itens: { data: string; rotulo: string; valor: number | null }[]; total: number };

const LIMITE: Record<Componente, number> = { indicadores: 4, tabela: 30, barras: 15, linha: 60, rosca: 6, lista_de_datas: 15 };
const FORMATOS: Formato[] = ["moeda", "numero", "dias", "data", "texto"];
const DINHEIRO = /valor|total|saldo|aberto|entra|sai|pago|pagar|receber|custo|pre[cç]o|icms|faturad|amount/i;

export const MOSTRAR: Ferramenta = {
  nome: "mostrar", rotulo: "montou um visual", exige: [],
  descricao: "Mostra o resultado de uma consulta JÁ FEITA nesta resposta como visual: indicadores (1 a 4 números do resultado), tabela (até 4 colunas), barras (ranking), linha (série no tempo), rosca (composição) ou lista_de_datas (vencimentos e prazos). Você só aponta a consulta, onde está a lista no resultado (caminho) e os nomes dos campos: os números são preenchidos pela plataforma. Use quando houver lista, ranking, série ou composição.",
  esquema: {
    type: "object",
    properties: {
      componente: { type: "string", enum: [...COMPONENTES] },
      titulo: { type: "string", description: "Título curto do visual." },
      consulta: { type: "string", description: "Nome da consulta já feita nesta resposta (ex.: contas_a_pagar)." },
      caminho: { type: "string", description: "Onde está a lista ou o objeto no resultado, com pontos (ex.: maiores_primeiro, semanas, por_setor). Vazio = o próprio resultado. Um mapa de contagens (ex.: por_situacao) serve direto para barras e rosca, sem rotulo/valor." },
      campos: { type: "array", description: "Para indicadores (campos do objeto) e tabela (colunas, até 4).", items: { type: "object", properties: { campo: { type: "string" }, rotulo: { type: "string" }, formato: { type: "string", enum: FORMATOS } }, required: ["campo"] } },
      rotulo: { type: "string", description: "Para barras, linha, rosca e lista_de_datas: o campo com o nome de cada item." },
      valor: { type: "string", description: "Para barras, linha, rosca e lista_de_datas: o campo numérico." },
      data: { type: "string", description: "Para lista_de_datas: o campo com a data." },
      formato: { type: "string", enum: FORMATOS, description: "Formato do valor (moeda, numero, dias, data)." },
    },
    required: ["componente", "titulo", "consulta"],
  },
  rodar: async () => ({ dados: { ok: true }, fontes: [] }),
};

const humano = (campo: string) => campo.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const numero = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};
const celula = (v: unknown): Celula => (v == null ? null : typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "boolean" ? (v ? "sim" : "não") : typeof v === "object" ? null : String(v).slice(0, 120));
/** Caminho com pontos dentro do resultado ("maiores_primeiro", "contas.0.saldo"). */
export function caminhar(dados: unknown, caminho?: string): unknown {
  if (!caminho?.trim()) return dados;
  return caminho.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), dados);
}
const camposDe = (lista: Record<string, unknown>[]) => [...new Set(lista.slice(0, 5).flatMap((x) => Object.keys(x)))];
const chavesDe = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x as object) : []);

/**
 * Dica que vai junto do resultado de uma consulta com listas: o modelo decide se mostra, mas a regra sozinha,
 * no meio do prompt, ele esquecia. Só lista o que existe (caminho e campos), sem número nenhum.
 */
export function dicaVisual(consulta: string, dados: unknown): string | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const partes: string[] = [];
  for (const [k, v] of Object.entries(dados as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length >= 2 && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) partes.push(`${k} (${v.length} itens; campos: ${camposDe(v as Record<string, unknown>[]).slice(0, 8).join(", ")})`);
    else if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length >= 2 && Object.values(v).every((x) => numero(x) !== null)) partes.push(`${k} (contagens)`);
  }
  if (!partes.length) return null;
  return `[Para responder com visual, chame mostrar com consulta "${consulta}" e um destes caminhos: ${partes.slice(0, 4).join("; ")}. Se mostrar, não repita a lista no texto.]`;
}

/**
 * Monta o visual com os dados da consulta. Devolve o visual ou o motivo da recusa (com o que existe),
 * para o modelo corrigir o pedido.
 */
export function resolverVisual(entrada: unknown, resultados: ResultadoConsulta[]): { visual: Visual } | { erro: string } {
  const p = (entrada ?? {}) as Partial<Pedido>;
  if (!COMPONENTES.includes(p.componente as Componente)) return { erro: `Componente inválido. Use: ${COMPONENTES.join(", ")}.` };
  const comp = p.componente as Componente;
  const doNome = resultados.filter((r) => r.nome === p.consulta);
  if (!doNome.length) return { erro: `A consulta "${p.consulta}" não foi feita nesta resposta. Consultas feitas: ${[...new Set(resultados.map((r) => r.nome))].join(", ") || "nenhuma"}.` };
  const r = doNome[doNome.length - 1];
  const base = caminhar(r.dados, p.caminho);
  const titulo = String(p.titulo ?? "").trim().slice(0, 80) || humano(p.consulta ?? "");
  const comum = { titulo, origem: r.rotulo, fonte: r.fontes[0] ?? null };
  // Sem formato dito, o nome do campo decide (valor, total, saldo, em_aberto… são reais).
  const fmt = (f?: string, campo?: string): Formato => (FORMATOS.includes(f as Formato) ? (f as Formato) : campo && DINHEIRO.test(campo) ? "moeda" : campo && /dias|atraso/i.test(campo) ? "dias" : "numero");

  if (comp === "indicadores") {
    if (!base || typeof base !== "object" || Array.isArray(base)) return { erro: `Para indicadores, o caminho tem de levar a um objeto. Chaves do resultado: ${chavesDe(r.dados).join(", ")}.` };
    const obj = base as Record<string, unknown>;
    const itens = (p.campos ?? []).slice(0, LIMITE.indicadores).filter((c) => c?.campo && c.campo in obj && celula(obj[c.campo]) !== null)
      .map((c) => ({ rotulo: (c.rotulo || humano(c.campo)).slice(0, 40), valor: celula(obj[c.campo]), formato: fmt(c.formato, c.campo) }));
    if (!itens.length) return { erro: `Nenhum campo válido para indicadores. Campos disponíveis: ${Object.keys(obj).filter((k) => celula(obj[k]) !== null).join(", ")}.` };
    return { visual: { componente: "indicadores", ...comum, itens } };
  }
  // Mapa de contagens ({ "em produção": 12, "aguardando": 3 }): cada chave vira um item, sem pedir campos.
  if (comp !== "tabela" && comp !== "lista_de_datas" && base && typeof base === "object" && !Array.isArray(base)) {
    const pares = Object.entries(base as Record<string, unknown>).map(([k, v]) => ({ rotulo: humano(k).slice(0, 40), valor: numero(v) }));
    if (pares.length && pares.every((x) => x.valor !== null)) return montar(comp as "barras" | "linha" | "rosca", comum, fmt(p.formato), pares as { rotulo: string; valor: number }[]);
  }
  if (!Array.isArray(base)) return { erro: `O caminho "${p.caminho ?? ""}" não leva a uma lista. Listas no resultado: ${chavesDe(r.dados).filter((k) => Array.isArray((r.dados as Record<string, unknown>)[k])).join(", ") || "nenhuma"}.` };
  const lista = base.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
  if (!lista.length) return { erro: "A lista está vazia: responda só com o texto." };
  const existentes = camposDe(lista);

  if (comp === "tabela") {
    const cols = (p.campos ?? []).filter((c) => c?.campo && existentes.includes(c.campo)).slice(0, 4);
    if (!cols.length) return { erro: `Nenhuma coluna válida. Campos disponíveis: ${existentes.join(", ")}.` };
    return { visual: { componente: "tabela", ...comum, colunas: cols.map((c) => ({ rotulo: (c.rotulo || humano(c.campo)).slice(0, 30), formato: c.formato ? fmt(c.formato) : typeof lista[0]?.[c.campo] === "number" ? fmt(undefined, c.campo) : "texto" })),
      linhas: lista.slice(0, LIMITE.tabela).map((x) => cols.map((c) => celula(x[c.campo]))), total: lista.length } };
  }
  const campoRotulo = p.rotulo && existentes.includes(p.rotulo) ? p.rotulo : null;
  const campoValor = p.valor && existentes.includes(p.valor) ? p.valor : null;
  if (comp === "lista_de_datas") {
    const campoData = p.data && existentes.includes(p.data) ? p.data : null;
    if (!campoData || !campoRotulo) return { erro: `Para lista_de_datas, diga os campos "data" e "rotulo". Campos disponíveis: ${existentes.join(", ")}.` };
    const itens = lista.filter((x) => typeof x[campoData] === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(x[campoData]))).slice(0, LIMITE.lista_de_datas)
      .map((x) => ({ data: String(x[campoData]).slice(0, 10), rotulo: String(x[campoRotulo] ?? "").slice(0, 60), valor: campoValor ? numero(x[campoValor]) : null }));
    if (!itens.length) return { erro: `O campo "${campoData}" não tem datas.` };
    return { visual: { componente: "lista_de_datas", ...comum, formato: fmt(p.formato, campoValor ?? undefined), itens, total: lista.length } };
  }
  if (!campoRotulo || !campoValor) return { erro: `Para ${comp}, diga os campos "rotulo" e "valor". Campos disponíveis: ${existentes.join(", ")}.` };
  const pontos = lista.map((x) => ({ rotulo: String(x[campoRotulo] ?? "—").slice(0, 40), valor: numero(x[campoValor]) })).filter((x): x is { rotulo: string; valor: number } => x.valor !== null);
  if (!pontos.length) return { erro: `O campo "${campoValor}" não é numérico.` };
  return montar(comp as "barras" | "linha" | "rosca", comum, fmt(p.formato, campoValor), pontos);
}

function montar(comp: "barras" | "linha" | "rosca", comum: { titulo: string; origem: string; fonte: Fonte | null }, formato: Formato, pontos: { rotulo: string; valor: number }[]): { visual: Visual } {
  let lim = pontos.slice(0, LIMITE[comp]);
  // Rosca: as maiores fatias e o resto em "Outros", para a soma continuar certa.
  if (comp === "rosca" && pontos.length > LIMITE.rosca) {
    const ord = [...pontos].sort((a, b) => b.valor - a.valor);
    lim = [...ord.slice(0, LIMITE.rosca - 1), { rotulo: `Outros (${ord.length - LIMITE.rosca + 1})`, valor: ord.slice(LIMITE.rosca - 1).reduce((s, x) => s + x.valor, 0) }];
  }
  return { visual: { componente: comp, ...comum, formato, pontos: lim, total: comp === "rosca" ? lim.length : pontos.length } };
}
