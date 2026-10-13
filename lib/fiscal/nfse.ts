/**
 * Leitura da NFS-e (nota fiscal de SERVIÇO) — XML ou PDF. Pedido do proprietário (13/10/2026):
 * o Painel do ICMS e o recebimento do Almoxarifado aceitam nota de serviço, além da NF-e.
 *
 * Não há um formato único. O XML é reconhecido em três famílias:
 *   - NFS-e Nacional (Emissor Nacional/ADN): <infNFSe Id="NFS…"> com chave de 50 dígitos;
 *   - ABRASF 1.x/2.x (a maioria das prefeituras): <CompNfse>/<InfNfse>;
 *   - Prefeitura de São Paulo (NFS-e paulistana): <NFe> com <ChaveNFe>/<NumeroNFe>.
 * O PDF (DANFSe nacional ou o da prefeitura) é lido pelos rótulos; o que não for achado volta
 * em `camposNaoLidos` para a pessoa completar. Nota de serviço não tem ICMS/IPI: ICMS = 0 e o
 * ISS (com a retenção) vai junto, para a observação.
 */
import type { ItemPdf } from "../arquivos/pdf-texto";
import type { Nfe } from "../almoxarifado/nfe-xml";

export class NfseInvalida extends Error {}

export type Nfse = {
  /** Chave da NFS-e Nacional (50 dígitos); vazia nas municipais. */
  chave: string;
  numero: string;
  codigoVerificacao: string;
  emissao: string; // AAAA-MM-DD
  prestador: { cnpj: string; nome: string; fantasia: string; uf: string };
  tomadorCnpj: string;
  valorServicos: number;
  valorLiquido: number;
  iss: number;
  issRetido: boolean;
  discriminacao: string;
  codigoServico: string;
};

// --- XML ------------------------------------------------------------------------------------------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const dec = (t: string) => t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, n: string) =>
  n[0] === "#" ? String.fromCodePoint(n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10)) : ENT[n.toLowerCase()] ?? m).trim();
// Tags com maiúsculas exatas: em XML elas importam (infNFSe nacional × InfNfse ABRASF).
const bloco = (xml: string, tag: string) => xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`))?.[1] ?? "";
/** Primeiro campo encontrado, na ordem das tags. */
const campo = (xml: string, ...tags: string[]) => { for (const t of tags) { const v = dec(bloco(xml, t)); if (v) return v; } return ""; };
/** Primeiro bloco não vazio, na ordem das tags. */
const blocoDe = (xml: string, ...tags: string[]) => { for (const t of tags) { const b = bloco(xml, t); if (b) return b; } return ""; };
const dinheiro = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const data = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : /^(\d{2})\/(\d{2})\/(\d{4})/.test(v) ? v.replace(/^(\d{2})\/(\d{2})\/(\d{4}).*$/, "$3-$2-$1") : "");
const docDe = (xml: string) => campo(xml, "CNPJ", "Cnpj", "CPF", "Cpf").replace(/\D/g, "");
const tem = (xml: string, tag: string) => new RegExp(`<(?:\\w+:)?${tag}[\\s>]`).test(xml);

export function pareceNfseXml(xml: string): boolean {
  return tem(xml, "infNFSe") || tem(xml, "InfNfse") || tem(xml, "CompNfse") || (tem(xml, "ChaveNFe") && tem(xml, "NumeroNFe") && !tem(xml, "infNFe"));
}

export function lerNfseXml(xml: string): Nfse {
  if (!xml || !pareceNfseXml(xml)) throw new NfseInvalida("O arquivo não é o XML de uma nota de serviço (NFS-e).");

  // NFS-e Nacional
  if (tem(xml, "infNFSe")) {
    const inf = bloco(xml, "infNFSe");
    const chave = xml.match(/<(?:\w+:)?infNFSe[^>]*\sId="NFS(\d{50})"/)?.[1] ?? "";
    const emit = bloco(inf, "emit");
    const dps = blocoDe(inf, "infDPS", "DPS");
    const valores = bloco(inf, "valores");
    const vServ = dinheiro(campo(bloco(dps, "vServPrest") || dps, "vServ"));
    const tpRet = campo(dps, "tpRetISSQN");
    return {
      chave, numero: campo(inf, "nNFSe"), codigoVerificacao: "",
      emissao: data(campo(dps, "dhEmi") || campo(inf, "dhProc")),
      prestador: { cnpj: docDe(emit) || docDe(bloco(dps, "prest")), nome: campo(emit, "xNome"), fantasia: campo(emit, "xFant"), uf: campo(emit, "UF") },
      tomadorCnpj: docDe(bloco(dps, "toma")),
      valorServicos: vServ, valorLiquido: dinheiro(campo(valores, "vLiq")) || vServ,
      iss: dinheiro(campo(valores, "vISSQN")), issRetido: tpRet === "2" || tpRet === "3",
      discriminacao: campo(dps, "xDescServ"), codigoServico: campo(dps, "cTribNac", "cTribMun"),
    };
  }

  // ABRASF (1.x e 2.x)
  if (tem(xml, "InfNfse") || tem(xml, "CompNfse")) {
    const inf = blocoDe(xml, "InfNfse") || xml;
    const decl = blocoDe(xml, "InfDeclaracaoPrestacaoServico", "DeclaracaoPrestacaoServico");
    const serv = blocoDe(decl, "Servico") || blocoDe(inf, "Servico");
    const valServ = blocoDe(serv, "Valores");
    const valNfse = blocoDe(inf, "ValoresNfse");
    const prest = blocoDe(inf, "PrestadorServico") || blocoDe(decl, "Prestador") || blocoDe(inf, "Prestador");
    const toma = blocoDe(decl, "Tomador", "TomadorServico") || blocoDe(inf, "TomadorServico", "Tomador");
    const vServ = dinheiro(campo(valServ, "ValorServicos"));
    const retido = campo(serv, "IssRetido") || campo(valServ, "IssRetido");
    return {
      chave: "", numero: campo(inf, "Numero"), codigoVerificacao: campo(inf, "CodigoVerificacao"),
      emissao: data(campo(inf, "DataEmissao") || campo(decl, "DataEmissao", "Competencia")),
      prestador: { cnpj: docDe(prest), nome: campo(prest, "RazaoSocial", "NomeFantasia"), fantasia: campo(prest, "NomeFantasia"), uf: campo(prest, "Uf", "UF") },
      tomadorCnpj: docDe(toma),
      valorServicos: vServ, valorLiquido: dinheiro(campo(valNfse, "ValorLiquidoNfse") || campo(valServ, "ValorLiquidoNfse")) || vServ,
      iss: dinheiro(campo(valNfse, "ValorIss") || campo(valServ, "ValorIss")), issRetido: retido === "1" || /^true$/i.test(retido),
      discriminacao: campo(serv, "Discriminacao"), codigoServico: campo(serv, "ItemListaServico", "CodigoTributacaoMunicipio"),
    };
  }

  // Prefeitura de São Paulo
  const nfe = blocoDe(xml, "NFe") || xml;
  const vServ = dinheiro(campo(nfe, "ValorServicos"));
  return {
    chave: "", numero: campo(bloco(nfe, "ChaveNFe"), "NumeroNFe"), codigoVerificacao: campo(bloco(nfe, "ChaveNFe"), "CodigoVerificacao"),
    emissao: data(campo(nfe, "DataEmissaoNFe", "DataFatoGeradorNFe")),
    prestador: { cnpj: docDe(bloco(nfe, "CPFCNPJPrestador")), nome: campo(nfe, "RazaoSocialPrestador"), fantasia: "", uf: campo(bloco(nfe, "EnderecoPrestador"), "UF") },
    tomadorCnpj: docDe(bloco(nfe, "CPFCNPJTomador")),
    valorServicos: vServ, valorLiquido: vServ, iss: dinheiro(campo(nfe, "ValorISS")), issRetido: /^true$/i.test(campo(nfe, "ISSRetido")),
    discriminacao: campo(nfe, "Discriminacao"), codigoServico: campo(nfe, "CodigoServico"),
  };
}

// --- PDF ------------------------------------------------------------------------------------------
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const VALOR = /\d{1,3}(?:\.\d{3})*,\d{2}/;
const CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/;
const valorBr = (t: string) => Number(t.replace(/\./g, "").replace(",", "."));

function linhasDoPdf(itens: ItemPdf[]): ItemPdf[][] {
  const out: ItemPdf[][] = [];
  for (const it of [...itens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const atual = out.at(-1);
    if (atual && Math.abs(atual[0].y - it.y) <= 2) atual.push(it); else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

export function pareceNfsePdf(paginas: ItemPdf[][]): boolean {
  const t = norm((paginas[0] ?? []).map((i) => i.s).join(" "));
  if (t.includes("DANFE") && !t.includes("DANFSE")) return false; // DANFE de NF-e é outro leitor
  return /DANFSE|NFS-?E|NOTA FISCAL (ELETRONICA )?DE SERVICOS?|NOTA FISCAL DE SERVICOS? ELETRONICA/.test(t);
}

/**
 * Valor de um rótulo: na mesma linha, depois do rótulo ("Número da Nota: 123"), ou logo abaixo,
 * na mesma coluna (layout em caixas, como o DANFSe nacional).
 */
function valorDoRotulo(linhas: ItemPdf[][], rotulo: RegExp, padrao: RegExp, aPartirDe = 0): string | null {
  for (let i = aPartirDe; i < linhas.length; i++) {
    const linha = linhas[i];
    const k = linha.findIndex((it) => rotulo.test(norm(it.s)));
    if (k < 0) continue;
    // No próprio texto do rótulo ("Número da Nota: 123", "VALOR TOTAL = R$ 1.250,00") ou nos vizinhos da linha.
    const resto = linha[k].s.replace(/^[^:=]*[:=]\s*/, "");
    const mesmo = (resto !== linha[k].s ? resto : "") + " " + linha.slice(k + 1, k + 3).map((x) => x.s).join(" ");
    const m1 = mesmo.match(padrao);
    if (m1) return m1[0];
    const x0 = linha[k].x - 15, x1 = linha[k].x + Math.max(linha[k].w, 60) + 120;
    for (const abaixo of linhas.slice(i + 1, i + 4)) {
      for (const it of abaixo) if (it.x >= x0 && it.x <= x1) { const m = it.s.match(padrao); if (m) return m[0]; }
    }
  }
  return null;
}

const indiceDe = (linhas: ItemPdf[][], titulo: RegExp) => linhas.findIndex((l) => titulo.test(norm(l.map((i) => i.s).join(" "))));

export function lerNfsePdf(paginas: ItemPdf[][]): Nfse & { camposNaoLidos: string[] } {
  if (!pareceNfsePdf(paginas)) throw new NfseInvalida("Este PDF não parece uma nota fiscal de serviço (NFS-e).");
  const linhas = linhasDoPdf(paginas[0] ?? []);
  const texto = linhas.map((l) => l.map((i) => i.s).join(" ")).join("\n");
  const naoLidos: string[] = [];

  const chave = texto.replace(/[ .]/g, "").match(/(?<!\d)\d{50}(?!\d)/)?.[0] ?? "";
  const numero = valorDoRotulo(linhas, /^(NUMERO|N[O°º]\.?) DA (NFS-?E|NOTA)|^NUMERO DA NFS|^NUMERO DA NOTA|^N[O°º] DA NOTA|^NUMERO$/, /\d{1,15}/) ?? "";
  const emissaoTxt = valorDoRotulo(linhas, /DATA (E HORA )?(DA |DE )?EMISSAO|^EMISSAO|^EMITIDA EM/, /\d{2}\/\d{2}\/\d{4}/) ?? texto.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? "";
  const iPrest = Math.max(indiceDe(linhas, /EMITENTE DA NFS-?E|PRESTADOR DE? SERVICOS?|PRESTADOR DO SERVICO|DADOS DO PRESTADOR/), 0);
  const cnpjTxt = valorDoRotulo(linhas, /CNPJ|CPF/, CNPJ, iPrest) ?? texto.match(CNPJ)?.[0] ?? "";
  const nome = valorDoRotulo(linhas, /^NOME ?\/ ?NOME EMPRESARIAL|^RAZAO SOCIAL|^NOME\/RAZAO SOCIAL|^NOME EMPRESARIAL/, /[A-Za-zÀ-ú0-9&.,\- ]{3,}/, iPrest)?.trim() ?? "";
  const iToma = indiceDe(linhas, /TOMADOR/);
  const tomador = iToma >= 0 ? (valorDoRotulo(linhas, /CNPJ|CPF/, CNPJ, iToma) ?? "") : "";
  const vServTxt = valorDoRotulo(linhas, /^VALOR (TOTAL )?(DO|DOS) SERVICOS?|^VALOR TOTAL DA (NFS-?E|NOTA)|^VALOR DA NOTA|^VALOR TOTAL DO SERVICO/, VALOR);
  const liqTxt = valorDoRotulo(linhas, /^VALOR LIQUIDO/, VALOR);
  const issTxt = valorDoRotulo(linhas, /^(VALOR DO )?ISSQN( APURADO)?$|^VALOR DO ISS(QN)?|^ISS ?\(R\$\)|^VALOR ISS/, VALOR);
  const retTxt = norm(texto).match(/(RETENCAO DO ISSQN|ISS RETIDO)[^\n]*?(NAO RETIDO|RETIDO PELO TOMADOR|RETIDO PELO INTERMEDIARIO|SIM|NAO)/)?.[2] ?? "";

  const valorServicos = vServTxt ? valorBr(vServTxt) : 0;
  if (!numero) naoLidos.push("número");
  if (!emissaoTxt) naoLidos.push("emissão");
  if (!cnpjTxt) naoLidos.push("CNPJ do prestador");
  if (!nome) naoLidos.push("prestador");
  if (!vServTxt) naoLidos.push("valor");
  return {
    chave, numero, codigoVerificacao: "",
    emissao: data(emissaoTxt),
    prestador: { cnpj: cnpjTxt.replace(/\D/g, ""), nome, fantasia: "", uf: "" },
    tomadorCnpj: tomador.replace(/\D/g, ""),
    valorServicos, valorLiquido: liqTxt ? valorBr(liqTxt) : valorServicos,
    iss: issTxt ? valorBr(issTxt) : 0, issRetido: /RETIDO PELO|^SIM$/.test(retTxt),
    discriminacao: "", codigoServico: "",
    camposNaoLidos: naoLidos,
  };
}

// --- Para o resto da plataforma ------------------------------------------------------------------
/** A NFS-e no formato que o Painel do ICMS e o recebimento já usam (ICMS e IPI zerados). */
export function nfseComoNota(s: Nfse): Nfe {
  return {
    chave: s.chave, numero: s.numero, serie: "", emissao: s.emissao, natureza: "Prestação de serviço",
    emitente: { cnpj: s.prestador.cnpj, nome: s.prestador.nome, fantasia: s.prestador.fantasia, uf: s.prestador.uf },
    destinatarioCnpj: s.tomadorCnpj, valorProdutos: s.valorServicos, valorNota: s.valorServicos, baseIcms: 0, icms: 0, ipi: 0,
    itens: s.discriminacao || s.valorServicos ? [{ numero: 1, codigo: s.codigoServico, descricao: (s.discriminacao || "Serviço").slice(0, 300), cfop: "", unidade: "SV", quantidade: 1, valorUnitario: s.valorServicos, valorTotal: s.valorServicos }] : [],
    duplicatas: [],
  };
}

/** Observação padrão da nota de serviço no painel (o ISS e a retenção ficam registrados). */
export function obsDoServico(s: Pick<Nfse, "iss" | "issRetido" | "codigoVerificacao">, doPdf: boolean): string {
  const iss = s.iss ? `ISS R$ ${s.iss.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}${s.issRetido ? " (retido)" : ""}` : "";
  const cod = s.codigoVerificacao ? `código de verificação ${s.codigoVerificacao}` : "";
  return ["Nota de serviço (NFS-e)", iss, cod, doPdf ? "lida do PDF: conferir com a nota" : ""].filter(Boolean).join(" · ");
}
