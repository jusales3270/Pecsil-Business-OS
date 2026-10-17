/**
 * Comparativo de cotações do mesmo pedido de material (A-07): selos de melhor preço, melhor prazo de
 * entrega e melhor prazo de pagamento, a regra de decisão "primeiro quem entrega no prazo, depois o
 * menor custo" e a economia (saving) que fica gravada na Ordem de Compra. Só regra, sem banco e sem
 * React: a tela e a gravação usam a mesma conta.
 */

export type ItemProposta = { produto: string; materialId?: string | null; quantidade: number; valorUnit: number; ipi: number; prazo: string | null };
export type Proposta = { cotacaoId: number; fornecedor: string; prazoEntrega: string | null; itens: ItemProposta[] };
export type Selo = "preco" | "entrega" | "pagamento";
export type LinhaComparativo = {
  cotacaoId: number; fornecedor: string; total: number; prazoEntrega: string | null; diasPagamento: number | null;
  noPrazo: boolean | null; selos: Selo[]; recomendada: boolean;
};

const dinheiro = (n: number) => Math.round(n * 100) / 100;

/** "30/60/90 DDL" → 60 (a média dos dias); "à vista" → 0; sem número → null. */
export function diasPagamento(texto: string | null | undefined): number | null {
  const t = (texto ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/vista|antecipad/.test(t)) return 0;
  const nums = [...t.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 0 && n <= 365);
  return nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : null;
}

/** Total da proposta: itens com o IPI por cima (o ICMS já está no preço). */
export function totalProposta(p: Proposta): number {
  return dinheiro(p.itens.reduce((s, i) => s + i.quantidade * i.valorUnit * (1 + (i.ipi || 0) / 100), 0));
}

/** Prazo de pagamento da proposta: o do primeiro item que informa (a OC usa o mesmo). */
export function pagamentoDaProposta(p: Proposta): number | null {
  for (const i of p.itens) { const d = diasPagamento(i.prazo); if (d !== null) return d; }
  return null;
}

/**
 * Compara as propostas do mesmo pedido. Selo de preço: menor total; de entrega: data mais cedo; de
 * pagamento: mais dias. Recomendada pela regra: entre as que entregam até "precisa até", a de menor
 * total; sem data no pedido, todas contam como no prazo; se nenhuma entrega no prazo, a que chega
 * primeiro (e a tela avisa).
 */
export function comparar(propostas: Proposta[], precisaAte: string | null): { linhas: LinhaComparativo[]; ninguemNoPrazo: boolean } {
  const base = propostas.map((p) => ({
    cotacaoId: p.cotacaoId, fornecedor: p.fornecedor, total: totalProposta(p), prazoEntrega: p.prazoEntrega, diasPagamento: pagamentoDaProposta(p),
    noPrazo: precisaAte ? (p.prazoEntrega ? p.prazoEntrega.slice(0, 10) <= precisaAte : false) : null,
  }));
  const menorTotal = Math.min(...base.map((b) => b.total));
  const datas = base.map((b) => b.prazoEntrega?.slice(0, 10)).filter((d): d is string => Boolean(d)).sort();
  const pagamentos = base.map((b) => b.diasPagamento).filter((d): d is number => d !== null);
  const maiorPagamento = pagamentos.length ? Math.max(...pagamentos) : null;
  const candidatas = precisaAte ? base.filter((b) => b.noPrazo) : base;
  const ninguemNoPrazo = Boolean(precisaAte) && candidatas.length === 0;
  const escolhida = ninguemNoPrazo
    ? [...base].sort((a, b) => (a.prazoEntrega ?? "9999").localeCompare(b.prazoEntrega ?? "9999") || a.total - b.total)[0]
    : [...candidatas].sort((a, b) => a.total - b.total || (a.prazoEntrega ?? "9999").localeCompare(b.prazoEntrega ?? "9999"))[0];
  const linhas = base.map((b) => ({
    ...b,
    selos: [
      ...(base.length > 1 && b.total === menorTotal ? ["preco" as const] : []),
      ...(base.length > 1 && datas.length && b.prazoEntrega?.slice(0, 10) === datas[0] ? ["entrega" as const] : []),
      ...(base.length > 1 && maiorPagamento !== null && b.diasPagamento === maiorPagamento ? ["pagamento" as const] : []),
    ],
    recomendada: base.length > 1 && escolhida?.cotacaoId === b.cotacaoId,
  }));
  return { linhas, ninguemNoPrazo };
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const mesmoItem = (a: ItemProposta, b: { produto: string; materialId?: string | null }) =>
  a.materialId && b.materialId ? a.materialId === b.materialId : normal(a.produto) === normal(b.produto);

export type CompraAnterior = { produto: string; materialId?: string | null; valorUnit: number; data: string };
export type Saving = {
  /** Quanto a mais custaria pela maior cotação concorrente (mesmos itens). */
  vsMaior: number;
  /** Diferença para a última compra dos mesmos itens (positivo = economizou; negativo = pagou mais). */
  vsUltimaCompra: number | null;
  /** Dias de pagamento a mais que a concorrente de prazo mais curto. */
  ganhoPagamentoDias: number | null;
  concorrentes: number;
  itensComparados: number;
};

/** Economia da proposta escolhida, gravada na OC na aprovação. */
export function calcularSaving(escolhida: Proposta, concorrentes: Proposta[], comprasAnteriores: CompraAnterior[], antesDe: string): Saving {
  let vsMaior = 0, comparados = 0, vsUltima = 0, comUltima = 0;
  for (const item of escolhida.itens) {
    const precos = concorrentes.flatMap((c) => c.itens.filter((i) => mesmoItem(i, item)).map((i) => i.valorUnit));
    if (precos.length) { comparados++; vsMaior += Math.max(0, Math.max(...precos) - item.valorUnit) * item.quantidade; }
    const ultima = comprasAnteriores.filter((c) => c.data < antesDe && mesmoItem(item, c)).sort((a, b) => b.data.localeCompare(a.data))[0];
    if (ultima) { comUltima++; vsUltima += (ultima.valorUnit - item.valorUnit) * item.quantidade; }
  }
  const meu = pagamentoDaProposta(escolhida);
  const outros = concorrentes.map(pagamentoDaProposta).filter((d): d is number => d !== null);
  return {
    vsMaior: dinheiro(vsMaior),
    vsUltimaCompra: comUltima ? dinheiro(vsUltima) : null,
    ganhoPagamentoDias: meu !== null && outros.length ? meu - Math.min(...outros) : null,
    concorrentes: concorrentes.length,
    itensComparados: comparados,
  };
}
