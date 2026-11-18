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
 * - IBS/CBS (LC 214 art. 12; NT 2025.002): base = vProd − desconto + frete + seguro + outras
 *   − ICMS − PIS − COFINS (o IPI fica fora, art. 12 §2º II), só nos CST que tributam (000…); IBS da
 *   UF e CBS pelas alíquotas da máscara. Não somam no vNF em 2026.
 * - vNF = vProd − vDesc + vFrete + vSeg + vOutro + vII + vIPI (sem ST nesta etapa). vNFTot = vNF em 2026, como o
 *   GRV atual (6.0.12.D.1) emite e a SEFAZ autoriza; a soma do IBS/CBS por fora só com `tributosPorFora` (2027,
 *   depois da nota técnica — docs/PLANO-VIRADA-FISCAL.md, 2.1).
 * - IPI "outras" (49/99) sem alíquota leva base zero; PIS/COFINS "outras" (49 a 99) com `pisCofinsSemBase` (escolha
 *   da máscara: só informativo, como o GRV faz nas remessas) também. O valor informado (DI) prevalece sempre.
 * - ICMS por dentro (`icmsPorDentro`, ex.: sucata pelo art. 392 do RICMS/SP): base = valor ÷ (1 − alíquota).
 * - Valores informados no item (importação pela DI, ajuste do CIAP) entram como vieram; o resto continua calculado.
 */
import type { ItemNfe, NotaNfe, Totais, TotaisItem } from "./tipos";

/**
 * Arredonda a 2 casas pela metade para cima, sem o erro do ponto flutuante: 43.750 × 0,7343 = 32.125,625 vira
 * 32.125,63 (como o GRV e a SEFAZ), e não 32.125,62.
 */
export const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;

/** CST de ICMS que destacam imposto (regime normal) e CSOSN com crédito/destaque (Simples). */
const ICMS_TRIBUTADO = new Set(["00", "20", "90", "101", "900"]);
const IPI_TRIBUTADO = new Set(["50", "00", "49", "99"]);
/** IPI "outras" (49 entrada, 99 saída): sem alíquota, a base vai zero. */
const IPI_OUTRAS = new Set(["49", "99"]);
/** PIS/COFINS com valor: alíquota (01, 02) e outras operações (49 a 99, grupo PISOutr). */
const PIS_COFINS_ALIQ = new Set(["01", "02", ...Array.from({ length: 51 }, (_, k) => String(49 + k))]);
const pisCofinsOutras = (cst: string) => /^(49|[5-9]\d)$/.test(cst);

function ratear(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (!total || !soma) return pesos.map(() => 0);
  const partes = pesos.map((p) => r2((total * p) / soma));
  const dif = r2(total - partes.reduce((a, b) => a + b, 0));
  partes[partes.length - 1] = r2(partes[partes.length - 1] + dif);
  return partes;
}

/** Valor dos produtos do item: o informado (preço com mais casas) ou quantidade × unitário. */
export const valorDoItem = (i: Pick<ItemNfe, "quantidade" | "valorUnitario" | "valorTotal">) =>
  typeof i.valorTotal === "number" && Number.isFinite(i.valorTotal) ? r2(i.valorTotal) : r2(i.quantidade * i.valorUnitario);

const informado = (v: number | undefined, calculado: number) => (typeof v === "number" && Number.isFinite(v) ? r2(v) : calculado);

export function calcularItens(nota: Pick<NotaNfe, "itens" | "frete" | "seguro" | "outrasDespesas" | "consumidorFinal">): TotaisItem[] {
  const vProds = nota.itens.map((i: ItemNfe) => valorDoItem(i));
  const fretes = ratear(r2(nota.frete.valor || 0), vProds);
  const seguros = ratear(r2(nota.seguro || 0), vProds);
  const outros = ratear(r2(nota.outrasDespesas || 0), vProds);
  return nota.itens.map((i, k) => {
    const inf = i.informado ?? {};
    const vProd = vProds[k];
    const vDesc = r2(i.desconto || 0);
    const acessorias = fretes[k] + seguros[k] + outros[k];
    const vII = r2(i.ii?.vII ?? 0);
    const ipiComValor = IPI_TRIBUTADO.has(i.ipiCst) && !(IPI_OUTRAS.has(i.ipiCst) && !(i.ipiAliquota > 0));
    const vBCIPI = informado(inf.vBCIPI, ipiComValor ? r2(vProd - vDesc + acessorias) : 0);
    const vIPI = informado(inf.vIPI, ipiComValor ? r2((vBCIPI * (i.ipiAliquota || 0)) / 100) : 0);
    const vIPIDevol = r2(i.ipiDevolvido?.valor ?? 0);
    // IPI na base do ICMS: venda a consumidor final, ou quando a máscara manda (ex.: retorno de demonstração).
    const valorDaOperacao = vProd - vDesc + acessorias + (nota.consumidorFinal || i.ipiNaBaseIcms ? vIPI + vIPIDevol : 0);
    const aliquotaIcms = (i.icmsAliquota || 0) / 100;
    const baseCheia = i.icmsPorDentro && aliquotaIcms > 0 && aliquotaIcms < 1 ? valorDaOperacao / (1 - aliquotaIcms) : valorDaOperacao;
    // CST 90 sem alíquota é "outras" sem destaque: sem base.
    const destaca = ICMS_TRIBUTADO.has(i.icmsCst) && i.icmsCst !== "101" && !(i.icmsCst === "90" && !(aliquotaIcms > 0));
    const vBC = informado(inf.vBC, destaca ? r2(baseCheia * (1 - (i.icmsReducaoBase || 0) / 100)) : 0);
    const vICMS = informado(inf.vICMS, vBC ? r2((vBC * (i.icmsAliquota || 0)) / 100) : 0);
    const semBasePis = Boolean(i.pisCofinsSemBase) && pisCofinsOutras(i.pisCst);
    const basePisCofins = informado(inf.vBCPisCofins, semBasePis ? 0 : r2(vProd - vDesc - (i.pisCofinsExcluiIcms ? vICMS : 0)));
    const vPIS = informado(inf.vPIS, PIS_COFINS_ALIQ.has(i.pisCst) ? r2((basePisCofins * (i.pisAliquota || 0)) / 100) : 0);
    const baseCofins = informado(inf.vBCCofins, basePisCofins);
    const vCOFINS = informado(inf.vCOFINS, PIS_COFINS_ALIQ.has(i.cofinsCst) ? r2((baseCofins * (i.cofinsAliquota || 0)) / 100) : 0);
    const ibsCbs = ibsCbsTributa(i.ibsCbsCst);
    // Importação: a base do IBS/CBS vem da DI (valor aduaneiro e tributos), e entra informada.
    const vBCIBSCBS = informado(inf.vBCIBSCBS, ibsCbs ? r2(vProd - vDesc + acessorias - vICMS - vPIS - vCOFINS) : 0);
    const vIBS = informado(inf.vIBS, ibsCbs ? r2((vBCIBSCBS * (i.ibsAliquota || 0)) / 100) : 0);
    const vCBS = informado(inf.vCBS, ibsCbs ? r2((vBCIBSCBS * (i.cbsAliquota || 0)) / 100) : 0);
    return { vProd, vDesc, vBC, vICMS, vIPI, vBCIPI, vBCPisCofins: basePisCofins, vPIS, vBCCofins: baseCofins, vCOFINS, vBCIBSCBS, vIBS, vCBS, vFrete: fretes[k], vSeg: seguros[k], vOutro: outros[k], vII, vIPIDevol };
  });
}

export function calcularTotais(itens: TotaisItem[], valorTotalInformado?: number, tributosPorFora = false): Totais {
  const s = (k: keyof TotaisItem) => r2(itens.reduce((a, i) => a + (i[k] ?? 0), 0));
  const t = { vProd: s("vProd"), vDesc: s("vDesc"), vBC: s("vBC"), vICMS: s("vICMS"), vIPI: s("vIPI"), vPIS: s("vPIS"), vCOFINS: s("vCOFINS"), vBCIBSCBS: s("vBCIBSCBS"), vIBS: s("vIBS"), vCBS: s("vCBS"), vFrete: s("vFrete"), vSeg: s("vSeg"), vOutro: s("vOutro"), vII: s("vII"), vIPIDevol: s("vIPIDevol") };
  const vNF = typeof valorTotalInformado === "number" && Number.isFinite(valorTotalInformado)
    ? r2(valorTotalInformado)
    : r2(t.vProd - t.vDesc + t.vFrete + t.vSeg + t.vOutro + t.vII + t.vIPI + t.vIPIDevol);
  return { ...t, vNF, vNFTot: tributosPorFora ? r2(vNF + t.vIBS + t.vCBS) : vNF };
}

/**
 * Participação do item no total da nota (vItem), como o GRV leva e a SEFAZ autoriza: produto − desconto + frete +
 * seguro + outras + IPI + IPI devolvido. O imposto de importação fica fora (nas notas de importação do GRV o total é o
 * da DI e o item não soma o II).
 */
export const valorTotalDoItem = (c: TotaisItem) => r2(c.vProd - c.vDesc + c.vFrete + c.vSeg + c.vOutro + c.vIPI + c.vIPIDevol);

/** Totais da nota inteira (com o total informado da importação, quando houver). */
export const totaisDaNota = (nota: Pick<NotaNfe, "itens" | "frete" | "seguro" | "outrasDespesas" | "consumidorFinal" | "valorTotalInformado">) =>
  calcularTotais(calcularItens(nota), nota.valorTotalInformado);

export const icmsDestaca = (cst: string) => ICMS_TRIBUTADO.has(cst) && cst !== "101";
export const ipiTributado = (cst: string) => IPI_TRIBUTADO.has(cst);
export const pisCofinsComAliquota = (cst: string) => PIS_COFINS_ALIQ.has(cst);
/** PIS/COFINS no grupo "outras operações" (PISOutr/COFINSOutr): CST 49 a 99. */
export const pisCofinsGrupoOutras = pisCofinsOutras;
/** CST de IBS/CBS que levam o grupo de valores (gIBSCBS): tributação integral (000) e com redução (2xx). */
export const ibsCbsTributa = (cst: string | undefined) => Boolean(cst && /^(000|2\d\d)$/.test(cst));
