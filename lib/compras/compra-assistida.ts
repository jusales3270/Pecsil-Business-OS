/**
 * Compra assistida (24/10/2026): a SARA do Compras sugere a quem pedir preço e avisa quando uma cotação
 * sai da curva das compras anteriores. Regras puras, sem banco e sem modelo.
 *
 * Quase nenhuma compra antiga está ligada ao catálogo de materiais (2 de 374 em 24/10), então o mesmo
 * item é achado pelo NOME: as palavras do pedido têm de estar todas no nome comprado e, dos números (bitola,
 * teor, espessura, parte), ao menos metade para sugerir fornecedor e todos para comparar preço.
 * "Ferro molibdênio 10/60" casa com "FERRO MOLIBDÊNIO (60/65%) 10/60 MM"; "Resina CCS 10 parte I" não casa
 * com "Resina CCS 20 parte II"; para o preço, o calibre de 0,02 mm não é o de 0,05 mm.
 */

const PARADAS = new Set(["de", "da", "do", "das", "dos", "p", "para", "com", "sem", "em", "e", "ou", "a", "o", "ref", "tipo", "x", "art", "cod", "codigo", "n", "no", "nº"]);
const MEDIDAS = new Set(["mm", "cm", "m", "kg", "g", "t", "l", "ml", "un", "und", "pc", "pcs", "cx", "m3", "m²", "m2", "pol"]);
const ROMANOS = new Set(["i", "ii", "iii", "iv", "v", "vi"]);

export const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "UN", "Pc", "peça" → "un"; "m³" → "m3". Unidades diferentes não se comparam. */
export function unidadeNormal(u: unknown): string {
  const x = semAcento(u).replace(/³/g, "3").replace(/[^a-z0-9]/g, "");
  if (["un", "und", "unid", "unidade", "pc", "pca", "peca", "pcs"].includes(x)) return "un";
  if (["kg", "kgs", "quilo"].includes(x)) return "kg";
  if (["l", "lt", "litro", "litros"].includes(x)) return "l";
  return x || "un";
}

/**
 * Palavras e números que identificam o item. A quantidade que o sistema põe no fim ("- 200 kg") sai; o
 * decimal fica inteiro ("0,02" é 0.02, não 0 e 2); medida de comprimento conta como número ("115MM", "5M"),
 * peso e volume de embalagem não ("TB 210KG").
 */
export function termos(texto: unknown): { palavras: string[]; numeros: string[] } {
  const t = semAcento(texto).replace(/³/g, "3").replace(/\s+-\s+\d+([.,]\d+)?\s*[a-z0-9]{0,3}\s*$/, "").replace(/(\d)[.,](\d)/g, "$1d$2");
  const palavras: string[] = [], numeros: string[] = [];
  const numero = (n: string) => { const v = String(Number(n.replace("d", "."))); if (!numeros.includes(v)) numeros.push(v); };
  for (const tok of t.split(/[^a-z0-9]+/)) {
    if (!tok || PARADAS.has(tok) || MEDIDAS.has(tok)) continue;
    const m = /^(\d+(?:d\d+)?)(mm|cm|m|kg|g|l|ml|m3)?$/.exec(tok);
    if (m) { if (!m[2] || ["mm", "cm", "m"].includes(m[2])) numero(m[1]); continue; }
    if (tok.length < 2 && !ROMANOS.has(tok)) continue;
    if (!palavras.includes(tok)) palavras.push(tok);
  }
  return { palavras, numeros };
}

/**
 * O nome comprado é o mesmo item do pedido? Todas as palavras do pedido; dos números, ao menos metade
 * (padrão, para sugerir fornecedor) ou todos os do nome mais curto (`exato`, para comparar preço).
 */
export function mesmoItem(pedido: unknown, comprado: unknown, { exato = false } = {}): boolean {
  const a = termos(pedido), b = termos(comprado);
  if (!a.palavras.length) return false;
  if (!a.palavras.every((p) => b.palavras.includes(p))) return false;
  if (exato) {
    // Os números do nome mais curto têm de estar todos no outro (o código do fabricante pode faltar num deles).
    const [menor, maior] = a.numeros.length <= b.numeros.length ? [a.numeros, b.numeros] : [b.numeros, a.numeros];
    return menor.every((n) => maior.includes(n));
  }
  return a.numeros.filter((n) => b.numeros.includes(n)).length * 2 >= a.numeros.length;
}

export type Comprado = { produto: string; fornecedor: string; fornecedor_id: string | null; cnpj: string | null; preco: number; unidade: string | null; data: string };
export type Cotado = { produto: string; fornecedor: string; fornecedor_id: string | null; cnpj: string | null; preco: number | null; unidade: string | null; data: string; status: string };

export type Sugestao = {
  fornecedor: string; fornecedor_id: string | null; cnpj: string | null;
  /** Itens do pedido que esse fornecedor já vendeu ou cotou. */
  itens: string[];
  compras: number; cotacoes: number;
  ultima: string;
  /** Último preço pago por item do pedido, na unidade da compra. */
  precos: { item: string; ultimo: number; unidade: string; em: string }[];
};

/**
 * Quem já vendeu (ou cotou) os itens do pedido, do que cobre mais itens para o que cobre menos; no empate,
 * quem vendeu mais vezes e mais recentemente. Venda vale mais que cotação. Até `max` fornecedores.
 */
export function sugerirFornecedores(itens: string[], comprados: Comprado[], cotados: Cotado[], max = 5): Sugestao[] {
  const por = new Map<string, Sugestao>();
  const chave = (x: { fornecedor: string; fornecedor_id: string | null }) => x.fornecedor_id ?? semAcento(x.fornecedor).trim();
  const pegar = (x: { fornecedor: string; fornecedor_id: string | null; cnpj: string | null }) => {
    const k = chave(x);
    let s = por.get(k);
    if (!s) por.set(k, (s = { fornecedor: x.fornecedor, fornecedor_id: x.fornecedor_id, cnpj: x.cnpj, itens: [], compras: 0, cotacoes: 0, ultima: "", precos: [] }));
    return s;
  };
  for (const item of itens) {
    for (const c of comprados.filter((c) => mesmoItem(item, c.produto)).sort((x, y) => y.data.localeCompare(x.data))) {
      const s = pegar(c);
      if (!s.itens.includes(item)) s.itens.push(item);
      s.compras++;
      if (c.data > s.ultima) s.ultima = c.data;
      if (!s.precos.some((p) => p.item === item)) s.precos.push({ item, ultimo: c.preco, unidade: unidadeNormal(c.unidade), em: c.data });
    }
    for (const c of cotados.filter((c) => mesmoItem(item, c.produto))) {
      const s = pegar(c);
      if (!s.itens.includes(item)) s.itens.push(item);
      s.cotacoes++;
      if (c.data > s.ultima) s.ultima = c.data;
    }
  }
  return [...por.values()]
    .sort((a, b) => b.itens.length - a.itens.length || b.compras - a.compras || b.cotacoes - a.cotacoes || b.ultima.localeCompare(a.ultima))
    .slice(0, max);
}

export const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type ForaDaCurva = { referencia: number; acima: number; compras: number; unidade: string };

/**
 * O preço cotado está fora da curva? Compara com a mediana das últimas `ultimas` compras do mesmo item, na
 * mesma unidade. Precisa de ao menos `minimo` compras; avisa a partir de `limiar` acima (15%).
 */
export function foraDaCurva(produto: string, preco: number, unidade: unknown, comprados: Comprado[], { limiar = 0.15, minimo = 2, ultimas = 6 } = {}): ForaDaCurva | null {
  if (!(preco > 0)) return null;
  const u = unidadeNormal(unidade);
  const precos = comprados.filter((c) => c.preco > 0 && unidadeNormal(c.unidade) === u && mesmoItem(produto, c.produto, { exato: true }))
    .sort((a, b) => b.data.localeCompare(a.data)).slice(0, ultimas).map((c) => c.preco);
  if (precos.length < minimo) return null;
  const referencia = mediana(precos);
  const acima = preco / referencia - 1;
  return acima >= limiar ? { referencia, acima, compras: precos.length, unidade: u } : null;
}
