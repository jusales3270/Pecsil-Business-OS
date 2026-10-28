/**
 * IBS e CBS da reforma (N-03): leitura do grupo IBSCBS (por item) e do IBSCBSTot (total) de um XML de NF-e,
 * para a apuração informativa de 2026 (débitos das saídas − créditos das entradas). Puro: recebe o texto do
 * XML e o CNPJ da empresa. Estrutura conferida no esquema oficial (DFeTiposBasicos, NT 2025.002) e em notas
 * reais de fornecedores (out/2026).
 */

/** Valores do item que formam a base do IBS/CBS (LC 214 art. 12; NT 2025.002): o que soma e o que sai. */
export type ComposicaoBase = { vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number; vII: number; vICMS: number; vFCP: number; vICMSUFDest: number; vFCPUFDest: number; vPIS: number; vCOFINS: number };
export type ItemIbsCbs = { nItem: number; cst: string; cClassTrib: string; vBC: number; pIBSUF: number; vIBSUF: number; pIBSMun: number; vIBSMun: number; pCBS: number; vCBS: number } & ComposicaoBase;
export type NotaIbsCbs = {
  chave: string | null;
  modelo: string | null;
  numero: string | null;
  emissao: string | null;
  competencia: string | null;
  emitenteCnpj: string | null;
  emitenteNome: string | null;
  /** Regime do emitente (CRT): 1 Simples, 2 Simples com excesso de sublimite, 3 normal, 4 MEI. */
  emitenteCrt: number | null;
  destinatarioCnpj: string | null;
  lado: "entrada" | "saida" | "outra";
  /** Nota de devolução, cancelamento etc. (finNFe 4 = devolução). */
  finalidade: string | null;
  temGrupo: boolean;
  itens: ItemIbsCbs[];
  /** Receita da nota com TODOS os itens (os de cima são só os que têm o grupo IBS/CBS): base do Lucro Presumido. */
  receita: ResumoReceita;
  vBC: number;
  vIBSUF: number;
  vIBSMun: number;
  vIBS: number;
  vCBS: number;
  vNF: number;
  vNFTot: number | null;
};

/**
 * Valores da nota por item, sem depender do grupo IBS/CBS. `exportacao` = itens com CFOP 7xxx (fora do PIS/COFINS);
 * `porCfop` = valor dos produtos menos o desconto, por CFOP.
 */
export type ResumoReceita = { vProd: number; vDesc: number; vFrete: number; vSeg: number; vOutro: number; vIPI: number; vICMSST: number; exportacao: number; porCfop: Record<string, number> };

const num = (v: string | null | undefined) => (v ? Number(v) || 0 : 0);
export const tag = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? null;
const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Texto do XML legível: desfaz as entidades (duas vezes, porque há emissor que escapa o & em dobro: "&amp;amp;"). */
export const textoXml = (t: string | null) => {
  if (t === null) return null;
  let v = t;
  for (let k = 0; k < 2; k++) v = v.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e.toLowerCase()]);
  return v.trim();
};
export const bloco = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`))?.[1] ?? null;
const so = (v: string | null) => (v ? v.replace(/\D/g, "") : null);
const r2 = (v: number) => Math.round(Number((v * 100).toFixed(6))) / 100;

export function lerIbsCbs(xml: string, cnpjEmpresa: string): NotaIbsCbs | null {
  const inf = bloco(xml, "infNFe");
  if (!inf) return null;
  const ide = bloco(inf, "ide") ?? "";
  const emit = bloco(inf, "emit") ?? "";
  const dest = bloco(inf, "dest") ?? "";
  const empresa = so(cnpjEmpresa) ?? "";
  const emitente = so(tag(emit, "CNPJ"));
  const destinatario = so(tag(dest, "CNPJ"));
  const emissao = tag(ide, "dhEmi") ?? tag(ide, "dEmi");
  const itens: ItemIbsCbs[] = [];
  const receita: ResumoReceita = { vProd: 0, vDesc: 0, vFrete: 0, vSeg: 0, vOutro: 0, vIPI: 0, vICMSST: 0, exportacao: 0, porCfop: {} };
  for (const m of inf.matchAll(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g)) {
    const p = bloco(m[2], "prod") ?? "";
    const cfop = tag(p, "CFOP") ?? "";
    const liquido = num(tag(p, "vProd")) - num(tag(p, "vDesc"));
    receita.vProd += num(tag(p, "vProd")); receita.vDesc += num(tag(p, "vDesc")); receita.vFrete += num(tag(p, "vFrete")); receita.vSeg += num(tag(p, "vSeg")); receita.vOutro += num(tag(p, "vOutro"));
    receita.vIPI += num(tag(bloco(m[2], "IPI") ?? "", "vIPI")); receita.vICMSST += num(tag(bloco(m[2], "ICMS") ?? "", "vICMSST"));
    if (cfop.startsWith("7")) receita.exportacao += liquido;
    if (cfop) receita.porCfop[cfop] = r2((receita.porCfop[cfop] ?? 0) + liquido);
    const g = bloco(m[2], "IBSCBS");
    if (!g) continue;
    const valores = bloco(g, "gIBSCBS") ?? "";
    const uf = bloco(valores, "gIBSUF") ?? "";
    const mun = bloco(valores, "gIBSMun") ?? "";
    const cbs = bloco(valores, "gCBS") ?? "";
    const prod = bloco(m[2], "prod") ?? "";
    const icms = bloco(m[2], "ICMS") ?? "";
    const dif = bloco(m[2], "ICMSUFDest") ?? "";
    itens.push({
      nItem: Number(m[1]), cst: tag(g, "CST") ?? "", cClassTrib: tag(g, "cClassTrib") ?? "",
      vProd: num(tag(prod, "vProd")), vDesc: num(tag(prod, "vDesc")), vFrete: num(tag(prod, "vFrete")), vSeg: num(tag(prod, "vSeg")), vOutro: num(tag(prod, "vOutro")),
      vII: num(tag(bloco(m[2], "II") ?? "", "vII")), vICMS: num(tag(icms, "vICMS")), vFCP: num(tag(icms, "vFCP")),
      vICMSUFDest: num(tag(dif, "vICMSUFDest")), vFCPUFDest: num(tag(dif, "vFCPUFDest")),
      vPIS: num(tag(bloco(m[2], "PIS") ?? "", "vPIS")), vCOFINS: num(tag(bloco(m[2], "COFINS") ?? "", "vCOFINS")),
      vBC: num(tag(valores, "vBC")), pIBSUF: num(tag(uf, "pIBSUF")), vIBSUF: num(tag(uf, "vIBSUF")),
      pIBSMun: num(tag(mun, "pIBSMun")), vIBSMun: num(tag(mun, "vIBSMun")), pCBS: num(tag(cbs, "pCBS")), vCBS: num(tag(cbs, "vCBS")),
    });
  }
  const total = bloco(inf, "total") ?? "";
  const tot = bloco(total, "IBSCBSTot");
  const soma = (k: keyof ItemIbsCbs) => r2(itens.reduce((a, i) => a + Number(i[k]), 0));
  // O total do XML vale; sem ele, a soma dos itens.
  const gIBS = tot ? bloco(tot, "gIBS") ?? "" : "";
  const vIBSUF = tot ? num(tag(bloco(gIBS, "gIBSUF") ?? "", "vIBSUF")) : soma("vIBSUF");
  const vIBSMun = tot ? num(tag(bloco(gIBS, "gIBSMun") ?? "", "vIBSMun")) : soma("vIBSMun");
  const vCBS = tot ? num(tag(bloco(tot, "gCBS") ?? "", "vCBS")) : soma("vCBS");
  const vNFTotTxt = tag(total, "vNFTot");
  return {
    chave: inf.length ? (xml.match(/<infNFe[^>]*Id="NFe(\d{44})"/)?.[1] ?? null) : null,
    modelo: tag(ide, "mod"), numero: tag(ide, "nNF"),
    emissao, competencia: emissao ? emissao.slice(0, 7) : null,
    emitenteCnpj: emitente, emitenteNome: textoXml(tag(emit, "xNome")), emitenteCrt: tag(emit, "CRT") ? Number(tag(emit, "CRT")) : null, destinatarioCnpj: destinatario,
    lado: emitente === empresa ? "saida" : destinatario === empresa ? "entrada" : "outra",
    finalidade: tag(ide, "finNFe"),
    temGrupo: itens.length > 0,
    itens,
    receita: { ...receita, vProd: r2(receita.vProd), vDesc: r2(receita.vDesc), vFrete: r2(receita.vFrete), vSeg: r2(receita.vSeg), vOutro: r2(receita.vOutro), vIPI: r2(receita.vIPI), vICMSST: r2(receita.vICMSST), exportacao: r2(receita.exportacao) },
    vBC: tot ? num(tag(tot, "vBCIBSCBS")) : soma("vBC"),
    vIBSUF, vIBSMun, vIBS: r2(vIBSUF + vIBSMun), vCBS,
    vNF: num(tag(bloco(total, "ICMSTot") ?? "", "vNF")),
    vNFTot: vNFTotTxt === null ? null : num(vNFTotTxt),
  };
}

export type LinhaApuracao = { competencia: string; debitoIBS: number; debitoCBS: number; creditoIBS: number; creditoCBS: number; saldoIBS: number; saldoCBS: number; notasSaida: number; notasEntrada: number; semGrupo: number; simplesSemGrupo: number };

/** Simples Nacional (CRT 1, 2 e 4): o grupo do IBS/CBS só é obrigatório para ele a partir de 01/01/2027. */
export const doSimples = (crt: number | null | undefined) => crt === 1 || crt === 2 || crt === 4;

/**
 * Apuração informativa por competência (2026: o recolhimento é dispensado para quem cumpre as obrigações
 * acessórias, LC 214 art. 348). Saída gera débito; entrada gera crédito (não-cumulatividade ampla, art. 47).
 * Devolução (finNFe 4) inverte o lado. Nota sem o grupo conta à parte, para cobrar do fornecedor; a do Simples
 * Nacional, dispensado do grupo em 2026, conta à parte de novo, sem ser cobrança.
 */
export function apurar(notas: NotaIbsCbs[]): LinhaApuracao[] {
  const porMes = new Map<string, LinhaApuracao>();
  for (const n of notas) {
    if (!n.competencia || n.lado === "outra") continue;
    const l = porMes.get(n.competencia) ?? { competencia: n.competencia, debitoIBS: 0, debitoCBS: 0, creditoIBS: 0, creditoCBS: 0, saldoIBS: 0, saldoCBS: 0, notasSaida: 0, notasEntrada: 0, semGrupo: 0, simplesSemGrupo: 0 };
    if (!n.temGrupo) { if (doSimples(n.emitenteCrt) && n.competencia < "2027-01") l.simplesSemGrupo++; else l.semGrupo++; porMes.set(n.competencia, l); continue; }
    const devolucao = n.finalidade === "4";
    const debito = (n.lado === "saida") !== devolucao;
    if (debito) { l.debitoIBS = r2(l.debitoIBS + n.vIBS); l.debitoCBS = r2(l.debitoCBS + n.vCBS); }
    else { l.creditoIBS = r2(l.creditoIBS + n.vIBS); l.creditoCBS = r2(l.creditoCBS + n.vCBS); }
    if (n.lado === "saida") l.notasSaida++; else l.notasEntrada++;
    l.saldoIBS = r2(l.debitoIBS - l.creditoIBS);
    l.saldoCBS = r2(l.debitoCBS - l.creditoCBS);
    porMes.set(n.competencia, l);
  }
  return [...porMes.values()].sort((a, b) => b.competencia.localeCompare(a.competencia));
}

/**
 * A mesma NF-e pode chegar por dois caminhos (enviada no Fiscal e no recebimento do Almoxarifado): conta uma vez,
 * pela chave de acesso, ficando a primeira lida. Sem chave, não há como saber: fica.
 */
export function semRepetidas<T extends { chave: string | null }>(notas: readonly T[]): { notas: T[]; repetidas: number } {
  const vistas = new Set<string>();
  const unicas: T[] = [];
  for (const n of notas) {
    if (n.chave && vistas.has(n.chave)) continue;
    if (n.chave) vistas.add(n.chave);
    unicas.push(n);
  }
  return { notas: unicas, repetidas: notas.length - unicas.length };
}
