/**
 * Conferência do IBS e da CBS de cada NF-e lida (N-03): a alíquota que vale na DATA DA NOTA vem dos parâmetros
 * legais (Fiscal › Parâmetros legais), a base é refeita a partir dos valores do item (LC 214 art. 12; NT 2025.002)
 * e o valor esperado é comparado com o destacado. Puro: recebe as linhas já lidas do banco. O crédito continua
 * sendo o valor destacado na nota; a diferença só aparece como alerta para o Fiscal tratar com quem emitiu.
 * Como roda a cada leitura da tela, uma alíquota nova aprovada reconfere as notas já lidas, sem reler o XML.
 */
import { vigente, type Parametro } from "../../contabil/parametros";
import { doSimples, type ComposicaoBase, type ItemIbsCbs } from "./leitura";

/** Alíquotas em %, como no XML (pCBS 0.9000 = 0,9%). */
export type AliquotasIbsCbs = { cbs: number; ibsUF: number; ibsMun: number; chave: string; norma: string; vigenteDe: string; aConferir: boolean };

/**
 * Parâmetros que trazem a alíquota, do mais novo para o mais antigo. Só serve o que tiver número em `cbs` e `ibs`
 * (fração: 0,009 = 0,9%); `ibs_uf` e `ibs_mun` separam o IBS quando a lei separar (2027: 0,05% + 0,05%).
 */
export const CHAVES_ALIQUOTA = ["ibs_cbs_aliquotas", "reforma_2027", "reforma_2026_fase_teste"] as const;

const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;
const r4 = (v: number) => Math.round(Number((v * 10000).toFixed(6))) / 10000;
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Um centavo por imposto e por item: o arredondamento de quem emitiu. */
const TOLERANCIA = 0.01;
/** Diferença além do centavo (arredondada antes: 0,80 − 0,79 em ponto flutuante passa de 0,01). */
const passa = (d: number) => Math.abs(r2(d)) > TOLERANCIA;

export function aliquotasNaData(parametros: readonly Parametro[], data: string): AliquotasIbsCbs | null {
  for (const chave of CHAVES_ALIQUOTA) {
    const v = vigente<Record<string, unknown>>(parametros, chave, data);
    const cbs = numero(v?.valor?.cbs), ibs = numero(v?.valor?.ibs);
    if (!v || cbs === null || ibs === null) continue;
    const uf = numero(v.valor.ibs_uf) ?? ibs, mun = numero(v.valor.ibs_mun) ?? (numero(v.valor.ibs_uf) === null ? 0 : r4(ibs - uf));
    return { cbs: r4(cbs * 100), ibsUF: r4(uf * 100), ibsMun: r4(mun * 100), chave, norma: String(v.fonte?.norma ?? "parâmetro legal").split(";")[0], vigenteDe: v.vigenteDe, aConferir: v.aConferir };
  }
  return null;
}

/** Base do IBS/CBS: produto − desconto + frete + seguro + outras + II − ICMS − FCP − DIFAL − PIS − COFINS. O IPI fica fora. */
export const baseCalculada = (i: ComposicaoBase) =>
  r2(i.vProd - i.vDesc + i.vFrete + i.vSeg + i.vOutro + i.vII - i.vICMS - i.vFCP - i.vICMSUFDest - i.vFCPUFDest - i.vPIS - i.vCOFINS);

export type ConferenciaItem = {
  nItem: number; cst: string;
  baseDestacada: number; baseCalculada: number;
  destacado: { ibsUF: number; ibsMun: number; cbs: number; pIBSUF: number; pIBSMun: number; pCBS: number };
  esperado: { ibsUF: number; ibsMun: number; cbs: number } | null;
  /** Destacado − esperado (IBS + CBS), em reais. */
  diferenca: number;
  motivos: string[];
};

export type SituacaoConferencia = "confere" | "diverge" | "sem_regra" | "sem_grupo" | "simples" | "manual";
export type Conferencia = { situacao: SituacaoConferencia; diferenca: number; motivos: string[]; aliquotas: AliquotasIbsCbs | null; itens: ConferenciaItem[] };

const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** CST que leva valores (gIBSCBS). 2xx tem redução de alíquota: confere-se à mão por ora. */
const tributa = (cst: string) => /^(000|2\d\d)$/.test(cst);

function conferirItem(i: ItemIbsCbs, a: AliquotasIbsCbs): ConferenciaItem {
  const destacado = { ibsUF: i.vIBSUF, ibsMun: i.vIBSMun, cbs: i.vCBS, pIBSUF: i.pIBSUF, pIBSMun: i.pIBSMun, pCBS: i.pCBS };
  const base = baseCalculada(i);
  const motivos: string[] = [];
  if (passa(base - i.vBC)) motivos.push(`Item ${i.nItem}: base destacada ${brl(i.vBC)}, a conta dá ${brl(base)}.`);
  if (r4(i.pCBS) !== a.cbs || r4(i.pIBSUF) !== a.ibsUF || r4(i.pIBSMun) !== a.ibsMun) {
    motivos.push(`Item ${i.nItem}: alíquotas CBS ${pct(i.pCBS)}, IBS UF ${pct(i.pIBSUF)} e IBS município ${pct(i.pIBSMun)}; a lei da data manda ${pct(a.cbs)}, ${pct(a.ibsUF)} e ${pct(a.ibsMun)}.`);
  }
  const esperado = { ibsUF: r2((base * a.ibsUF) / 100), ibsMun: r2((base * a.ibsMun) / 100), cbs: r2((base * a.cbs) / 100) };
  const diferenca = r2(i.vIBSUF + i.vIBSMun + i.vCBS - esperado.ibsUF - esperado.ibsMun - esperado.cbs);
  const foraDoCentavo = passa(i.vIBSUF - esperado.ibsUF) || passa(i.vIBSMun - esperado.ibsMun) || passa(i.vCBS - esperado.cbs);
  if (foraDoCentavo && !motivos.length) motivos.push(`Item ${i.nItem}: valor destacado difere do esperado em ${brl(diferenca)}.`);
  return { nItem: i.nItem, cst: i.cst, baseDestacada: i.vBC, baseCalculada: base, destacado, esperado, diferenca, motivos };
}

/**
 * Confere uma nota. `data` é a data da emissão (AAAA-MM-DD, horário do emitente). Itens com CST sem valores
 * (410 e afins) não têm o que conferir; com redução (2xx) ficam para conferência manual.
 */
export function conferirNota(nota: { temGrupo: boolean; itens: ItemIbsCbs[]; data: string | null; crt?: number | null }, parametros: readonly Parametro[]): Conferencia {
  // Simples Nacional: dispensado do grupo em 2026 (obrigatório desde 01/01/2027). A base dele não segue a conta do
  // regime normal (ICMS, PIS e COFINS vão no DAS, sem destaque), então não há conferência automática.
  if (doSimples(nota.crt)) {
    if (nota.temGrupo) return { situacao: "simples", diferenca: 0, aliquotas: null, itens: [], motivos: ["Emitente do Simples Nacional: a base segue a regra do Simples; não há conferência automática."] };
    if ((nota.data ?? "") < "2027-01-01") return { situacao: "simples", diferenca: 0, aliquotas: null, itens: [], motivos: ["Emitente do Simples Nacional: o grupo do IBS/CBS só é obrigatório para o Simples a partir de 01/01/2027."] };
  }
  if (!nota.temGrupo) return { situacao: "sem_grupo", diferenca: 0, motivos: ["A nota veio sem o grupo do IBS/CBS."], aliquotas: null, itens: [] };
  const a = nota.data ? aliquotasNaData(parametros, nota.data) : null;
  const comValor = nota.itens.filter((i) => tributa(i.cst));
  if (!comValor.length) return { situacao: "confere", diferenca: 0, motivos: [], aliquotas: a, itens: [] };
  if (!a) return { situacao: "sem_regra", diferenca: 0, motivos: [`Não há alíquota legal de IBS/CBS em vigor em ${nota.data ?? "data desconhecida"}.`], aliquotas: null, itens: [] };
  if (comValor.some((i) => i.cst !== "000")) return { situacao: "manual", diferenca: 0, motivos: ["Item com redução de alíquota (CST 2xx): conferir à mão."], aliquotas: a, itens: [] };
  // Nota lida antes da conferência existir não tem a composição da base: o servidor relê.
  if (comValor.some((i) => typeof i.vProd !== "number")) return { situacao: "manual", diferenca: 0, motivos: ["Nota lida antes da conferência: será relida."], aliquotas: a, itens: [] };
  const itens = comValor.map((i) => conferirItem(i, a));
  const motivos = itens.flatMap((i) => i.motivos);
  return { situacao: motivos.length ? "diverge" : "confere", diferenca: r2(itens.reduce((s, i) => s + i.diferenca, 0)), motivos, aliquotas: a, itens };
}
