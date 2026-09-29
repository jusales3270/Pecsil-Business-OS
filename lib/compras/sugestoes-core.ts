/**
 * Sugestões ao digitar fornecedor ou produto no Compras (regras puras).
 *
 * O objetivo é padronizar: quem digita "caixa mad" recebe a descrição que já
 * existe no histórico, escrita do jeito mais usado, em vez de criar mais uma
 * variação do mesmo produto.
 */
import { normalizeName } from "./fornecedores-core";

export type Suggestion = {
  /** Texto que entra no campo ao escolher. */
  value: string;
  /** Linha de apoio (ex.: "12 compras · última 22/09/2026"). */
  hint?: string;
  /** Outros nomes que também encontram esta sugestão (apelidos unificados). */
  alsoMatches?: string[];
  /** Relevância: mais usado / mais recente pesa mais. */
  weight: number;
  /** Dados extras para quem escolhe (ex.: unidade do produto). */
  meta?: Record<string, unknown>;
};

/**
 * Filtra e ordena as sugestões para o que foi digitado. Começo do nome vale
 * mais que começo de palavra, que vale mais que trecho no meio. Menos de 2
 * letras não sugere nada (lista inteira só atrapalha).
 */
export function rankSuggestions(query: string, items: readonly Suggestion[], limit = 8): Suggestion[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const scored: { item: Suggestion; score: number }[] = [];
  for (const item of items) {
    let best = 0;
    for (const text of [item.value, ...(item.alsoMatches ?? [])]) {
      const key = normalizeName(text);
      if (key === q) best = Math.max(best, 4);
      else if (key.startsWith(q)) best = Math.max(best, 3);
      else if (key.split(" ").some((word) => word.startsWith(q))) best = Math.max(best, 2);
      else if (key.includes(q)) best = Math.max(best, 1);
    }
    if (best > 0) scored.push({ item, score: best });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.item.weight - a.item.weight || a.item.value.localeCompare(b.item.value, "pt-BR"))
    .slice(0, limit)
    .map((s) => s.item);
}

/** Nada a sugerir quando o texto já é exatamente a única sugestão. */
export function isExactOnly(query: string, list: readonly Suggestion[]): boolean {
  return list.length === 1 && normalizeName(list[0].value) === normalizeName(query);
}

export type ProductEntry = {
  produto: string;
  unidade?: string | null;
  fornecedor?: string | null;
  supplierId?: string | null;
  valorUnit?: number | null;
  data: string;
};

export type ProductSuggestionMeta = {
  unidade: string | null;
  ultimoValor: number | null;
  ultimoFornecedor: string | null;
  ultimaData: string;
  usos: number;
  fornecedores: string[];
};

/**
 * Catálogo de produtos a partir do histórico (itens de cotação e compras).
 * Agrupa pelo nome normalizado; a descrição sugerida é a grafia mais usada
 * (empate: a mais recente). Traz unidade e último preço como apoio.
 */
export function productCatalog(entries: readonly ProductEntry[]): (Suggestion & { meta: ProductSuggestionMeta })[] {
  const groups = new Map<string, ProductEntry[]>();
  for (const entry of entries) {
    const key = normalizeName(entry.produto);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((list) => {
    const ordered = [...list].sort((a, b) => a.data.localeCompare(b.data));
    const last = ordered[ordered.length - 1];
    const spellings = new Map<string, { count: number; lastData: string }>();
    for (const e of ordered) {
      const text = e.produto.trim();
      const cur = spellings.get(text) ?? { count: 0, lastData: "" };
      spellings.set(text, { count: cur.count + 1, lastData: e.data > cur.lastData ? e.data : cur.lastData });
    }
    const value = [...spellings.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastData.localeCompare(a[1].lastData))[0][0];
    const priced = [...ordered].reverse().find((e) => (e.valorUnit ?? 0) > 0);
    const fornecedores = [...new Set(ordered.map((e) => e.supplierId ?? "").filter(Boolean))];
    return {
      value,
      alsoMatches: [...spellings.keys()].filter((s) => s !== value),
      weight: ordered.length * 1000 + Date.parse(last.data || "1970-01-01") / 1e10,
      meta: {
        unidade: last.unidade ?? null,
        ultimoValor: priced?.valorUnit ?? null,
        ultimoFornecedor: priced?.fornecedor ?? null,
        ultimaData: last.data,
        usos: ordered.length,
        fornecedores,
      },
    };
  });
}
