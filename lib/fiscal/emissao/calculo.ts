/**
 * Cálculo dos impostos por item e dos totais da NF-e (centavo a centavo). Puro e testável.
 *
 * - vProd = quantidade × valor unitário (arredondado a 2 casas).
 * - Frete, seguro e outras despesas são rateados pelos itens na proporção do vProd; o último
 *   item leva a diferença de centavos, para a soma fechar exatamente.
 * - Base do ICMS = vProd − desconto + frete + seguro + outras (+ IPI quando o destinatário é
 *   consumidor final), reduzida pelo % de redução da base.
 * - IPI: base = vProd − desconto + frete + seguro + outras.
 * - PIS/COFINS: base = vProd − desconto (− ICMS quando a máscara manda excluir).
 * - IBS/CBS (2026, como o GRV emite): base = vProd − desconto − ICMS − PIS − COFINS, só nos CST que
 *   tributam (000…); IBS da UF e CBS pelas alíquotas da máscara. Não somam no vNF em 2026.
 * - vNF = vProd − vDesc + vFrete + vSeg + vOutro + vIPI (sem ST nesta etapa).
 */
import type { ItemNfe, NotaNfe, Totais, TotaisItem } from "./tipos";

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** CST de ICMS que destacam imposto (regime normal) e CSOSN com crédito/destaque (Simples). */
const ICMS_TRIBUTADO = new Set(["00", "20", "90", "101", "900"]);
const IPI_TRIBUTADO = new Set(["50", "00", "49", "99"]);
const PIS_COFINS_ALIQ = new Set(["01", "02", "49", "99"]);

function ratear(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (!total || !soma) return pesos.map(() => 0);
  const partes = pesos.map((p) => r2((total * p) / soma));
  const dif = r2(total - partes.reduce((a, b) => a + b, 0));
  partes[partes.length - 1] = r2(partes[partes.length - 1] + dif);
  return partes;
}

export function calcularItens(nota: Pick<NotaNfe, "itens" | "frete" | "seguro" | "outrasDespesas" | "consumidorFinal">): TotaisItem[] {
  const vProds = nota.itens.map((i: ItemNfe) => r2(i.quantidade * i.valorUnitario));
  const fretes = ratear(r2(nota.frete.valor || 0), vProds);
  const seguros = ratear(r2(nota.seguro || 0), vProds);
  const outros = ratear(r2(nota.outrasDespesas || 0), vProds);
  return nota.itens.map((i, k) => {
    const vProd = vProds[k];
    const vDesc = r2(i.desconto || 0);
    const acessorias = fretes[k] + seguros[k] + outros[k];
    const vBCIPI = IPI_TRIBUTADO.has(i.ipiCst) ? r2(vProd - vDesc + acessorias) : 0;
    const vIPI = IPI_TRIBUTADO.has(i.ipiCst) ? r2((vBCIPI * (i.ipiAliquota || 0)) / 100) : 0;
    const baseCheia = vProd - vDesc + acessorias + (nota.consumidorFinal ? vIPI : 0);
    const vBC = ICMS_TRIBUTADO.has(i.icmsCst) && i.icmsCst !== "101" ? r2(baseCheia * (1 - (i.icmsReducaoBase || 0) / 100)) : 0;
    const vICMS = vBC ? r2((vBC * (i.icmsAliquota || 0)) / 100) : 0;
    const basePisCofins = r2(vProd - vDesc - (i.pisCofinsExcluiIcms ? vICMS : 0));
    const vPIS = PIS_COFINS_ALIQ.has(i.pisCst) ? r2((basePisCofins * (i.pisAliquota || 0)) / 100) : 0;
    const vCOFINS = PIS_COFINS_ALIQ.has(i.cofinsCst) ? r2((basePisCofins * (i.cofinsAliquota || 0)) / 100) : 0;
    const ibsCbs = ibsCbsTributa(i.ibsCbsCst);
    const vBCIBSCBS = ibsCbs ? r2(vProd - vDesc - vICMS - vPIS - vCOFINS) : 0;
    const vIBS = ibsCbs ? r2((vBCIBSCBS * (i.ibsAliquota || 0)) / 100) : 0;
    const vCBS = ibsCbs ? r2((vBCIBSCBS * (i.cbsAliquota || 0)) / 100) : 0;
    return { vProd, vDesc, vBC, vICMS, vIPI, vBCIPI, vBCPisCofins: basePisCofins, vPIS, vCOFINS, vBCIBSCBS, vIBS, vCBS, vFrete: fretes[k], vSeg: seguros[k], vOutro: outros[k] };
  });
}

export function calcularTotais(itens: TotaisItem[]): Totais {
  const s = (k: keyof TotaisItem) => r2(itens.reduce((a, i) => a + (i[k] ?? 0), 0));
  const t = { vProd: s("vProd"), vDesc: s("vDesc"), vBC: s("vBC"), vICMS: s("vICMS"), vIPI: s("vIPI"), vPIS: s("vPIS"), vCOFINS: s("vCOFINS"), vBCIBSCBS: s("vBCIBSCBS"), vIBS: s("vIBS"), vCBS: s("vCBS"), vFrete: s("vFrete"), vSeg: s("vSeg"), vOutro: s("vOutro") };
  return { ...t, vNF: r2(t.vProd - t.vDesc + t.vFrete + t.vSeg + t.vOutro + t.vIPI) };
}

export const icmsDestaca = (cst: string) => ICMS_TRIBUTADO.has(cst) && cst !== "101";
export const ipiTributado = (cst: string) => IPI_TRIBUTADO.has(cst);
export const pisCofinsComAliquota = (cst: string) => PIS_COFINS_ALIQ.has(cst);
/** CST de IBS/CBS que levam o grupo de valores (gIBSCBS): tributação integral (000) e com redução (2xx). */
export const ibsCbsTributa = (cst: string | undefined) => Boolean(cst && /^(000|2\d\d)$/.test(cst));
