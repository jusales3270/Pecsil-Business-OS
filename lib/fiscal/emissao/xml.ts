/**
 * XML da NF-e 4.00 gerado pela PRÓPRIA plataforma (a dona da nota). O transmissor só valida,
 * assina e transmite. A ordem dos elementos segue o esquema oficial (leiaute 4.00); quem confere
 * é o validador do esquema, chamado antes de qualquer transmissão.
 *
 * No TREINO a nota não é assinada (não há certificado): entra uma assinatura de estrutura válida e
 * conteúdo fictício, só para o esquema conferir o resto. Ela nunca sai da plataforma.
 */
import { calcularItens, calcularTotais, ibsCbsTributa, icmsDestaca, ipiTributado, pisCofinsComAliquota, r2, valorTotalDoItem } from "./calculo";
import { exterior } from "./destino";
import { emailsValidos } from "./email";
import type { Emitente, NotaNfe, Totais } from "./tipos";

const UF_IBGE: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29",
  MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};
export const codigoUf = (uf: string) => UF_IBGE[uf.toUpperCase()] ?? "";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
/** Texto do XML: sem quebras nem espaços duplos (o esquema não aceita espaço no começo/fim). */
const tx = (t: string | null | undefined, max = 60) => esc(String(t ?? "").replace(/\s+/g, " ").trim().slice(0, max));
const d2 = (v: number) => r2(v).toFixed(2);
const d4 = (v: number) => (Math.round(v * 10000) / 10000).toFixed(4);
/** Valor unitário: até 10 casas (TDec_1110), no mínimo 4, sem zeros sobrando (585,676625 fica 585.676625). */
const d10 = (v: number) => { const t = (Math.round(v * 1e10) / 1e10).toFixed(10).replace(/0+$/, ""); const [i, f = ""] = t.split("."); return `${i}.${f.padEnd(4, "0")}`; };
const so = (t: string | null | undefined) => String(t ?? "").replace(/\D/g, "");
const tag = (nome: string, valor: string | null | undefined) => (valor === null || valor === undefined || valor === "" ? "" : `<${nome}>${valor}</${nome}>`);

/** Dígito verificador da chave (módulo 11, pesos 2 a 9). */
export function dvChave(base43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Chave de acesso: cUF + AAMM + CNPJ + modelo 55 + série + número + tpEmis 1 + código numérico + DV. */
export function chaveDeAcesso(p: { uf: string; emissao: Date; cnpj: string; serie: number; numero: number; codigoNumerico: string }): string {
  const br = dataHoraBrasilia(p.emissao);
  const aamm = br.slice(2, 4) + br.slice(5, 7);
  const base = codigoUf(p.uf) + aamm + so(p.cnpj).padStart(14, "0") + "55" + String(p.serie).padStart(3, "0") + String(p.numero).padStart(9, "0") + "1" + p.codigoNumerico.padStart(8, "0");
  return base + dvChave(base);
}

/** Data e hora no fuso de Brasília (-03:00), como a SEFAZ pede. */
export const dataHoraBrasilia = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "-03:00");

export type GerarXml = {
  nota: NotaNfe; emitente: Emitente; serie: number; numero: number; emissao: Date; codigoNumerico: string;
  /** 1 produção; 2 homologação (o treino também gera como 2). */
  tpAmb: 1 | 2;
};

export function idDestino(emitenteUf: string, destUf: string, pais?: string): 1 | 2 | 3 {
  if (exterior(pais) || destUf.toUpperCase() === "EX") return 3;
  return emitenteUf.toUpperCase() === destUf.toUpperCase() ? 1 : 2;
}

export function gerarXmlNfe(g: GerarXml): { xml: string; chave: string; totais: Totais } {
  const { nota, emitente: e } = g;
  const d = nota.destinatario;
  const chave = chaveDeAcesso({ uf: e.uf, emissao: g.emissao, cnpj: e.cnpj, serie: g.serie, numero: g.numero, codigoNumerico: g.codigoNumerico });
  const itensCalc = calcularItens(nota);
  const totais = calcularTotais(itensCalc, nota.valorTotalInformado);
  const referencias = [...new Set([nota.referencia, ...(nota.referencias ?? [])].map((r) => so(r)).filter((r) => /^\d{44}$/.test(r)))];
  const dest = idDestino(e.uf, d.uf, d.pais);
  const simples = e.crt === 1 || e.crt === 2 || e.crt === 4;

  const ide = [
    tag("cUF", codigoUf(e.uf)), tag("cNF", g.codigoNumerico.padStart(8, "0")), tag("natOp", tx(nota.natureza)), tag("mod", "55"),
    tag("serie", String(g.serie)), tag("nNF", String(g.numero)), tag("dhEmi", dataHoraBrasilia(g.emissao)),
    nota.saidaEntrada && !Number.isNaN(Date.parse(nota.saidaEntrada)) ? tag("dhSaiEnt", dataHoraBrasilia(new Date(nota.saidaEntrada))) : "",
    tag("tpNF", String(nota.tipo)), tag("idDest", String(dest)), tag("cMunFG", so(e.codigoMunicipio)), tag("tpImp", "1"), tag("tpEmis", "1"),
    tag("cDV", chave.slice(-1)), tag("tpAmb", String(g.tpAmb)), tag("finNFe", String(nota.finalidade)), tag("indFinal", nota.consumidorFinal ? "1" : "0"),
    tag("indPres", String(nota.presenca)), [2, 3, 4, 9].includes(nota.presenca) ? tag("indIntermed", "0") : "",
    tag("procEmi", "0"), tag("verProc", "BusinessOS 1.0"),
    // Devolução referencia por item (DFeReferenciado, abaixo): o refNFe junto é rejeitado (RV VC02-05).
    nota.finalidade !== 4 ? referencias.map((r) => `<NFref>${tag("refNFe", r)}</NFref>`).join("") : "",
  ].join("");

  const ender = (x: { logradouro: string; numero: string; complemento?: string | null; bairro: string; codigoMunicipio: string; municipio: string; uf: string; cep: string; fone?: string | null; pais?: string; nomePais?: string }) => {
    // Exterior: município 9999999, UF "EX", sem CEP, com o país do BACEN.
    const fora = exterior(x.pais);
    return [
      tag("xLgr", tx(x.logradouro)), tag("nro", tx(x.numero)), tag("xCpl", tx(x.complemento)), tag("xBairro", tx(x.bairro)),
      tag("cMun", fora ? "9999999" : so(x.codigoMunicipio)), tag("xMun", tx(x.municipio || (fora ? "EXTERIOR" : ""))), tag("UF", fora ? "EX" : x.uf.toUpperCase()),
      fora ? "" : tag("CEP", so(x.cep)),
      tag("cPais", fora ? so(x.pais) : "1058"), tag("xPais", fora ? tx(x.nomePais || "EXTERIOR") : "BRASIL"), so(x.fone).length >= 6 ? tag("fone", so(x.fone).slice(0, 14)) : "",
    ].join("");
  };

  const emit = [
    tag("CNPJ", so(e.cnpj)), tag("xNome", tx(e.razaoSocial)), tag("xFant", tx(e.fantasia)),
    `<enderEmit>${ender({ ...e, fone: e.telefone, pais: undefined })}</enderEmit>`, tag("IE", so(e.ie) || "ISENTO"),
    e.im ? tag("IM", tx(e.im, 15)) + tag("CNAE", so(e.cnae)) : "", tag("CRT", String(e.crt)),
  ].join("");

  const docDest = so(d.documento);
  const destXml = [
    exterior(d.pais) ? `<idEstrangeiro>${tx(d.documento, 20)}</idEstrangeiro>` : docDest.length === 11 ? tag("CPF", docDest) : tag("CNPJ", docDest),
    tag("xNome", tx(d.nome)), `<enderDest>${ender(d)}</enderDest>`,
    tag("indIEDest", String(d.indIE)), d.indIE === 1 ? tag("IE", so(d.ie)) : "", d.email && emailsValidos(d.email) ? tag("email", tx(d.email, 60)) : "",
  ].join("");

  const det = nota.itens.map((i, k) => {
    const c = itensCalc[k];
    const trib = i.tributavel && i.tributavel.unidade ? i.tributavel : null;
    const prod = [
      tag("cProd", tx(i.codigo || String(k + 1), 60)), tag("cEAN", "SEM GTIN"), tag("xProd", tx(i.descricao, 120)), tag("NCM", so(i.ncm)),
      i.cBenef && /^([!-ÿ]{8}|[!-ÿ]{10}|SEM CBENEF)$/.test(i.cBenef) ? tag("cBenef", i.cBenef) : "",
      tag("CFOP", so(i.cfop)), tag("uCom", tx(i.unidade || "UN", 6)), tag("qCom", d4(i.quantidade)), tag("vUnCom", d10(i.valorUnitario)), tag("vProd", d2(c.vProd)),
      tag("cEANTrib", "SEM GTIN"), tag("uTrib", tx(trib?.unidade || i.unidade || "UN", 6)), tag("qTrib", d4(trib?.quantidade ?? i.quantidade)), tag("vUnTrib", d10(trib?.valorUnitario ?? i.valorUnitario)),
      c.vFrete ? tag("vFrete", d2(c.vFrete)) : "", c.vSeg ? tag("vSeg", d2(c.vSeg)) : "", c.vDesc ? tag("vDesc", d2(c.vDesc)) : "", c.vOutro ? tag("vOutro", d2(c.vOutro)) : "",
      tag("indTot", "1"),
      (i.di ?? []).map(xmlDaDi).join(""),
      (i.exportacao ?? []).map((x) => `<detExport>${tag("nDraw", tx(x.drawback, 20))}${x.indireta ? `<exportInd>${tag("nRE", so(x.indireta.registro))}${tag("chNFe", so(x.indireta.chave))}${tag("qExport", d4(x.indireta.quantidade))}</exportInd>` : ""}</detExport>`).join(""),
      // Pedido de compra do cliente: xPed até 15 caracteres; nItemPed só número (até 6). O texto completo vai em infAdProd.
      i.pedidoCompra && i.pedidoCompra.length <= 15 ? tag("xPed", tx(i.pedidoCompra, 15)) : "",
      /^\d{1,6}$/.test(i.itemPedido ?? "") ? tag("nItemPed", i.itemPedido) : "",
    ].join("");
    const orig = tag("orig", String(i.origem ?? 0));
    let icms: string;
    if (simples) {
      icms = i.icmsCst === "101"
        ? `<ICMSSN101>${orig}${tag("CSOSN", "101")}${tag("pCredSN", d2(i.icmsAliquota))}${tag("vCredICMSSN", d2((c.vProd - c.vDesc) * i.icmsAliquota / 100))}</ICMSSN101>`
        : `<ICMSSN102>${orig}${tag("CSOSN", i.icmsCst)}</ICMSSN102>`;
    } else if (i.icmsCst === "00") {
      icms = `<ICMS00>${orig}${tag("CST", "00")}${tag("modBC", String(i.icmsModBC ?? 3))}${tag("vBC", d2(c.vBC))}${tag("pICMS", d4(i.icmsAliquota))}${tag("vICMS", d2(c.vICMS))}</ICMS00>`;
    } else if (i.icmsCst === "20") {
      icms = `<ICMS20>${orig}${tag("CST", "20")}${tag("modBC", String(i.icmsModBC ?? 3))}${tag("pRedBC", d4(i.icmsReducaoBase))}${tag("vBC", d2(c.vBC))}${tag("pICMS", d4(i.icmsAliquota))}${tag("vICMS", d2(c.vICMS))}</ICMS20>`;
    } else if (["40", "41", "50"].includes(i.icmsCst)) {
      icms = `<ICMS40>${orig}${tag("CST", i.icmsCst)}</ICMS40>`;
    } else if (i.icmsCst === "51") {
      icms = `<ICMS51>${orig}${tag("CST", "51")}</ICMS51>`;
    } else {
      // Com base ou com valor (o crédito do CIAP vai com base zero e o ICMS informado), o grupo leva os quatro campos.
      icms = `<ICMS90>${orig}${tag("CST", "90")}${icmsDestaca("90") && (c.vBC || c.vICMS) ? `${tag("modBC", String(i.icmsModBC ?? 3))}${tag("vBC", d2(c.vBC))}${tag("pICMS", d4(i.icmsAliquota))}${tag("vICMS", d2(c.vICMS))}` : ""}</ICMS90>`;
    }
    const cEnq = /^\d{3}$/.test(i.ipiEnquadramento ?? "") ? i.ipiEnquadramento! : "999";
    const ipi = ipiTributado(i.ipiCst)
      ? `<IPI>${tag("cEnq", cEnq)}<IPITrib>${tag("CST", i.ipiCst)}${tag("vBC", d2(c.vBCIPI))}${tag("pIPI", d4(i.ipiAliquota))}${tag("vIPI", d2(c.vIPI))}</IPITrib></IPI>`
      : `<IPI>${tag("cEnq", cEnq)}<IPINT>${tag("CST", i.ipiCst)}</IPINT></IPI>`;
    const ii = i.ii ? `<II>${tag("vBC", d2(i.ii.vBC))}${tag("vDespAdu", d2(i.ii.vDespAdu))}${tag("vII", d2(i.ii.vII))}${tag("vIOF", d2(i.ii.vIOF))}</II>` : "";
    const baseP = d2(c.vBCPisCofins);
    const baseC = d2(c.vBCCofins);
    const pis = pisCofinsComAliquota(i.pisCst)
      ? (["01", "02"].includes(i.pisCst)
        ? `<PISAliq>${tag("CST", i.pisCst)}${tag("vBC", baseP)}${tag("pPIS", d4(i.pisAliquota))}${tag("vPIS", d2(c.vPIS))}</PISAliq>`
        : `<PISOutr>${tag("CST", i.pisCst)}${tag("vBC", baseP)}${tag("pPIS", d4(i.pisAliquota))}${tag("vPIS", d2(c.vPIS))}</PISOutr>`)
      : `<PISNT>${tag("CST", i.pisCst)}</PISNT>`;
    const cofins = pisCofinsComAliquota(i.cofinsCst)
      ? (["01", "02"].includes(i.cofinsCst)
        ? `<COFINSAliq>${tag("CST", i.cofinsCst)}${tag("vBC", baseC)}${tag("pCOFINS", d4(i.cofinsAliquota))}${tag("vCOFINS", d2(c.vCOFINS))}</COFINSAliq>`
        : `<COFINSOutr>${tag("CST", i.cofinsCst)}${tag("vBC", baseC)}${tag("pCOFINS", d4(i.cofinsAliquota))}${tag("vCOFINS", d2(c.vCOFINS))}</COFINSOutr>`)
      : `<COFINSNT>${tag("CST", i.cofinsCst)}</COFINSNT>`;
    const infAdProd = i.infoAdicional?.trim()
      ? tag("infAdProd", tx(i.infoAdicional, 500))
      : i.pedidoCompra ? tag("infAdProd", tx(`Nº Pedido: ${i.pedidoCompra}${i.itemPedido ? ` Nº Pedido Item: ${i.itemPedido}` : ""}`, 500)) : "";
    // IBS/CBS (reforma, 2026): o mesmo grupo que o GRV já emite.
    const ibsCbs = i.ibsCbsCst
      ? `<IBSCBS>${tag("CST", i.ibsCbsCst)}${tag("cClassTrib", i.cClassTrib || "000001")}${ibsCbsTributa(i.ibsCbsCst)
        ? `<gIBSCBS>${tag("vBC", d2(c.vBCIBSCBS))}<gIBSUF>${tag("pIBSUF", d4(i.ibsAliquota ?? 0))}${tag("vIBSUF", d2(c.vIBS))}</gIBSUF><gIBSMun>${tag("pIBSMun", "0.0000")}${tag("vIBSMun", "0.00")}</gIBSMun>${tag("vIBS", d2(c.vIBS))}<gCBS>${tag("pCBS", d4(i.cbsAliquota ?? 0))}${tag("vCBS", d2(c.vCBS))}</gCBS></gIBSCBS>`
        : ""}</IBSCBS>`
      : "";
    const chaveDevolvida = i.dfeReferenciado?.chave ?? nota.referencia;
    const dfeRef = nota.finalidade === 4 && i.dfeReferenciado && chaveDevolvida && /^\d{44}$/.test(chaveDevolvida)
      ? `<DFeReferenciado>${tag("chaveAcesso", chaveDevolvida)}${tag("nItem", String(i.dfeReferenciado.nItem))}</DFeReferenciado>`
      : "";
    // vItem: participação do item no total, como o GRV leva (calculo.ts, valorTotalDoItem). Em item com valores informados
    // (importação pela DI) não há regra para ele (o GRV manda valores diferentes a cada nota) e o campo, opcional, não vai.
    const vItem = i.informado ? "" : tag("vItem", d2(valorTotalDoItem(c)));
    const devol = i.ipiDevolvido ? `<impostoDevol>${tag("pDevol", d2(i.ipiDevolvido.percentual))}<IPI>${tag("vIPIDevol", d2(c.vIPIDevol))}</IPI></impostoDevol>` : "";
    return `<det nItem="${k + 1}"><prod>${prod}</prod><imposto><ICMS>${icms}</ICMS>${ipi}${ii}<PIS>${pis}</PIS><COFINS>${cofins}</COFINS>${ibsCbs}</imposto>${devol}${infAdProd}${vItem}${dfeRef}</det>`;
  }).join("");

  const t = totais;
  const icmsTot = [
    tag("vBC", d2(t.vBC)), tag("vICMS", d2(t.vICMS)), tag("vICMSDeson", "0.00"), tag("vFCP", "0.00"), tag("vBCST", "0.00"), tag("vST", "0.00"),
    tag("vFCPST", "0.00"), tag("vFCPSTRet", "0.00"), tag("vProd", d2(t.vProd)), tag("vFrete", d2(t.vFrete)), tag("vSeg", d2(t.vSeg)), tag("vDesc", d2(t.vDesc)),
    tag("vII", d2(t.vII)), tag("vIPI", d2(t.vIPI)), tag("vIPIDevol", d2(t.vIPIDevol)), tag("vPIS", d2(t.vPIS)), tag("vCOFINS", d2(t.vCOFINS)), tag("vOutro", d2(t.vOutro)), tag("vNF", d2(t.vNF)),
  ].join("");

  // vNFTot não aceita zero no esquema (TDec_1302Opc): a nota de ajuste de valor zero vai sem ele.
  const comIbsCbs = nota.itens.some((i) => i.ibsCbsCst);
  const z = "0.00";
  const ibsCbsTot = comIbsCbs
    ? `<IBSCBSTot>${tag("vBCIBSCBS", d2(t.vBCIBSCBS))}<gIBS><gIBSUF>${tag("vDif", z)}${tag("vDevTrib", z)}${tag("vIBSUF", d2(t.vIBS))}</gIBSUF><gIBSMun>${tag("vDif", z)}${tag("vDevTrib", z)}${tag("vIBSMun", z)}</gIBSMun>${tag("vIBS", d2(t.vIBS))}${tag("vCredPres", z)}${tag("vCredPresCondSus", z)}</gIBS><gCBS>${tag("vDif", z)}${tag("vDevTrib", z)}${tag("vCBS", d2(t.vCBS))}${tag("vCredPres", z)}${tag("vCredPresCondSus", z)}</gCBS><gMono>${tag("vIBSMono", z)}${tag("vCBSMono", z)}${tag("vIBSMonoReten", z)}${tag("vCBSMonoReten", z)}${tag("vIBSMonoRet", z)}${tag("vCBSMonoRet", z)}</gMono></IBSCBSTot>${t.vNFTot > 0 ? tag("vNFTot", d2(t.vNFTot)) : ""}`
    : "";

  const f = nota.frete;
  const t3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3);
  const tr = f.transportadora;
  const v = f.volumes;
  const temVolume = v && (v.quantidade > 0 || v.especie?.trim() || v.marca?.trim() || v.numeracao?.trim() || v.pesoLiquido > 0 || v.pesoBruto > 0);
  const placa = f.veiculo?.placa?.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const transp = [
    tag("modFrete", String(f.modalidade)),
    tr?.nome ? `<transporta>${so(tr.documento).length === 11 ? tag("CPF", so(tr.documento)) : so(tr.documento) ? tag("CNPJ", so(tr.documento)) : ""}${tag("xNome", tx(tr.nome))}${so(tr.ie) ? tag("IE", so(tr.ie)) : ""}${tag("xEnder", tx(tr.endereco))}${tag("xMun", tx(tr.municipio))}${tr.uf ? tag("UF", tr.uf.toUpperCase()) : ""}</transporta>` : "",
    placa ? `<veicTransp>${tag("placa", placa)}${tag("UF", f.veiculo?.uf?.toUpperCase())}${tag("RNTC", tx(f.veiculo?.rntc, 20))}</veicTransp>` : "",
    temVolume ? `<vol>${v.quantidade > 0 ? tag("qVol", String(Math.round(v.quantidade))) : ""}${tag("esp", tx(v.especie))}${tag("marca", tx(v.marca))}${tag("nVol", tx(v.numeracao))}${v.pesoLiquido ? tag("pesoL", t3(v.pesoLiquido)) : ""}${v.pesoBruto ? tag("pesoB", t3(v.pesoBruto)) : ""}</vol>` : "",
  ].join("");

  const dups = nota.pagamento.duplicatas.filter((x) => x.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.vencimento));
  const cobr = dups.length
    ? `<cobr><fat>${tag("nFat", String(g.numero))}${tag("vOrig", d2(t.vNF))}${tag("vDesc", "0.00")}${tag("vLiq", d2(t.vNF))}</fat>${dups.map((x, k) => `<dup>${tag("nDup", String(k + 1).padStart(3, "0"))}${tag("dVenc", x.vencimento)}${tag("vDup", d2(x.valor))}</dup>`).join("")}</cobr>`
    : "";
  const aPrazo = dups.length > 1 || Boolean(dups[0] && dups[0].vencimento > dataHoraBrasilia(g.emissao).slice(0, 10));
  const partes = nota.pagamento.partes?.length ? nota.pagamento.partes : [{ forma: nota.pagamento.forma, valor: t.vNF }];
  const detPag = (forma: string, valor: number) => {
    const sem = forma === "90";
    return `<detPag>${sem ? "" : tag("indPag", aPrazo ? "1" : "0")}${tag("tPag", forma)}${forma === "99" ? tag("xPag", "Outros") : ""}${tag("vPag", sem ? "0.00" : d2(valor))}</detPag>`;
  };
  const pag = `<pag>${partes.map((p) => detPag(p.forma, p.valor)).join("")}</pag>`;
  const fisco = nota.infoFisco?.trim() ? tag("infAdFisco", tx(nota.infoFisco, 2000)) : "";
  const cpl = nota.infoComplementar.trim() ? tag("infCpl", tx(nota.infoComplementar, 5000)) : "";
  const infAdic = fisco || cpl ? `<infAdic>${fisco}${cpl}</infAdic>` : "";
  const ex = nota.exportacao;
  const exporta = ex?.ufSaida && ex.localExportacao ? `<exporta>${tag("UFSaidaPais", ex.ufSaida.toUpperCase())}${tag("xLocExporta", tx(ex.localExportacao))}${tag("xLocDespacho", tx(ex.localDespacho))}</exporta>` : "";

  const infNFe = `<infNFe versao="4.00" Id="NFe${chave}"><ide>${ide}</ide><emit>${emit}</emit><dest>${destXml}</dest>${det}<total><ICMSTot>${icmsTot}</ICMSTot>${ibsCbsTot}</total><transp>${transp}</transp>${cobr}${pag}${infAdic}${exporta}</infNFe>`;
  return { xml: `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe>`, chave, totais };
}

/** Declaração de importação (grupo DI), na ordem do esquema. */
function xmlDaDi(x: NonNullable<NotaNfe["itens"][number]["di"]>[number]): string {
  const doc = so(x.documentoAdquirente);
  return `<DI>${tag("nDI", tx(x.numero, 15))}${tag("dDI", x.data)}${tag("xLocDesemb", tx(x.localDesembaraco))}${tag("UFDesemb", x.ufDesembaraco.toUpperCase())}${tag("dDesemb", x.dataDesembaraco)}`
    + `${tag("tpViaTransp", String(x.viaTransporte))}${typeof x.vAFRMM === "number" ? tag("vAFRMM", d2(x.vAFRMM)) : ""}${tag("tpIntermedio", String(x.intermedio))}`
    + `${doc.length === 14 ? tag("CNPJ", doc) : doc.length === 11 ? tag("CPF", doc) : ""}${tag("UFTerceiro", x.ufTerceiro?.toUpperCase())}${tag("cExportador", tx(x.exportador))}`
    + x.adicoes.map((a) => `<adi>${tag("nAdicao", String(a.numero))}${tag("nSeqAdic", String(a.sequencial))}${tag("cFabricante", tx(a.fabricante))}${a.desconto ? tag("vDescDI", d2(a.desconto)) : ""}${tag("nDraw", tx(a.drawback, 20))}</adi>`).join("")
    + "</DI>";
}

/** Assinatura de estrutura válida e conteúdo fictício — SÓ para o treino (o esquema exige a tag). */
export function assinaturaDeTreino(chave: string): string {
  const b64 = Buffer.from(`TREINO-SEM-VALOR-FISCAL-${chave}`).toString("base64");
  return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#NFe${chave}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${b64.slice(0, 28)}</DigestValue></Reference></SignedInfo><SignatureValue>${b64}</SignatureValue><KeyInfo><X509Data><X509Certificate>${b64}</X509Certificate></X509Data></KeyInfo></Signature>`;
}

/** NF-e "autorizada" do treino: a nota com a assinatura fictícia e um protocolo fictício. */
export function nfeProcDeTreino(xmlNfe: string, chave: string, protocolo: string, quando: Date): string {
  const assinada = xmlNfe.replace("</infNFe></NFe>", `</infNFe>${assinaturaDeTreino(chave)}</NFe>`);
  const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>TREINO-BUSINESSOS</verAplic><chNFe>${chave}</chNFe><dhRecbto>${dataHoraBrasilia(quando)}</dhRecbto><nProt>${protocolo}</nProt><digVal>${Buffer.from(chave).toString("base64").slice(0, 28)}</digVal><cStat>100</cStat><xMotivo>SIMULACAO - TREINO - SEM VALOR FISCAL</xMotivo></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${assinada}${prot}</nfeProc>`;
}
