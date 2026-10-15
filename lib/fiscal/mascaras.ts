/**
 * Máscaras de impostos (Fiscal › Máscaras de impostos): o código interno que diz a operação (CFOP)
 * e como cada imposto sai. Puro e testável. O orçamento e a nota usam o mesmo cálculo da NF-e
 * (calculo.ts), então o imposto que o Rafael mostra ao cliente é o que o Jefferson emite.
 *
 * Regra do preço (a confirmar com o proprietário): o preço do orçamento já inclui o ICMS e o IPI
 * soma por fora — como na nota (vNF = produtos + IPI).
 */
import { calcularItens, calcularTotais, icmsDestaca, ipiTributado, pisCofinsComAliquota, r2 } from "./emissao/calculo";
import type { ItemNfe, Totais, TotaisItem } from "./emissao/tipos";

export type Mascara = {
  id: string; codigo: string; descricao: string; cfop: string; natureza: string | null; situacao_tributaria: string | null; ufs: string[];
  icms_cst: string | null; icms_aliquota: number | null; icms_reducao_base: number | null; icms_diferimento: number | null;
  ipi_enquadramento: string | null; ipi_cst: string | null; ipi_aliquota: number | null;
  pis_cst: string | null; pis_aliquota: number | null; cofins_cst: string | null; cofins_aliquota: number | null; pis_cofins_exclui_icms: boolean;
  ibs_cbs_cst: string | null; cclasstrib: string | null; ibs_aliquota: number | null; cbs_aliquota: number | null;
  conta_plano: string | null; conta_plano_descricao: string | null; obs_nota: string | null; observacao_interna: string | null;
  ativo: boolean; origem_dados: "grv" | "nota" | "contador" | "manual";
  confirmada_por_nome: string | null; confirmada_em: string | null; updated_by_name: string | null; updated_at: string;
};

/** Campos de percentual (o banco devolve numeric; aqui viram número ou nulo). */
export const CAMPOS_PERCENTUAL = ["icms_aliquota", "icms_reducao_base", "icms_diferimento", "ipi_aliquota", "pis_aliquota", "cofins_aliquota", "ibs_aliquota", "cbs_aliquota"] as const;

export function mascaraDoBanco(linha: Record<string, unknown>): Mascara {
  const m = { ...linha } as Record<string, unknown>;
  for (const c of CAMPOS_PERCENTUAL) m[c] = m[c] === null || m[c] === undefined || m[c] === "" ? null : Number(m[c]);
  m.ufs = Array.isArray(m.ufs) ? m.ufs : [];
  return m as Mascara;
}

export const ehSaida = (m: Pick<Mascara, "cfop">) => /^[567]/.test(m.cfop);
export const SITUACAO_MASCARA = { incompleta: "Incompleta", a_confirmar: "A confirmar com o contador", confirmada: "Confirmada" } as const;
export type SituacaoMascara = keyof typeof SITUACAO_MASCARA;

/** O que falta na máscara para calcular os impostos de uma saída (lista vazia: completa). */
export function faltandoNaMascara(m: Mascara): string[] {
  const f: string[] = [];
  if (!m.icms_cst) f.push("CST do ICMS");
  else {
    if (icmsDestaca(m.icms_cst) && m.icms_aliquota === null) f.push("alíquota do ICMS");
    if (m.icms_cst === "20" && m.icms_reducao_base === null) f.push("% de redução da base do ICMS");
    if (m.icms_cst === "51" && m.icms_diferimento === null) f.push("% de diferimento do ICMS");
  }
  if (!m.ipi_cst) f.push("CST do IPI");
  if (!m.pis_cst) f.push("CST do PIS");
  else if (pisCofinsComAliquota(m.pis_cst) && m.pis_aliquota === null) f.push("alíquota do PIS");
  if (!m.cofins_cst) f.push("CST da COFINS");
  else if (pisCofinsComAliquota(m.cofins_cst) && m.cofins_aliquota === null) f.push("alíquota da COFINS");
  return f;
}

export function situacaoDaMascara(m: Mascara): SituacaoMascara {
  if (faltandoNaMascara(m).length) return "incompleta";
  return m.confirmada_em ? "confirmada" : "a_confirmar";
}

/**
 * Máscara sugerida pelo estado do cliente: mesmo estado da empresa → venda interna (5101);
 * exterior (EX) → exportação (7101); outro estado → a 6101 daquele estado. Sem estado no
 * cadastro ou sem máscara para o estado: não sugere e diz por quê.
 */
export function sugerirMascara(mascaras: Mascara[], ufCliente: string | null | undefined, ufEmpresa: string | null | undefined): { mascara: Mascara | null; motivo: string } {
  const uf = (ufCliente ?? "").trim().toUpperCase();
  const ativas = mascaras.filter((m) => m.ativo && ehSaida(m));
  if (!uf) return { mascara: null, motivo: "O cliente está sem estado (UF) no cadastro: escolha a máscara pelo código." };
  const venda = (cfop: string) => ativas.filter((m) => m.cfop === cfop);
  if (uf === "EX") {
    const m = venda("7101")[0] ?? null;
    return { mascara: m, motivo: m ? "Cliente no exterior: exportação." : "Não há máscara de exportação (7101) cadastrada." };
  }
  if (ufEmpresa && uf === ufEmpresa.toUpperCase()) {
    const m = venda("5101")[0] ?? null;
    return { mascara: m, motivo: m ? `Cliente em ${uf}, mesmo estado da empresa: venda interna.` : "Não há máscara de venda interna (5101) cadastrada." };
  }
  const doEstado = venda("6101").find((m) => m.ufs.includes(uf)) ?? null;
  return doEstado
    ? { mascara: doEstado, motivo: `Cliente em ${uf}: venda para fora do estado.` }
    : { mascara: null, motivo: `Não há máscara de venda (6101) para ${uf}: escolha pelo código ou peça ao Fiscal para cadastrar.` };
}

/** Alíquota do IPI: a da máscara, quando ela tem; senão a do NCM do produto. */
export function aliquotaIpi(m: Mascara, ncm: string | null | undefined, ipiPorNcm: Map<string, number | null>): number | null {
  if (m.ipi_aliquota !== null) return m.ipi_aliquota;
  const n = (ncm ?? "").replace(/\D/g, "");
  return n ? ipiPorNcm.get(n) ?? null : null;
}

/** Os campos de imposto do item da nota a partir da máscara (o resto do item fica como veio). */
export function impostosDoItem(m: Mascara, aliquotaDoIpi: number | null): Pick<ItemNfe, "cfop" | "icmsCst" | "icmsAliquota" | "icmsReducaoBase" | "ipiCst" | "ipiAliquota" | "ipiEnquadramento" | "pisCst" | "pisAliquota" | "cofinsCst" | "cofinsAliquota" | "pisCofinsExcluiIcms" | "ibsCbsCst" | "cClassTrib" | "ibsAliquota" | "cbsAliquota" | "mascara"> {
  return {
    cfop: m.cfop, icmsCst: m.icms_cst ?? "", icmsAliquota: m.icms_aliquota ?? 0, icmsReducaoBase: m.icms_reducao_base ?? 0,
    ipiCst: m.ipi_cst ?? "", ipiAliquota: aliquotaDoIpi ?? 0, pisCst: m.pis_cst ?? "", pisAliquota: m.pis_aliquota ?? 0,
    cofinsCst: m.cofins_cst ?? "", cofinsAliquota: m.cofins_aliquota ?? 0, pisCofinsExcluiIcms: m.pis_cofins_exclui_icms, mascara: m.codigo,
    ...(m.ipi_enquadramento ? { ipiEnquadramento: m.ipi_enquadramento } : {}),
    ...(m.ibs_cbs_cst ? { ibsCbsCst: m.ibs_cbs_cst, cClassTrib: m.cclasstrib ?? "", ibsAliquota: m.ibs_aliquota ?? 0, cbsAliquota: m.cbs_aliquota ?? 0 } : {}),
  };
}

export type ItemParaImposto = { quantidade: number; preco: number; ncm: string | null; descricao: string };
export type ImpostosOrcamento =
  | { ok: true; itens: TotaisItem[]; totais: Totais; aliquotas: { icms: number; reducao: number; ipi: (number | null)[] } }
  | { ok: false; faltando: string[] };

const formatarNcm = (n: string) => (n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n);

/**
 * Impostos do orçamento pela máscara: o mesmo cálculo da nota (sem frete, seguro ou desconto,
 * que só entram na nota). Se faltar algum número, diz o quê em vez de calcular.
 */
export function impostosDoOrcamento(a: { itens: ItemParaImposto[]; mascara: Mascara | null; ipiPorNcm: Map<string, number | null>; consumidorFinal?: boolean }): ImpostosOrcamento {
  if (!a.mascara) return { ok: false, faltando: ["a máscara de impostos"] };
  const m = a.mascara;
  const faltando = faltandoNaMascara(m).map((f) => `${f} (máscara ${m.codigo})`);
  const ipis = a.itens.map((i) => aliquotaIpi(m, i.ncm, a.ipiPorNcm));
  if (m.ipi_cst && ipiTributado(m.ipi_cst)) {
    a.itens.forEach((i, k) => {
      if (ipis[k] !== null) return;
      const ncm = (i.ncm ?? "").replace(/\D/g, "");
      faltando.push(ncm ? `alíquota do IPI do NCM ${formatarNcm(ncm)}` : `NCM do produto ${i.descricao || `do item ${k + 1}`}`);
    });
  }
  const unicos = [...new Set(faltando)];
  if (unicos.length) return { ok: false, faltando: unicos };
  const itensNfe = a.itens.map((i, k) => ({
    codigo: "", descricao: i.descricao, ncm: i.ncm ?? "", unidade: "", quantidade: i.quantidade, valorUnitario: i.preco, desconto: 0, origem: 0,
    ...impostosDoItem(m, ipis[k]),
  })) as ItemNfe[];
  const itens = calcularItens({ itens: itensNfe, frete: { modalidade: 9, valor: 0 }, seguro: 0, outrasDespesas: 0, consumidorFinal: Boolean(a.consumidorFinal) });
  return { ok: true, itens, totais: calcularTotais(itens), aliquotas: { icms: m.icms_aliquota ?? 0, reducao: m.icms_reducao_base ?? 0, ipi: ipis } };
}

/** Carga efetiva do ICMS (alíquota × base reduzida), para mostrar ao lado da máscara. */
export const cargaEfetivaIcms = (m: Pick<Mascara, "icms_aliquota" | "icms_reducao_base">) =>
  m.icms_aliquota === null ? null : r2(m.icms_aliquota * (1 - (m.icms_reducao_base ?? 0) / 100));

const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "EX"]);

/** O que vem da tela vira alteração limpa da máscara (percentual vazio = sem número). */
export function normalizarMascara(v: unknown): { patch: Record<string, unknown>; erros: string[] } {
  const b = (v ?? {}) as Record<string, unknown>;
  const erros: string[] = [];
  const patch: Record<string, unknown> = {};
  const texto = (k: string, max: number, obrigatorio = false) => {
    if (!(k in b)) return;
    const t = String(b[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    if (obrigatorio && !t) erros.push(`Informe ${k === "descricao" ? "a descrição" : k}.`);
    patch[k] = t || null;
  };
  const codigo = (k: string, re: RegExp, nome: string) => {
    if (!(k in b)) return;
    const t = String(b[k] ?? "").replace(/\D/g, "");
    if (t && !re.test(t)) erros.push(`${nome} inválido.`);
    patch[k] = t || null;
  };
  texto("descricao", 200, true);
  texto("natureza", 60);
  texto("situacao_tributaria", 60);
  texto("conta_plano", 30);
  texto("conta_plano_descricao", 120);
  texto("obs_nota", 500);
  texto("observacao_interna", 1000);
  texto("ibs_cbs_cst", 3);
  texto("cclasstrib", 6);
  if ("cfop" in b) {
    const c = String(b.cfop ?? "").replace(/\D/g, "");
    if (!/^[1-7]\d{3}$/.test(c)) erros.push("CFOP: 4 dígitos (ex.: 5101).");
    patch.cfop = c;
  }
  codigo("icms_cst", /^\d{2,3}$/, "CST do ICMS");
  codigo("ipi_enquadramento", /^\d{3}$/, "Enquadramento do IPI");
  codigo("ipi_cst", /^\d{2}$/, "CST do IPI");
  codigo("pis_cst", /^\d{2}$/, "CST do PIS");
  codigo("cofins_cst", /^\d{2}$/, "CST da COFINS");
  for (const c of CAMPOS_PERCENTUAL) {
    if (!(c in b)) continue;
    const bruto = String(b[c] ?? "").trim();
    if (!bruto) { patch[c] = null; continue; }
    const n = Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto);
    if (!Number.isFinite(n) || n < 0 || n > 100) erros.push(`Percentual inválido em ${c.replace(/_/g, " ")} (0 a 100).`);
    else patch[c] = Math.round(n * 10000) / 10000;
  }
  if ("ufs" in b) {
    const lista = (Array.isArray(b.ufs) ? b.ufs : String(b.ufs ?? "").split(/[\s,;/-]+/)).map((u) => String(u).trim().toUpperCase()).filter(Boolean);
    const invalidas = lista.filter((u) => !UFS.has(u));
    if (invalidas.length) erros.push(`Estado inválido: ${invalidas.join(", ")}.`);
    patch.ufs = [...new Set(lista.filter((u) => UFS.has(u)))];
  }
  if ("pis_cofins_exclui_icms" in b) patch.pis_cofins_exclui_icms = Boolean(b.pis_cofins_exclui_icms);
  if ("ativo" in b) patch.ativo = Boolean(b.ativo);
  if ("origem_dados" in b) patch.origem_dados = ["grv", "nota", "contador", "manual"].includes(String(b.origem_dados)) ? b.origem_dados : "manual";
  return { patch, erros };
}
