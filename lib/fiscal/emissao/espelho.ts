/**
 * Espelho do GRV (docs/PLANO-VIRADA-FISCAL.md, trava 1): uma NF-e autorizada que o sistema antigo emitiu vira nota
 * da plataforma, a plataforma gera o XML de novo com os mesmos dados e os dois XML são comparados campo a campo.
 * Operação cujo espelho não bate não é liberada para produção.
 *
 * `notaDoXml` também serve para trazer uma nota existente para a plataforma (duplicar, devolver, conferir). Puro.
 */
import { achar, achatar, filho, filhos, lerXml, num, txt, type NoXml } from "../xml-arvore";
import { emailsValidos } from "./email";
import { gerarXmlNfe } from "./xml";
import type { Emitente, ItemNfe, NotaNfe } from "./tipos";

export type NotaLida = {
  nota: NotaNfe; emitente: Emitente; serie: number; numero: number; emissao: Date; codigoNumerico: string; tpAmb: 1 | 2; chave: string;
};

const so = (t: string) => t.replace(/\D/g, "");
const umDe = <T extends number>(v: number, validos: readonly T[], padrao: T): T => (validos.includes(v as T) ? (v as T) : padrao);

function itemDoDet(det: NoXml): ItemNfe {
  const prod = filho(det, "prod");
  const imposto = filho(det, "imposto");
  const icms = filho(imposto, "ICMS")?.filhos[0] ?? null;
  const ipi = filho(imposto, "IPI");
  const ipiGrupo = filho(ipi, "IPITrib") ?? filho(ipi, "IPINT");
  const pis = filho(imposto, "PIS")?.filhos[0] ?? null;
  const cofins = filho(imposto, "COFINS")?.filhos[0] ?? null;
  const ibscbs = filho(imposto, "IBSCBS");
  const g = filho(ibscbs, "gIBSCBS");
  const vProd = num(prod, "vProd"), vDesc = num(prod, "vDesc"), vICMS = num(icms, "vICMS");
  const basePis = num(pis, "vBC");
  return {
    codigo: txt(prod, "cProd"), descricao: txt(prod, "xProd"), ncm: txt(prod, "NCM"), cfop: txt(prod, "CFOP"), unidade: txt(prod, "uCom"),
    quantidade: num(prod, "qCom"), valorUnitario: num(prod, "vUnCom"), desconto: vDesc, origem: num(icms, "orig"),
    icmsCst: txt(icms, "CST") || txt(icms, "CSOSN"), icmsAliquota: num(icms, "pICMS") || num(icms, "pCredSN"), icmsReducaoBase: num(icms, "pRedBC"),
    ipiCst: txt(ipiGrupo, "CST"), ipiAliquota: num(ipiGrupo, "pIPI"), ipiEnquadramento: txt(ipi, "cEnq") || undefined,
    pisCst: txt(pis, "CST"), pisAliquota: num(pis, "pPIS"), cofinsCst: txt(cofins, "CST"), cofinsAliquota: num(cofins, "pCOFINS"),
    // A base do PIS/COFINS sem o ICMS (Tema 69) só se vê pela conta: base (ou o valor) = (produto − desconto − ICMS) × alíquota.
    ...(vICMS > 0 && basePis > 0 && (Math.abs(basePis - (vProd - vDesc - vICMS)) < 0.02
      || (num(pis, "pPIS") > 0 && Math.abs(num(pis, "vPIS") - Math.round((vProd - vDesc - vICMS) * num(pis, "pPIS")) / 100) < 0.015 && Math.abs(num(pis, "vPIS") - Math.round(basePis * num(pis, "pPIS")) / 100) > 0.015))
      ? { pisCofinsExcluiIcms: true } : {}),
    ...(filho(det, "impostoDevol") ? { ipiDevolvido: { percentual: num(det, "impostoDevol/pDevol"), valor: num(det, "impostoDevol/IPI/vIPIDevol") } } : {}),
    ...(ibscbs ? { ibsCbsCst: txt(ibscbs, "CST"), cClassTrib: txt(ibscbs, "cClassTrib"), ibsAliquota: num(g, "gIBSUF/pIBSUF"), cbsAliquota: num(g, "gCBS/pCBS") } : {}),
    ...(txt(prod, "xPed") ? { pedidoCompra: txt(prod, "xPed") } : {}),
    ...(txt(prod, "nItemPed") ? { itemPedido: txt(prod, "nItemPed") } : {}),
    ...(txt(prod, "cBenef") ? { cBenef: txt(prod, "cBenef") } : {}),
    ...(Math.abs(vProd - Math.round(num(prod, "qCom") * num(prod, "vUnCom") * 100) / 100) > 0.0001 ? { valorTotal: vProd } : {}),
    ...(txt(prod, "uTrib") !== txt(prod, "uCom") || num(prod, "qTrib") !== num(prod, "qCom") || num(prod, "vUnTrib") !== num(prod, "vUnCom")
      ? { tributavel: { unidade: txt(prod, "uTrib"), quantidade: num(prod, "qTrib"), valorUnitario: num(prod, "vUnTrib") } } : {}),
    ...(txt(det, "infAdProd") ? { infoAdicional: txt(det, "infAdProd") } : {}),
    ...(filho(imposto, "II") ? { ii: { vBC: num(imposto, "II/vBC"), vDespAdu: num(imposto, "II/vDespAdu"), vII: num(imposto, "II/vII"), vIOF: num(imposto, "II/vIOF") } } : {}),
    ...(filhos(prod, "DI").length ? { di: filhos(prod, "DI").map((d) => ({
      numero: txt(d, "nDI"), data: txt(d, "dDI"), localDesembaraco: txt(d, "xLocDesemb"), ufDesembaraco: txt(d, "UFDesemb"), dataDesembaraco: txt(d, "dDesemb"),
      viaTransporte: num(d, "tpViaTransp"), ...(txt(d, "vAFRMM") ? { vAFRMM: num(d, "vAFRMM") } : {}), intermedio: num(d, "tpIntermedio"),
      documentoAdquirente: txt(d, "CNPJ") || txt(d, "CPF") || undefined, ufTerceiro: txt(d, "UFTerceiro") || undefined, exportador: txt(d, "cExportador"),
      adicoes: filhos(d, "adi").map((a) => ({ numero: num(a, "nAdicao"), sequencial: num(a, "nSeqAdic"), fabricante: txt(a, "cFabricante"), ...(txt(a, "vDescDI") ? { desconto: num(a, "vDescDI") } : {}), ...(txt(a, "nDraw") ? { drawback: txt(a, "nDraw") } : {}) })),
    })) } : {}),
    ...(filhos(prod, "detExport").length ? { exportacao: filhos(prod, "detExport").map((x) => ({
      ...(filho(x, "nDraw") ? { drawback: txt(x, "nDraw") } : {}),
      ...(filho(x, "exportInd") ? { indireta: { registro: txt(x, "exportInd/nRE"), chave: txt(x, "exportInd/chNFe"), quantidade: num(x, "exportInd/qExport") } } : {}),
    })) } : {}),
    ...informadoDoDet(icms, ipiGrupo, pis, cofins, prod, g),
    ...(/^(49|[5-9]\d)$/.test(txt(pis, "CST")) && filho(pis, "vBC") && num(pis, "vBC") === 0 ? { pisCofinsSemBase: true } : {}),
    ...(icmsPorDentro(icms, prod) ? { icmsPorDentro: true } : {}),
    ...(ipiNaBase(icms, prod, ipiGrupo, det) ? { ipiNaBaseIcms: true } : {}),
    ...(txt(icms, "modBC") && txt(icms, "modBC") !== "3" ? { icmsModBC: num(icms, "modBC") as 0 | 1 | 2 } : {}),
  };
}

/** IPI (ou IPI devolvido) na base do ICMS: a base é o valor do item mais o IPI. */
function ipiNaBase(icms: NoXml | null, prod: NoXml | null, ipi: NoXml | null, det: NoXml): boolean {
  const ipiValor = num(ipi, "vIPI") + num(det, "impostoDevol/IPI/vIPIDevol");
  if (!(ipiValor > 0) || num(icms, "pRedBC")) return false;
  const valor = num(prod, "vProd") - num(prod, "vDesc") + num(prod, "vFrete") + num(prod, "vSeg") + num(prod, "vOutro");
  return Math.abs(num(icms, "vBC") - (valor + ipiValor)) < 0.02;
}

/** ICMS por dentro: a base é o valor dividido por (1 − alíquota), como na sucata do art. 392 do RICMS/SP. */
function icmsPorDentro(icms: NoXml | null, prod: NoXml | null): boolean {
  const p = num(icms, "pICMS") / 100, vBC = num(icms, "vBC");
  const valor = num(prod, "vProd") - num(prod, "vDesc") + num(prod, "vFrete") + num(prod, "vSeg") + num(prod, "vOutro");
  if (!(p > 0 && p < 1 && vBC > 0 && valor > 0) || num(icms, "pRedBC")) return false;
  return Math.abs(vBC - valor) > 0.02 && Math.abs(vBC - valor / (1 - p)) < 0.02;
}

/**
 * Valores que a conta da plataforma não refaz (importação pela DI, ajuste do CIAP): quando a nota é de entrada
 * vinda do exterior ou de ajuste, os valores do imposto entram como informados.
 */
function informadoDoDet(icms: NoXml | null, ipi: NoXml | null, pis: NoXml | null, cofins: NoXml | null, prod: NoXml | null, ibscbs: NoXml | null): Pick<ItemNfe, "informado"> {
  const cfop = txt(prod, "CFOP");
  if (!/^3/.test(cfop) && cfop !== "1604" && !(num(prod, "vProd") === 0 && num(icms, "vICMS") > 0)) return {};
  return {
    informado: {
      vBC: num(icms, "vBC"), vICMS: num(icms, "vICMS"), vBCIPI: num(ipi, "vBC"), vIPI: num(ipi, "vIPI"), vBCPisCofins: num(pis, "vBC"), vPIS: num(pis, "vPIS"), vBCCofins: num(cofins, "vBC"), vCOFINS: num(cofins, "vCOFINS"),
      ...(ibscbs ? { vBCIBSCBS: num(ibscbs, "vBC"), vIBS: num(ibscbs, "gIBSUF/vIBSUF") + num(ibscbs, "gIBSMun/vIBSMun"), vCBS: num(ibscbs, "gCBS/vCBS") } : {}),
    },
  };
}

/** NF-e (nfeProc ou NFe) → nota da plataforma, com o emitente e a numeração. */
export function notaDoXml(xml: string): NotaLida {
  const raiz = lerXml(xml);
  const inf = achar(raiz, "infNFe") ?? (raiz.nome === "infNFe" ? raiz : null);
  if (!inf) throw new Error("O arquivo não é uma NF-e.");
  const ide = filho(inf, "ide"), emit = filho(inf, "emit"), dest = filho(inf, "dest");
  const ee = filho(emit, "enderEmit"), ed = filho(dest, "enderDest");
  const transp = filho(inf, "transp"), transporta = filho(transp, "transporta"), vol = filho(transp, "vol");
  const dets = filhos(inf, "det");
  const total = filho(inf, "total/ICMSTot");
  const pais = txt(ed, "cPais");
  const docDest = txt(dest, "CNPJ") || txt(dest, "CPF") || txt(dest, "idEstrangeiro");
  const refs = filhos(ide, "NFref").map((r) => txt(r, "refNFe")).filter(Boolean);
  const nota: NotaNfe = {
    natureza: txt(ide, "natOp"),
    finalidade: umDe(num(ide, "finNFe"), [1, 2, 3, 4] as const, 1),
    tipo: umDe(num(ide, "tpNF"), [0, 1] as const, 1),
    consumidorFinal: txt(ide, "indFinal") === "1",
    presenca: umDe(num(ide, "indPres"), [0, 1, 2, 9] as const, 9),
    destinatario: {
      documento: pais && pais !== "1058" ? txt(dest, "idEstrangeiro") : so(docDest), nome: txt(dest, "xNome"), indIE: umDe(num(dest, "indIEDest"), [1, 2, 9] as const, 1), ie: txt(dest, "IE"), email: txt(dest, "email"),
      logradouro: txt(ed, "xLgr"), numero: txt(ed, "nro"), complemento: txt(ed, "xCpl"), bairro: txt(ed, "xBairro"),
      codigoMunicipio: txt(ed, "cMun"), municipio: txt(ed, "xMun"), uf: txt(ed, "UF"), cep: txt(ed, "CEP"), fone: txt(ed, "fone"),
      ...(pais && pais !== "1058" ? { pais, nomePais: txt(ed, "xPais") } : {}),
    },
    itens: dets.map(itemDoDet),
    frete: {
      modalidade: umDe(num(transp, "modFrete"), [0, 1, 2, 3, 4, 9] as const, 9), valor: num(total, "vFrete"),
      transportadora: transporta ? {
        documento: txt(transporta, "CNPJ") || txt(transporta, "CPF"), nome: txt(transporta, "xNome"), ie: txt(transporta, "IE"), uf: txt(transporta, "UF"),
        ...(txt(transporta, "xEnder") ? { endereco: txt(transporta, "xEnder") } : {}), ...(txt(transporta, "xMun") ? { municipio: txt(transporta, "xMun") } : {}),
      } : null,
      veiculo: filho(transp, "veicTransp") ? { placa: txt(transp, "veicTransp/placa"), uf: txt(transp, "veicTransp/UF"), ...(txt(transp, "veicTransp/RNTC") ? { rntc: txt(transp, "veicTransp/RNTC") } : {}) } : null,
      volumes: vol ? {
        quantidade: num(vol, "qVol"), especie: txt(vol, "esp"), pesoLiquido: num(vol, "pesoL"), pesoBruto: num(vol, "pesoB"),
        ...(filho(vol, "marca") ? { marca: txt(vol, "marca") } : {}), ...(filho(vol, "nVol") ? { numeracao: txt(vol, "nVol") } : {}),
      } : null,
    },
    seguro: num(total, "vSeg"), outrasDespesas: num(total, "vOutro"),
    pagamento: {
      forma: txt(filho(inf, "pag/detPag"), "tPag") || "90",
      duplicatas: filhos(filho(inf, "cobr"), "dup").map((d) => ({ numero: txt(d, "nDup"), vencimento: txt(d, "dVenc"), valor: num(d, "vDup") })),
      ...(filhos(filho(inf, "pag"), "detPag").length > 1 ? { partes: filhos(filho(inf, "pag"), "detPag").map((p) => ({ forma: txt(p, "tPag"), valor: num(p, "vPag") })) } : {}),
    },
    infoComplementar: txt(inf, "infAdic/infCpl"),
    ...(refs[0] ? { referencia: refs[0] } : {}),
    ...(refs.length > 1 ? { referencias: refs.slice(1) } : {}),
    ...(txt(inf, "infAdic/infAdFisco") ? { infoFisco: txt(inf, "infAdic/infAdFisco") } : {}),
    ...(txt(ide, "dhSaiEnt") ? { saidaEntrada: txt(ide, "dhSaiEnt") } : {}),
    ...(filho(inf, "exporta") ? { exportacao: { ufSaida: txt(inf, "exporta/UFSaidaPais"), localExportacao: txt(inf, "exporta/xLocExporta"), ...(txt(inf, "exporta/xLocDespacho") ? { localDespacho: txt(inf, "exporta/xLocDespacho") } : {}) } } : {}),
  };
  // Total informado só quando a conta padrão não fecha (importação: a DI soma tributos e despesas aduaneiras).
  const padrao = Math.round((num(total, "vProd") - num(total, "vDesc") + num(total, "vFrete") + num(total, "vSeg") + num(total, "vOutro") + num(total, "vII") + num(total, "vIPI")) * 100) / 100;
  if (Math.abs(padrao - num(total, "vNF")) > 0.005 && nota.itens.some((i) => i.informado)) nota.valorTotalInformado = num(total, "vNF");
  const emitente: Emitente = {
    cnpj: txt(emit, "CNPJ"), razaoSocial: txt(emit, "xNome"), fantasia: txt(emit, "xFant") || null, ie: txt(emit, "IE"), im: txt(emit, "IM") || null, cnae: txt(emit, "CNAE") || null,
    crt: num(emit, "CRT"), logradouro: txt(ee, "xLgr"), numero: txt(ee, "nro"), complemento: txt(ee, "xCpl") || null, bairro: txt(ee, "xBairro"),
    codigoMunicipio: txt(ee, "cMun"), municipio: txt(ee, "xMun"), uf: txt(ee, "UF"), cep: txt(ee, "CEP"), telefone: txt(ee, "fone") || null,
  };
  return {
    nota, emitente, serie: num(ide, "serie"), numero: num(ide, "nNF"), emissao: new Date(txt(ide, "dhEmi")), codigoNumerico: txt(ide, "cNF"),
    tpAmb: txt(ide, "tpAmb") === "1" ? 1 : 2, chave: (inf.atributos.Id ?? "").replace(/^NFe/, ""),
  };
}

export type Diferenca = { caminho: string; nosso: string | null; deles: string | null };

/** Partes que não entram na comparação: assinatura, protocolo e a versão do programa emissor. */
const FORA = [/\/Signature(\/|$)/, /^nfeProc\/protNFe/, /\/ide\/verProc$/];

/** Caminho sem o envelope (nfeProc/NFe/…): os dois lados começam em infNFe. */
const doInfNFe = (mapa: Map<string, string>) => {
  const saida = new Map<string, string>();
  for (const [k, v] of mapa) {
    const i = k.indexOf("infNFe");
    if (i < 0 || FORA.some((re) => re.test(k))) continue;
    saida.set(k.slice(i), v);
  }
  return saida;
};

/** Mesmo valor? Números comparados como número (0.9000 = 0.90); texto, depois de aparar os espaços. */
const igual = (a: string, b: string) => {
  if (a === b) return true;
  const na = Number(a), nb = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.000001;
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
};

export function compararXml(nosso: string, deles: string): Diferenca[] {
  const a = doInfNFe(achatar(lerXml(nosso)));
  const b = doInfNFe(achatar(lerXml(deles)));
  const difs: Diferenca[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k) ?? null, y = b.get(k) ?? null;
    if (x !== null && y !== null && igual(x, y)) continue;
    difs.push({ caminho: k, nosso: x, deles: y });
  }
  return difs.sort((p, q) => p.caminho.localeCompare(q.caminho));
}

/**
 * Diferenças aceitas, cada uma com o motivo. Tudo o que não estiver aqui reprova o espelho. Regra nova só entra
 * com a razão fiscal escrita (e, se for regra de tributo, com o Jefferson).
 */
type Contexto = NotaLida & { notaTotal: number; deles: Map<string, string>; ibsBaseGrvIncoerente: boolean };
type Regra = { caminho: RegExp; motivo: string; vale?: (d: Diferenca, lida: Contexto) => boolean };
/** Soma de um campo de todos os itens do XML deles (ex.: a base do ICMS de cada item). */
const somaDosItens = (deles: Map<string, string>, fim: RegExp) => {
  let t = 0;
  for (const [k, v] of deles) if (/^infNFe\/det(\[\d+\])?\//.test(k) && fim.test(k)) t += Number(v) || 0;
  return Math.round(t * 100) / 100;
};
const numero = (v: string | null) => (v === null || v === "" ? null : Number(v));
export const DIFERENCAS_ACEITAS: Regra[] = [
  {
    caminho: /ide\/NFref(\[\d+\])?\/refNFe$/,
    motivo: "Devolução emitida antes de 03/11/2026 referenciava a nota pelo refNFe; desde então a SEFAZ exige a referência por item (DFeReferenciado) e proíbe o refNFe (NT 2025.002 v1.52), que é o que a plataforma faz.",
    vale: (d, l) => d.nosso === null && l.nota.finalidade === 4 && l.emissao < new Date("2026-11-03T00:00:00-03:00"),
  },
  {
    caminho: /(ICMSTot|imposto)\/vTotTrib$/,
    motivo: "Total aproximado de tributos (Lei 12.741/2012) é exigido na venda ao consumidor; a nota não é venda a consumidor final.",
    vale: (_d, l) => !(l.nota.consumidorFinal && l.nota.finalidade === 1 && l.nota.itens.some((i) => /^[567]1\d\d$/.test(i.cfop))),
  },
  { caminho: /pag\/detPag(\[\d+\])?\/card\//, motivo: "Grupo de cartão: o GRV o manda no boleto; a plataforma só o usa em pagamento com cartão." },
  {
    caminho: /cobr\/fat\//, motivo: "Fatura zerada sem duplicata: o grupo é opcional e, sem duplicata, a plataforma não o manda.",
    vale: (d, l) => d.nosso === null && !l.nota.pagamento.duplicatas.length,
  },
  { caminho: /pag\/detPag\/indPag$/, motivo: "Sem pagamento (tPag 90): o indicador de prazo é opcional.", vale: (d, l) => d.nosso === null && l.nota.pagamento.forma === "90" },
  { caminho: /\/vItem$/, motivo: "Valor do item: a versão antiga do GRV não mandava; a atual manda, e a plataforma também.", vale: (d) => d.deles === null },
  {
    caminho: /\/vItem$/, motivo: "Valor do item na importação: o GRV manda valores sem regra fixa (ora com despesas, ora sem); o campo é opcional e a plataforma não o manda em item com valores da DI.",
    vale: (d, l) => d.nosso === null && l.nota.itens.some((i) => i.informado),
  },
  {
    caminho: /(\/IBSCBS\/gIBSCBS\/|^infNFe\/total\/IBSCBSTot\/)/,
    motivo: "Base do IBS/CBS: o GRV descontou o PIS/COFINS calculado sobre o valor cheio, mas imprimiu o PIS/COFINS com o ICMS descontado; a plataforma desconta o que imprime.",
    vale: (_d, l) => l.ibsBaseGrvIncoerente,
  },
  {
    caminho: /total\/vNFTot$/, motivo: "Em 2026 o GRV atual (6.0.12.D.1) põe o total igual ao valor da nota, como a plataforma; duas notas de janeiro somaram o IBS/CBS.",
    vale: (d, l) => numero(d.nosso) === l.notaTotal,
  },
  {
    caminho: /total\/vNFTot$/, motivo: "Nota de valor zero (ajuste do CIAP): o esquema não aceita total zero, então a plataforma não manda o campo; o GRV pôs ali o ICMS do crédito.",
    vale: (d, l) => d.nosso === null && l.notaTotal === 0,
  },
  {
    caminho: /\/(v[A-Z]\w*|vBC\w*)$/, motivo: "Um centavo de arredondamento: a conta da plataforma (base × alíquota, arredondada) está certa.",
    vale: (d) => { const a = numero(d.nosso), b = numero(d.deles); return a !== null && b !== null && Math.abs(a - b) <= 0.0100001; },
  },
  {
    caminho: /^infNFe\/total\/(ICMSTot|IBSCBSTot)\/.*v\w+$/, motivo: "Total: soma dos centavos de arredondamento dos itens (no máximo um centavo por item).",
    vale: (d, l) => { const a = numero(d.nosso), b = numero(d.deles); return a !== null && b !== null && Math.abs(a - b) <= 0.0100001 * Math.max(1, l.nota.itens.length); },
  },
  {
    caminho: /^infNFe\/total\/ICMSTot\/vBC$/, motivo: "O total da base do ICMS do GRV não fecha com a soma dos itens dele; a plataforma soma os itens.",
    vale: (d, l) => numero(d.deles) !== somaDosItens(l.deles, /\/imposto\/ICMS\/ICMS\w+\/vBC$/) && numero(d.nosso) === somaDosItens(l.deles, /\/imposto\/ICMS\/ICMS\w+\/vBC$/),
  },
  {
    caminho: /\/imposto\/IPI\/IPITrib\/vBC$/, motivo: "IPI com alíquota zero: a base não gera imposto; o GRV ora manda zero, ora o valor do produto.",
    vale: (d, l) => Number(l.deles.get(d.caminho.replace(/vBC$/, "pIPI")) ?? 0) === 0,
  },
  {
    caminho: /\/imposto\/(PIS\/PISOutr|COFINS\/COFINSOutr)\/vBC$/, motivo: "O GRV imprimiu a base do PIS/COFINS sem descontar o ICMS, mas calculou o valor com o ICMS descontado (Tema 69); a plataforma imprime a base que usou.",
    vale: (d, l) => {
      const icms = [...l.deles].find(([k]) => k.startsWith(d.caminho.split("/imposto/")[0] + "/imposto/ICMS/") && k.endsWith("/vICMS"))?.[1];
      const a = numero(d.nosso), b = numero(d.deles);
      return a !== null && b !== null && icms !== undefined && Math.abs(b - Number(icms) - a) < 0.02;
    },
  },
  {
    caminho: /^infNFe\/dest\/email$/, motivo: "E-mail inválido (o GRV cortou o texto em 60 caracteres): a plataforma não manda e-mail inválido; o campo é opcional.",
    vale: (d) => d.nosso === null && d.deles !== null && !emailsValidos(d.deles),
  },
  { caminho: /^infNFe\/transp\/vagao$/, motivo: "O GRV usou o campo de vagão (transporte ferroviário) para outro texto; a plataforma não o usa." },
];

export type Veredito = { diferenca: Diferenca; aceita: boolean; motivo: string | null };

export function classificar(diferencas: Diferenca[], lida: Contexto): Veredito[] {
  return diferencas.map((d) => {
    const regra = DIFERENCAS_ACEITAS.find((r) => r.caminho.test(d.caminho) && (r.vale ? r.vale(d, lida) : true));
    return { diferenca: d, aceita: Boolean(regra), motivo: regra?.motivo ?? null };
  });
}

/** Item do GRV cuja base do IBS/CBS desconta PIS/COFINS sobre o valor cheio, diferentes dos que a nota imprime. */
function ibsBaseIncoerente(xml: string): boolean {
  const inf = achar(lerXml(xml), "infNFe");
  return filhos(inf, "det").some((det) => {
    const prod = filho(det, "prod"), imp = filho(det, "imposto");
    const pis = filho(imp, "PIS")?.filhos[0] ?? null, cofins = filho(imp, "COFINS")?.filhos[0] ?? null;
    const base = num(filho(imp, "IBSCBS"), "gIBSCBS/vBC");
    if (!base) return false;
    const vProd = num(prod, "vProd"), vICMS = num(filho(imp, "ICMS")?.filhos[0], "vICMS");
    const cheio = Math.round((vProd - vICMS - Math.round(vProd * num(pis, "pPIS")) / 100 - Math.round(vProd * num(cofins, "pCOFINS")) / 100) * 100) / 100;
    const impresso = Math.round((vProd - vICMS - num(pis, "vPIS") - num(cofins, "vCOFINS")) * 100) / 100;
    return Math.abs(base - cheio) < 0.015 && Math.abs(base - impresso) > 0.015;
  });
}

/** A nota do GRV refeita pela plataforma e comparada com a original. `bate` = só diferenças aceitas. */
export function espelhar(xmlDeles: string): { lida: NotaLida; xmlNosso: string; diferencas: Diferenca[]; vereditos: Veredito[]; bate: boolean } {
  const lida = notaDoXml(xmlDeles);
  const { xml, totais } = gerarXmlNfe({ nota: lida.nota, emitente: lida.emitente, serie: lida.serie, numero: lida.numero, emissao: lida.emissao, codigoNumerico: lida.codigoNumerico, tpAmb: lida.tpAmb });
  const diferencas = compararXml(xml, xmlDeles);
  const deles = doInfNFe(achatar(lerXml(xmlDeles)));
  const vereditos = classificar(diferencas, { ...lida, notaTotal: totais.vNF, deles, ibsBaseGrvIncoerente: ibsBaseIncoerente(xmlDeles) });
  return { lida, xmlNosso: xml, diferencas, vereditos, bate: vereditos.every((v) => v.aceita) };
}
