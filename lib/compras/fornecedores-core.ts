/**
 * Regras puras de Compras › Fornecedores (sem banco): sugestão de duplicados,
 * histórico de preço por produto e validação do cadastro.
 */

/** Mesma normalização de `public.normalize_party_name` (banco). */
export function normalizeName(raw: string | null | undefined): string {
  const from = "áàâãäéèêëíìîïóòôõöúùûüçñ.,;:/\\-_()\"'";
  const to = "aaaaaeeeeiiiiooooouuuucn              ";
  let text = (raw ?? "").toLowerCase();
  text = [...text].map((ch) => {
    const i = from.indexOf(ch);
    return i >= 0 ? to[i] : ch;
  }).join("");
  return text.replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

/** Semelhança de 0 a 1 entre dois nomes normalizados. */
export function nameSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - levenshtein(a, b) / longest : 1;
}

export type DuplicateSuggestion = { a: string; b: string; score: number };

/**
 * Possíveis duplicados: nomes com semelhança ≥ 0,75 ("MERCOBRONZE"/"MERCOBROZE")
 * ou com a mesma primeira palavra de mais de 3 letras ("OTZI"/"OTZI METALS").
 * Só sugere — quem decide é a equipe, na tela.
 */
export function suggestDuplicates(suppliers: readonly { id: string; name: string }[]): DuplicateSuggestion[] {
  const items = suppliers.map((s) => ({ id: s.id, key: normalizeName(s.name) })).filter((s) => s.key);
  const found: DuplicateSuggestion[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const score = nameSimilarity(a.key, b.key);
      const first = a.key.split(" ")[0];
      const samePrefix = first.length > 3 && first === b.key.split(" ")[0];
      if (score >= 0.75 || samePrefix) found.push({ a: a.id, b: b.id, score: Math.round(score * 100) / 100 });
    }
  }
  return found.sort((x, y) => y.score - x.score);
}

export type PricePoint = { produto: string; valorUnit: number; quantidade: number; unidade?: string | null; data: string };
export type ProductPrice = {
  produto: string;
  unidade: string | null;
  compras: number;
  quantidadeTotal: number;
  ultimo: number;
  ultimaData: string;
  menor: number;
  maior: number;
  /** Variação do último preço sobre o primeiro, em % (null com uma compra só). */
  variacao: number | null;
};

/**
 * Preço por produto ao longo do tempo. O produto é agrupado pelo nome
 * normalizado; o texto exibido é o da compra mais recente.
 */
export function priceHistory(points: readonly PricePoint[]): ProductPrice[] {
  const groups = new Map<string, PricePoint[]>();
  for (const p of points) {
    const key = normalizeName(p.produto);
    if (!key || !(p.valorUnit > 0)) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()]
    .map((list) => {
      const ordered = [...list].sort((x, y) => x.data.localeCompare(y.data));
      const first = ordered[0], last = ordered[ordered.length - 1];
      const values = ordered.map((p) => p.valorUnit);
      return {
        produto: last.produto,
        unidade: last.unidade ?? null,
        compras: ordered.length,
        quantidadeTotal: ordered.reduce((sum, p) => sum + (p.quantidade || 0), 0),
        ultimo: last.valorUnit,
        ultimaData: last.data,
        menor: Math.min(...values),
        maior: Math.max(...values),
        variacao: ordered.length > 1 ? Math.round(((last.valorUnit - first.valorUnit) / first.valorUnit) * 1000) / 10 : null,
      };
    })
    .sort((x, y) => y.ultimaData.localeCompare(x.ultimaData));
}

/** Campos editáveis do cadastro (nome da coluna no banco). */
export const SUPPLIER_TEXT_FIELDS = {
  name: "name",
  legalName: "legal_name",
  tradeName: "trade_name",
  stateRegistration: "state_registration",
  contactName: "contact_name",
  phone: "phone",
  email: "email",
  address: "address",
  city: "city",
  paymentTerms: "payment_terms",
  category: "category",
  notes: "notes",
} as const;

export type SupplierInput = Partial<Record<keyof typeof SUPPLIER_TEXT_FIELDS, string | null>> & {
  taxId?: string | null;
  state?: string | null;
  divisions?: string[];
  active?: boolean;
};

/** Valida o que veio da tela e devolve as colunas a gravar, ou o erro para mostrar. */
export function supplierChanges(body: SupplierInput): { changes: Record<string, unknown> } | { error: string } {
  const changes: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(SUPPLIER_TEXT_FIELDS)) {
    const value = body[field as keyof typeof SUPPLIER_TEXT_FIELDS];
    if (value === undefined) continue;
    const text = typeof value === "string" ? value.trim() : "";
    if (field === "name" && !text) return { error: "Informe o nome do fornecedor." };
    if (field === "email" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: "E-mail inválido." };
    changes[column] = text || null;
  }
  if (body.taxId !== undefined) {
    const digits = String(body.taxId ?? "").replace(/\D/g, "");
    if (digits && digits.length !== 14 && digits.length !== 11) return { error: "CNPJ (14 dígitos) ou CPF (11 dígitos) inválido." };
    changes.tax_id = digits || null;
  }
  if (body.state !== undefined) {
    const uf = String(body.state ?? "").trim().toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) return { error: "UF inválida (use a sigla, ex.: SP)." };
    changes.state = uf || null;
  }
  if (body.divisions !== undefined) {
    const divisions = Array.isArray(body.divisions) ? body.divisions : [];
    if (divisions.some((d) => d !== "USINAGEM" && d !== "FUNDICAO")) return { error: "Divisão inválida." };
    changes.divisions = [...new Set(divisions)];
  }
  if (typeof body.active === "boolean") changes.active = body.active;
  return { changes };
}
