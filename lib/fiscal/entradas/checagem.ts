/**
 * Checagem das notas de entrada (N-09). Puro: lê o XML da NF-e recebida, propõe a classificação de cada item
 * (tipo do item do SPED, CFOP de entrada e o crédito de ICMS que cabe) e aponta o que não confere: CFOP × UF,
 * CST × regime do emitente, alíquota interestadual, NCM, CST × valor do ICMS, grupo do IBS/CBS, devolução sem a
 * nota de origem e itens que não somam o total. A classificação é proposta com o porquê; quem confirma é o Fiscal.
 */
import { bloco, tag, textoXml } from "../ibs-cbs/leitura";

/** Tipo do item no SPED (registro 0200), o mesmo do cadastro de materiais. */
export const TIPOS_ITEM: Record<string, string> = {
  "00": "Mercadoria para revenda", "01": "Matéria-prima", "02": "Embalagem", "06": "Produto intermediário", "07": "Uso e consumo",
  "08": "Ativo imobilizado", "09": "Serviço", "10": "Outros insumos", "RI": "Remessa ou retorno (industrialização, conserto)", "DV": "Devolução de venda", "BO": "Bonificação ou brinde", "??": "A classificar",
};
export type ItemEntrada = {
  nItem: number; cProd: string; xProd: string; ncm: string; cfop: string; unidade: string; quantidade: number; vProd: number;
  orig: string; cst: string; csosn: string; pICMS: number; vICMS: number; vICMSST: number; pIPI: number; vIPI: number; temIbsCbs: boolean;
};
export type NotaEntrada = {
  chave: string | null; numero: string | null; emissao: string | null; competencia: string | null; finalidade: string | null;
  emitente: { cnpj: string | null; nome: string | null; uf: string | null; crt: number | null }; destinatarioCnpj: string | null;
  vProd: number; vNF: number; referencias: string[]; itens: ItemEntrada[];
};
export type Achado = { nItem: number | null; nivel: "erro" | "atencao"; regra: string; mensagem: string };
export type Classificacao = { nItem: number; tipo: string; cfopEntrada: string | null; credito: string; porque: string };

const num = (v: string | null) => (v ? Number(v) || 0 : 0);
const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;

export function lerNotaEntrada(xml: string): NotaEntrada | null {
  const inf = bloco(xml, "infNFe");
  if (!inf) return null;
  const ide = bloco(inf, "ide") ?? "", emit = bloco(inf, "emit") ?? "", dest = bloco(inf, "dest") ?? "";
  const emissao = tag(ide, "dhEmi") ?? tag(ide, "dEmi");
  const itens: ItemEntrada[] = [];
  const referencias = new Set<string>();
  for (const r of ide.matchAll(/<refNFe>(\d{44})<\/refNFe>/g)) referencias.add(r[1]);
  for (const m of inf.matchAll(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g)) {
    const prod = bloco(m[2], "prod") ?? "", icms = bloco(m[2], "ICMS") ?? "", ipi = bloco(m[2], "IPI") ?? "";
    for (const r of m[2].matchAll(/<chaveAcesso>(\d{44})<\/chaveAcesso>/g)) referencias.add(r[1]);
    itens.push({
      nItem: Number(m[1]), cProd: textoXml(tag(prod, "cProd")) ?? "", xProd: textoXml(tag(prod, "xProd")) ?? "", ncm: tag(prod, "NCM") ?? "", cfop: tag(prod, "CFOP") ?? "",
      unidade: tag(prod, "uCom") ?? "", quantidade: num(tag(prod, "qCom")), vProd: num(tag(prod, "vProd")),
      orig: tag(icms, "orig") ?? "", cst: tag(icms, "CST") ?? "", csosn: tag(icms, "CSOSN") ?? "", pICMS: num(tag(icms, "pICMS")), vICMS: num(tag(icms, "vICMS")),
      vICMSST: num(tag(icms, "vICMSST")), pIPI: num(tag(ipi, "pIPI")), vIPI: num(tag(ipi, "vIPI")), temIbsCbs: /<IBSCBS>/.test(m[2]),
    });
  }
  const tot = bloco(bloco(inf, "total") ?? "", "ICMSTot") ?? "";
  return {
    chave: xml.match(/<infNFe[^>]*Id="NFe(\d{44})"/)?.[1] ?? null, numero: tag(ide, "nNF"), emissao, competencia: emissao ? emissao.slice(0, 7) : null,
    finalidade: tag(ide, "finNFe"),
    emitente: { cnpj: tag(emit, "CNPJ") ?? tag(emit, "CPF"), nome: textoXml(tag(emit, "xNome")), uf: tag(bloco(emit, "enderEmit") ?? "", "UF"), crt: tag(emit, "CRT") ? Number(tag(emit, "CRT")) : null },
    destinatarioCnpj: tag(dest, "CNPJ") ?? tag(dest, "CPF"), vProd: num(tag(tot, "vProd")), vNF: num(tag(tot, "vNF")), referencias: [...referencias], itens,
  };
}

/** CFOP de entrada para o tipo do item: prefixo 1 (mesmo estado) ou 2 (outro estado); com ST, a família 140x. */
export function cfopEntradaPara(tipo: string, prefixo: "1" | "2", cfopFornecedor: string, st: boolean): string | null {
  const c = cfopFornecedor.slice(1);
  const base: Record<string, string> = { "00": st ? "403" : "102", "01": st ? "401" : "101", "02": st ? "401" : "101", "06": st ? "401" : "101", "10": st ? "401" : "101", "07": st ? "407" : "556", "08": st ? "406" : "551", "09": "933" };
  if (base[tipo]) return `${prefixo}${tipo === "10" && ["124", "125"].includes(c) ? c : base[tipo]}`;
  if (tipo === "DV") return `${prefixo}${["201", "202", "410", "411"].includes(c) ? c : "201"}`;
  if (tipo === "RI") return ["901", "902", "903", "915", "916", "924", "925"].includes(c) ? `${prefixo}${c}` : null;
  if (tipo === "BO") return `${prefixo}910`;
  return null;
}

const IMPORTADO = new Set(["1", "2", "3", "8"]);
const CST_TRIBUTADO = new Set(["00", "10", "20", "70", "90"]);
const CST_SEM_ICMS = new Set(["40", "41", "50"]);
const SIMPLES = (crt: number | null) => crt === 1 || crt === 2 || crt === 4;

/**
 * Proposta de classificação do item, na ordem: cadastro de materiais (código do fornecedor ligado ao material),
 * CFOP do fornecedor (o que a operação já diz), classificação da nota no Painel do ICMS e, por fim, "a classificar".
 */
export function classificar(n: NotaEntrada, i: ItemEntrada, ufEmpresa: string, dicas: { tipoMaterial?: string | null; tipoPainel?: string | null }): Classificacao {
  const dentro = (n.emitente.uf ?? "").toUpperCase() === ufEmpresa.toUpperCase();
  const p = dentro ? "1" : "2";
  const c = i.cfop.slice(1);
  const st = i.vICMSST > 0 || ["401", "403", "405"].includes(c);
  const CFOP: Record<string, string> = { "00": st ? "403" : "102", "01": st ? "401" : "101", "02": st ? "401" : "101", "06": st ? "401" : "101", "10": st ? "401" : "101", "07": st ? "407" : "556", "08": st ? "406" : "551" };
  const CREDITO: Record<string, string> = {
    "00": "ICMS e IPI destacados: crédito (revenda)", "01": "ICMS e IPI destacados: crédito", "02": "ICMS e IPI destacados: crédito", "06": "ICMS e IPI destacados: crédito", "10": "ICMS e IPI destacados: crédito",
    "07": "Sem crédito de ICMS (uso e consumo, LC 87/96 art. 33 I)", "08": "ICMS pelo CIAP em 48 meses (LC 87/96 art. 20 §5º)", "RI": "Sem crédito: remessa ou retorno", "DV": "Crédito do ICMS da nota de venda devolvida", "BO": "Conferir: bonificação", "??": "Depende da classificação",
  };
  const por = (tipo: string, cfop: string | null, porque: string): Classificacao => ({ nItem: i.nItem, tipo, cfopEntrada: cfop, credito: CREDITO[tipo] ?? CREDITO["??"], porque });
  // O que a operação já diz pelo CFOP do fornecedor.
  if (["201", "202", "410", "411"].includes(c) || n.finalidade === "4") return por("DV", `${p}${["201", "202", "410", "411"].includes(c) ? c : "201"}`, `CFOP ${i.cfop} do emitente${n.finalidade === "4" ? " e nota de devolução (finalidade 4)" : ""}`);
  if (["901", "902", "903", "915", "916", "924", "925"].includes(c)) return por("RI", `${p}${c}`, `CFOP ${i.cfop} do emitente: remessa ou retorno`);
  if (c === "910") return por("BO", `${p}910`, `CFOP ${i.cfop} do emitente: bonificação ou brinde`);
  if (["551", "552"].includes(c)) return por("08", `${p}551`, `CFOP ${i.cfop} do emitente: venda de ativo`);
  if (dicas.tipoMaterial && CFOP[dicas.tipoMaterial]) return por(dicas.tipoMaterial, `${p}${CFOP[dicas.tipoMaterial]}`, "Pelo cadastro de materiais (código do fornecedor ligado)");
  if (["124", "125"].includes(c)) return por("10", `${p}${c === "124" ? "124" : "125"}`, `CFOP ${i.cfop} do emitente: industrialização por encomenda`);
  if (dicas.tipoPainel && /uso e consumo/i.test(dicas.tipoPainel)) return por("07", `${p}${CFOP["07"]}`, "Pela classificação da nota no Painel do ICMS (uso e consumo)");
  if (dicas.tipoPainel && /material/i.test(dicas.tipoPainel)) return por("01", `${p}${CFOP["01"]}`, "Pela classificação da nota no Painel do ICMS (material de produção)");
  return por("??", null, "Sem cadastro do material nem classificação no Painel do ICMS");
}

/** O que não confere na nota (regras, sem modelo). */
export function checar(n: NotaEntrada, ufEmpresa: string): Achado[] {
  const a: Achado[] = [];
  const add = (nItem: number | null, nivel: Achado["nivel"], regra: string, mensagem: string) => a.push({ nItem, nivel, regra, mensagem });
  const dentro = (n.emitente.uf ?? "").toUpperCase() === ufEmpresa.toUpperCase();
  const simples = SIMPLES(n.emitente.crt);
  for (const i of n.itens) {
    const esperado = dentro ? "5" : "6";
    if (/^\d{4}$/.test(i.cfop) && !["7", "3"].includes(i.cfop[0]) && i.cfop[0] !== esperado) add(i.nItem, "erro", "cfop_uf", `CFOP ${i.cfop} não confere com a origem: emitente ${dentro ? "do mesmo estado usa 5xxx" : `de ${n.emitente.uf ?? "outro estado"} usa 6xxx`}.`);
    if (!/^\d{8}$/.test(i.ncm) || /^0+$/.test(i.ncm)) add(i.nItem, "erro", "ncm", `NCM "${i.ncm || "vazio"}" inválido (8 dígitos).`);
    if (simples && i.cst && !i.csosn) add(i.nItem, "erro", "cst_regime", `Emitente do Simples Nacional usando CST ${i.cst} (o Simples usa CSOSN).`);
    if (!simples && n.emitente.crt === 3 && i.csosn && !i.cst) add(i.nItem, "erro", "cst_regime", `Emitente do regime normal usando CSOSN ${i.csosn} (o regime normal usa CST).`);
    if (CST_SEM_ICMS.has(i.cst) && i.vICMS > 0) add(i.nItem, "erro", "cst_valor", `CST ${i.cst} (sem ICMS) com ICMS de ${i.vICMS.toFixed(2).replace(".", ",")}.`);
    if (["00", "20"].includes(i.cst) && i.vICMS === 0 && i.vProd > 0) add(i.nItem, "atencao", "cst_valor", `CST ${i.cst} (tributado) sem valor de ICMS.`);
    if (!dentro && CST_TRIBUTADO.has(i.cst) && i.pICMS > 0) {
      const certa = IMPORTADO.has(i.orig) ? 4 : 12;
      if (i.pICMS !== certa) add(i.nItem, "atencao", "aliquota_interestadual", `Alíquota interestadual de ${i.pICMS}% para ${ufEmpresa}: o esperado é ${certa}%${IMPORTADO.has(i.orig) ? " (mercadoria importada, origem " + i.orig + ")" : ""}.`);
    }
    if (n.emitente.crt === 3 && !i.temIbsCbs) add(i.nItem, "atencao", "ibs_cbs", "Sem o grupo do IBS/CBS: obrigatório no regime normal desde 03/08/2026.");
  }
  if (n.finalidade === "4" && !n.referencias.length) add(null, "erro", "devolucao", "Nota de devolução sem a nota de origem (refNFe ou DFeReferenciado).");
  const soma = r2(n.itens.reduce((s, i) => s + i.vProd, 0));
  if (n.itens.length && Math.abs(soma - n.vProd) > 0.01) add(null, "erro", "totais", `Os itens somam ${soma.toFixed(2).replace(".", ",")} e o total dos produtos é ${n.vProd.toFixed(2).replace(".", ",")}.`);
  // Achado igual em vários itens vira um só, com a lista dos itens.
  const juntos = new Map<string, Achado & { itens: number[] }>();
  for (const x of a) {
    const k = `${x.regra}|${x.mensagem}`;
    const j = juntos.get(k);
    if (j) { if (x.nItem) j.itens.push(x.nItem); } else juntos.set(k, { ...x, itens: x.nItem ? [x.nItem] : [] });
  }
  return [...juntos.values()].map(({ itens, ...x }) => ({ ...x, nItem: itens.length === 1 ? itens[0] : null, mensagem: itens.length > 1 ? `Itens ${itens.join(", ")}: ${x.mensagem}` : x.nItem ? `Item ${x.nItem}: ${x.mensagem}` : x.mensagem }));
}

export const situacaoDa = (achados: readonly Achado[]) => (achados.some((x) => x.nivel === "erro") ? "erro" : achados.length ? "atencao" : "ok");
