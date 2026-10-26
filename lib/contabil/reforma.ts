/**
 * Simulador da reforma tributária (N-11): o que acontece com uma venda (um orçamento, ou um valor com a máscara de
 * impostos) de 2026 a 2033. Puro, sem modelo: as premissas vêm dos parâmetros legais (reforma_2026_fase_teste,
 * reforma_2027, reforma_2029_2033, reforma_aliquota_referencia) e quem usa pode trocar qualquer uma (a CBS de 2027
 * sai por Resolução do Senado). Tudo é estimativa e a tela diz isso.
 *
 * O jeito de contar, igual ao da emissão (lib/fiscal/emissao/calculo.ts):
 * - o valor dos produtos leva ICMS e PIS/COFINS "por dentro"; IPI, CBS e IBS vão "por fora";
 * - a base do IBS/CBS é o valor dos produtos menos ICMS, PIS e COFINS (LC 214 art. 12), ou seja, a receita líquida;
 * - em 2026 CBS e IBS só são destacados e não somam na nota (fase de teste, recolhimento dispensado).
 */

export type Premissas = {
  /** Alíquotas de referência (fração): CBS e IBS plenos. */
  cbsReferencia: number;
  ibsReferencia: number;
  /** CBS em 2027–2028 = referência menos isto (0,1 p.p. = 0,001). */
  reducaoCbs2027: number;
  /** Fase de teste 2026 e IBS de 2027–2028. */
  cbs2026: number;
  ibs2026: number;
  ibs2027: number;
  /** Quanto do ICMS sobra em cada ano da transição (2029: 0,9 … 2032: 0,6; 2033: 0). */
  fatorIcms: Record<number, number>;
};
export type Impostos = { icms: number; reducaoBaseIcms: number; ipi: number; pis: number; cofins: number; pisCofinsExcluiIcms: boolean };
export type Ano = {
  ano: number; produtos: number; icms: number; ipi: number; pis: number; cofins: number; cbs: number; ibs: number;
  totalNota: number; receitaLiquida: number; tributos: number; cargaSobreNota: number; variacaoNota: number; ibsCbsNaNota: boolean;
};

export const ANOS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033] as const;
const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;

/** Alíquotas do ano (fração). */
export function aliquotasDoAno(ano: number, p: Premissas, imp: Impostos) {
  const fator = ano <= 2028 ? 1 : ano >= 2033 ? 0 : p.fatorIcms[ano] ?? 1;
  const icms = (imp.icms / 100) * (1 - imp.reducaoBaseIcms / 100) * fator;
  const antes2027 = ano <= 2026;
  return {
    icms, ipi: antes2027 ? imp.ipi / 100 : 0,
    pis: antes2027 ? imp.pis / 100 : 0, cofins: antes2027 ? imp.cofins / 100 : 0,
    cbs: antes2027 ? p.cbs2026 : ano <= 2028 ? p.cbsReferencia - p.reducaoCbs2027 : p.cbsReferencia,
    ibs: antes2027 ? p.ibs2026 : ano <= 2028 ? p.ibs2027 : p.ibsReferencia * (1 - fator),
    ibsCbsNaNota: !antes2027,
  };
}

/**
 * A venda em cada ano. `manter`: "receita" acha o valor dos produtos que deixa a mesma receita líquida de 2026
 * (o preço que a empresa precisa cobrar); "preco" mantém o valor dos produtos e mostra quanto a receita muda.
 */
export function simular(valor2026: number, imp: Impostos, p: Premissas, manter: "receita" | "preco"): Ano[] {
  const fracaoDentro = (a: ReturnType<typeof aliquotasDoAno>) => a.icms + (a.pis + a.cofins) * (imp.pisCofinsExcluiIcms ? 1 - a.icms : 1);
  const a26 = aliquotasDoAno(2026, p, imp);
  const receita2026 = valor2026 * (1 - fracaoDentro(a26));
  const base = ANOS.map((ano) => {
    const a = aliquotasDoAno(ano, p, imp);
    const produtos = manter === "receita" ? receita2026 / (1 - fracaoDentro(a)) : valor2026;
    const icms = produtos * a.icms;
    const pis = (produtos - (imp.pisCofinsExcluiIcms ? icms : 0)) * a.pis;
    const cofins = (produtos - (imp.pisCofinsExcluiIcms ? icms : 0)) * a.cofins;
    const receitaLiquida = produtos - icms - pis - cofins;
    const ipi = produtos * a.ipi, cbs = receitaLiquida * a.cbs, ibs = receitaLiquida * a.ibs;
    const totalNota = produtos + ipi + (a.ibsCbsNaNota ? cbs + ibs : 0);
    const tributos = icms + pis + cofins + ipi + (a.ibsCbsNaNota ? cbs + ibs : 0);
    return { ano, produtos: r2(produtos), icms: r2(icms), ipi: r2(ipi), pis: r2(pis), cofins: r2(cofins), cbs: r2(cbs), ibs: r2(ibs), totalNota: r2(totalNota), receitaLiquida: r2(receitaLiquida), tributos: r2(tributos), ibsCbsNaNota: a.ibsCbsNaNota };
  });
  const nota2026 = base[0].totalNota;
  return base.map((b) => ({ ...b, cargaSobreNota: b.totalNota ? b.tributos / b.totalNota : 0, variacaoNota: nota2026 ? b.totalNota / nota2026 - 1 : 0 }));
}

/**
 * O caixa da venda em 2026 e em 2027 com split payment. Hoje a empresa recebe a nota inteira no prazo do cliente e
 * paga os tributos no mês seguinte (dia 25, cerca de `diasTributo` depois da emissão), mesmo que o cliente ainda
 * não tenha pago. Com o split payment, o IBS/CBS da nota sai direto do pagamento do cliente, no mesmo dia; os
 * créditos da empresa voltam pela apuração. O ICMS segue como hoje.
 */
export function caixa(anos: Ano[], prazoCliente: number, diasTributo = 40) {
  const a26 = anos.find((a) => a.ano === 2026)!, a27 = anos.find((a) => a.ano === 2027)!;
  const hoje = { recebe: a26.totalNota, recebeEm: prazoCliente, paga: a26.tributos, pagaEm: diasTributo };
  const split = { recebe: r2(a27.totalNota - a27.cbs - a27.ibs), recebeEm: prazoCliente, retidoNoPagamento: r2(a27.cbs + a27.ibs), paga: r2(a27.icms + a27.ipi), pagaEm: diasTributo };
  // Quantos dias a empresa banca o tributo antes de receber (negativo = recebe antes de pagar).
  const financiaHoje = Math.max(0, prazoCliente - diasTributo);
  return { hoje, split, financiaHoje, tributoFinanciadoHoje: financiaHoje > 0 ? a26.tributos : 0, tributoFinanciado2027: financiaHoje > 0 ? split.paga : 0 };
}

/** Saldo credor de ICMS em 31/12/2032: compensação com o IBS em 240 parcelas mensais, corrigidas pelo IPCA. */
export const parcelaDoSaldoIcms = (saldo: number) => r2(saldo / 240);

/** Premissas a partir dos parâmetros legais (linhas de contabil_parametros); o que não vier em número fica no padrão da lei. */
export function premissasDosParametros(linhas: readonly { chave: string; valor: unknown; situacao: string; fonte?: { norma?: string } | null }[]): { premissas: Premissas; aConferir: boolean; fontes: string[] } {
  const v = (chave: string) => linhas.find((l) => l.chave === chave);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const ref = v("reforma_aliquota_referencia")?.valor as { ibs?: unknown; cbs_por_diferenca?: unknown; estimativa_total?: unknown } | undefined;
  const t26 = v("reforma_2026_fase_teste")?.valor as { cbs?: unknown; ibs?: unknown } | undefined;
  const tr = (v("reforma_2029_2033")?.valor as { transicao_icms_iss?: Record<string, unknown> } | undefined)?.transicao_icms_iss ?? {};
  const ibs = n(ref?.ibs) ?? 0.187;
  const premissas: Premissas = {
    ibsReferencia: ibs,
    cbsReferencia: n(ref?.cbs_por_diferenca) ?? (n(ref?.estimativa_total) ?? 0.2791) - ibs,
    reducaoCbs2027: 0.001, cbs2026: n(t26?.cbs) ?? 0.009, ibs2026: n(t26?.ibs) ?? 0.001, ibs2027: 0.001,
    fatorIcms: { 2029: n(tr["2029"]) ?? 0.9, 2030: n(tr["2030"]) ?? 0.8, 2031: n(tr["2031"]) ?? 0.7, 2032: n(tr["2032"]) ?? 0.6 },
  };
  const usadas = ["reforma_aliquota_referencia", "reforma_2026_fase_teste", "reforma_2027", "reforma_2029_2033"].map(v).filter(Boolean) as { situacao: string; fonte?: { norma?: string } | null }[];
  return { premissas, aConferir: usadas.length < 4 || usadas.some((u) => u.situacao !== "conferido"), fontes: usadas.map((u) => u.fonte?.norma ?? "").filter(Boolean) };
}
