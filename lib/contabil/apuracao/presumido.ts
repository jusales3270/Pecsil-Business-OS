/**
 * Apuração do Lucro Presumido (N-07): IRPJ e CSLL por trimestre, PIS e COFINS cumulativos por mês. Puro, sem modelo:
 * percentuais, alíquotas, limites e códigos vêm dos parâmetros legais com vigência na data do fato gerador (último dia
 * do período). Parâmetro em rascunho volta em `aConferir`. Contrato em docs/PLANO-CONTABIL-FISCAL.md §3.3.
 *
 * LC 224/2025 (acréscimo de 10% na presunção sobre a receita acima de R$ 5 mi no ano), pelo art. 15 da IN RFB
 * 2.305/2025 na redação da IN 2.306/2026:
 * - o limite anual se distribui em limites trimestrais (§§ 1º e 2º); o acréscimo só incide no que passa do limite do
 *   trimestre (§ 3º); a sobra de um trimestre abaixo do limite soma ao limite dos seguintes do mesmo ano (§ 4º);
 * - no último trimestre o ano é conferido pelo acumulado (§ 5º, incisos I a III): o que foi majorado a mais nos
 *   trimestres anteriores vira dedução do tributo do último trimestre (o que sobrar é restituível, §§ 7º e 8º);
 * - com mais de uma atividade, o excedente se reparte na proporção da receita de cada uma (§ 6º);
 * - quem não esteve em atividade o ano inteiro tem o limite proporcional aos trimestres em atividade (§ 9º).
 */
import { vigente, type Parametro, type Vigencia } from "../parametros";

export type Atividade = "industria_comercio" | "servicos";
type Par = { irpj: number; csll: number };
export type PercentuaisPresumido = Record<Atividade, Par> & {
  irpj_aliquota: number;
  csll_aliquota: number;
  irpj_adicional: { aliquota: number; excedente_trimestral: number };
  lc_224_2025?: {
    percentuais_majorados: Record<Atividade, Par>;
    vigencia_irpj: string;
    vigencia_csll: string;
    limite_trimestral?: number;
  };
};
export type PisCofinsAliquotas = { cumulativo: { pis: number; cofins: number } };

export type Memoria = { passo: string; valor: number }[];
export type ReceitaTrimestre = {
  trimestre: 1 | 2 | 3 | 4;
  /** Receita bruta do trimestre por atividade (já sem vendas canceladas, devoluções e IPI). */
  receitas: Partial<Record<Atividade, number>>;
  /** Ganhos de capital, receitas financeiras e demais receitas que entram inteiras na base. */
  outras: number;
};
export type ApuracaoTrimestre = {
  trimestre: number; fim: string; receita: number; limite: number | null; excesso: number;
  baseIrpj: number; irpjNormal: number; adicional: number; baseCsll: number; csll: number;
  deducao: { irpj: number; csll: number };
  irpj: number; csllDevida: number; restituir: { irpj: number; csll: number };
  darf: { irpj: string | null; csll: string | null };
  memoria: Memoria;
};

export const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;
const fimDoTrimestre = (ano: number, t: number) => new Date(Date.UTC(ano, t * 3, 0)).toISOString().slice(0, 10);
const ATIVIDADES: Atividade[] = ["industria_comercio", "servicos"];

/** O imposto de um trimestre com o excedente (sujeito ao acréscimo) já repartido por atividade. */
function tributar(p: PercentuaisPresumido, rt: ReceitaTrimestre, excesso: number, majora: { irpj: boolean; csll: boolean }) {
  const total = ATIVIDADES.reduce((s, a) => s + (rt.receitas[a] ?? 0), 0);
  const memoria: Memoria = [];
  let baseIrpj = rt.outras, baseCsll = rt.outras;
  for (const a of ATIVIDADES) {
    const receita = rt.receitas[a] ?? 0;
    if (!receita) continue;
    const exc = total > 0 ? (excesso * receita) / total : 0;
    const m = p.lc_224_2025?.percentuais_majorados[a];
    const irpj = (receita - (majora.irpj ? exc : 0)) * p[a].irpj + (majora.irpj && m ? exc * m.irpj : 0);
    const csll = (receita - (majora.csll ? exc : 0)) * p[a].csll + (majora.csll && m ? exc * m.csll : 0);
    baseIrpj += irpj; baseCsll += csll;
    memoria.push({ passo: `Receita ${a === "servicos" ? "de serviços" : "de indústria e comércio"}`, valor: r2(receita) });
    if (exc && (majora.irpj || majora.csll)) memoria.push({ passo: "  parte acima do limite (LC 224, presunção acrescida de 10%)", valor: r2(exc) });
  }
  if (rt.outras) memoria.push({ passo: "Outras receitas (entram inteiras)", valor: r2(rt.outras) });
  baseIrpj = r2(baseIrpj); baseCsll = r2(baseCsll);
  const irpjNormal = r2(baseIrpj * p.irpj_aliquota);
  const adicional = r2(Math.max(0, baseIrpj - p.irpj_adicional.excedente_trimestral) * p.irpj_adicional.aliquota);
  const csll = r2(baseCsll * p.csll_aliquota);
  memoria.push({ passo: "Base do IRPJ", valor: baseIrpj }, { passo: `IRPJ (${p.irpj_aliquota * 100}%)`, valor: irpjNormal },
    { passo: `Adicional (${p.irpj_adicional.aliquota * 100}% do que passa de ${p.irpj_adicional.excedente_trimestral} no trimestre)`, valor: adicional },
    { passo: "Base da CSLL", valor: baseCsll }, { passo: `CSLL (${p.csll_aliquota * 100}%)`, valor: csll });
  return { baseIrpj, irpjNormal, adicional, baseCsll, csll, memoria };
}

/**
 * IRPJ e CSLL dos trimestres de um ano. `trimestres` em ordem (os que existirem); o ajuste do § 5º só entra quando o
 * 4º trimestre está na lista. `trimestresEmAtividade` (§ 9º) vale 4 para quem operou o ano todo.
 */
export function apurarPresumidoAno(parametros: readonly Parametro[], ano: number, trimestres: readonly ReceitaTrimestre[], trimestresEmAtividade = 4) {
  const aConferir: Vigencia[] = [];
  const conferir = (v: Vigencia | null) => { if (v?.aConferir && !aConferir.some((x) => x.parametroId === v.parametroId)) aConferir.push(v); };
  type Passo = { rt: ReceitaTrimestre; fim: string; p: PercentuaisPresumido; majora: { irpj: boolean; csll: boolean }; limite: number | null; excesso: number; darf: { irpj: string | null; csll: string | null } };
  const passos: Passo[] = [];
  let sobra = 0;
  for (const rt of [...trimestres].sort((a, b) => a.trimestre - b.trimestre)) {
    const fim = fimDoTrimestre(ano, rt.trimestre);
    const v = vigente<PercentuaisPresumido>(parametros, "lucro_presumido_percentuais", fim);
    if (!v) throw new Error(`Sem percentuais do Lucro Presumido vigentes em ${fim}.`);
    conferir(v);
    const darfs = vigente<Record<string, string>>(parametros, "codigos_darf", fim);
    conferir(darfs);
    const lc = v.valor.lc_224_2025;
    const majora = { irpj: Boolean(lc && fim >= lc.vigencia_irpj), csll: Boolean(lc && fim >= lc.vigencia_csll) };
    const receita = ATIVIDADES.reduce((s, a) => s + (rt.receitas[a] ?? 0), 0);
    let limite: number | null = null, excesso = 0;
    if (lc && (majora.irpj || majora.csll)) {
      if (!lc.limite_trimestral) throw new Error("O limite trimestral da LC 224 não está nos parâmetros.");
      limite = lc.limite_trimestral + sobra;
      excesso = Math.max(0, receita - limite);
      sobra = Math.max(0, limite - receita);
    }
    const codigo = (c: string) => (darfs?.valor && darfs.valor[c] ? c : null);
    passos.push({ rt, fim, p: v.valor, majora, limite, excesso, darf: { irpj: codigo("2089"), csll: codigo("2372") } });
  }

  // § 5º: no último trimestre, o ano conferido pelo acumulado.
  const ultimo = passos.find((x) => x.rt.trimestre === 4 && x.limite !== null);
  const deducao = { irpj: 0, csll: 0 };
  const notas: string[] = [];
  if (ultimo) {
    const lc = ultimo.p.lc_224_2025!;
    const acumulado = passos.reduce((s, x) => s + ATIVIDADES.reduce((t, a) => t + (x.rt.receitas[a] ?? 0), 0), 0);
    const limiteAnual = lc.limite_trimestral! * trimestresEmAtividade;
    const excessoAno = Math.max(0, acumulado - limiteAnual);
    const anteriores = passos.filter((x) => x !== ultimo && x.limite !== null);
    const somaAnteriores = anteriores.reduce((s, x) => s + x.excesso, 0);
    // I: o ano não passou do limite; II: passou menos do que já foi majorado; III: o 4º só majora o que falta.
    const fator = acumulado <= limiteAnual ? 0 : excessoAno < somaAnteriores ? excessoAno / somaAnteriores : null;
    if (fator !== null) {
      ultimo.excesso = 0;
      for (const x of anteriores) {
        const pago = tributar(x.p, x.rt, x.excesso, x.majora), refeito = tributar(x.p, x.rt, x.excesso * fator, x.majora);
        deducao.irpj += pago.irpjNormal + pago.adicional - refeito.irpjNormal - refeito.adicional;
        deducao.csll += pago.csll - refeito.csll;
      }
      notas.push(fator === 0 ? "O ano não passou do limite: o acréscimo dos trimestres anteriores volta como dedução (§ 5º, I)."
        : "O ano passou do limite menos do que os trimestres já majoraram: a diferença volta como dedução (§ 5º, II).");
    } else ultimo.excesso = Math.max(0, excessoAno - somaAnteriores);
    if (passos.some((x) => x.majora.irpj !== x.majora.csll)) notas.push("No ano, a CSLL só teve acréscimo a partir da vigência dela (abril de 2026): o ajuste anual da CSLL fica a conferir com o escritório.");
  }

  const resultado: ApuracaoTrimestre[] = passos.map((x) => {
    const t = tributar(x.p, x.rt, x.excesso, x.majora);
    const ded = x === ultimo ? { irpj: r2(deducao.irpj), csll: r2(deducao.csll) } : { irpj: 0, csll: 0 };
    const irpjBruto = r2(t.irpjNormal + t.adicional);
    const memoria: Memoria = [
      ...(x.limite !== null ? [{ passo: "Limite do trimestre (LC 224, com a sobra dos anteriores)", valor: r2(x.limite) }, { passo: "Receita acima do limite", valor: r2(x.excesso) }] : []),
      ...t.memoria,
      ...(ded.irpj || ded.csll ? [{ passo: "Dedução do ajuste anual no IRPJ", valor: ded.irpj }, { passo: "Dedução do ajuste anual na CSLL", valor: ded.csll }] : []),
    ];
    return {
      trimestre: x.rt.trimestre, fim: x.fim, receita: r2(ATIVIDADES.reduce((s, a) => s + (x.rt.receitas[a] ?? 0), 0)), limite: x.limite === null ? null : r2(x.limite), excesso: r2(x.excesso),
      baseIrpj: t.baseIrpj, irpjNormal: t.irpjNormal, adicional: t.adicional, baseCsll: t.baseCsll, csll: t.csll, deducao: ded,
      irpj: r2(Math.max(0, irpjBruto - ded.irpj)), csllDevida: r2(Math.max(0, t.csll - ded.csll)),
      restituir: { irpj: r2(Math.max(0, ded.irpj - irpjBruto)), csll: r2(Math.max(0, ded.csll - t.csll)) },
      darf: x.darf, memoria,
    };
  });
  return { trimestres: resultado, aConferir, notas };
}

/** PIS e COFINS cumulativos de um mês (competência AAAA-MM). `exclusoes`: exportação, vendas canceladas, IPI etc. */
export function apurarPisCofinsCumulativo(parametros: readonly Parametro[], competencia: string, receita: number, exclusoes: readonly { rotulo: string; valor: number }[] = []) {
  const [a, m] = competencia.split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const v = vigente<PisCofinsAliquotas>(parametros, "pis_cofins_aliquotas", fim);
  if (!v) throw new Error(`Sem alíquotas de PIS/COFINS vigentes em ${fim}.`);
  const darfs = vigente<Record<string, string>>(parametros, "codigos_darf", fim);
  const base = r2(receita - exclusoes.reduce((s, x) => s + x.valor, 0));
  const pis = r2(base * v.valor.cumulativo.pis), cofins = r2(base * v.valor.cumulativo.cofins);
  const memoria: Memoria = [{ passo: "Receita do mês", valor: r2(receita) }, ...exclusoes.map((x) => ({ passo: `(-) ${x.rotulo}`, valor: r2(x.valor) })),
    { passo: "Base", valor: base }, { passo: `PIS (${(v.valor.cumulativo.pis * 100).toFixed(2)}%)`, valor: pis }, { passo: `COFINS (${(v.valor.cumulativo.cofins * 100).toFixed(2)}%)`, valor: cofins }];
  const codigo = (c: string) => (darfs?.valor && darfs.valor[c] ? c : null);
  return { competencia, base, pis, cofins, darf: { pis: codigo("8109"), cofins: codigo("2172") }, memoria, aConferir: ([v, darfs] as (Vigencia | null)[]).filter((x): x is Vigencia => Boolean(x?.aConferir)) };
}
