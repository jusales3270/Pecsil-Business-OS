/**
 * Leitor do XML da NF-e (modelo 55, leiaute 4.00 e o antigo 2.00/3.10).
 *
 * Tira da nota o que o recebimento e o Painel do ICMS precisam: chave, número,
 * série, emissão, emitente, totais (produtos, nota, base e valor do ICMS, IPI),
 * itens e duplicatas (vencimentos). É texto puro — nenhuma biblioteca nem
 * serviço externo; o XML nunca sai do servidor da PecSil.
 */

export type NfeItem = {
  numero: number;
  codigo: string;
  descricao: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

export type NfeDuplicata = { numero: string; vencimento: string; valor: number };

export type Nfe = {
  chave: string;
  numero: string;
  serie: string;
  emissao: string;
  natureza: string;
  emitente: { cnpj: string; nome: string; fantasia: string; uf: string };
  destinatarioCnpj: string;
  valorProdutos: number;
  valorNota: number;
  baseIcms: number;
  icms: number;
  ipi: number;
  itens: NfeItem[];
  duplicatas: NfeDuplicata[];
};

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodificar = (texto: string) =>
  texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, nome: string) => {
      if (nome[0] === "#") return String.fromCodePoint(nome[1].toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10));
      return ENTIDADES[nome.toLowerCase()] ?? inteiro;
    })
    .trim();

/** Conteúdo de cada ocorrência de <tag>…</tag> (aceita prefixo de namespace: <nfe:tag>). */
function blocos(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1]);
}
const bloco = (xml: string, tag: string) => blocos(xml, tag)[0] ?? "";
const texto = (xml: string, tag: string) => decodificar(bloco(xml, tag));
const numero = (xml: string, tag: string) => {
  const valor = Number(texto(xml, tag));
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
};
const quantidade = (xml: string, tag: string) => {
  const valor = Number(texto(xml, tag));
  return Number.isFinite(valor) ? valor : 0;
};
const data = (valor: string) => (/^\d{4}-\d{2}-\d{2}/.test(valor) ? valor.slice(0, 10) : "");

export class NfeInvalida extends Error {}

export function lerNfe(xml: string): Nfe {
  if (!xml || !/<(?:\w+:)?infNFe[\s>]/.test(xml)) {
    throw new NfeInvalida("O arquivo não é o XML de uma NF-e (falta o grupo infNFe).");
  }
  const inf = bloco(xml, "infNFe") || xml;
  const idAttr = xml.match(/<(?:\w+:)?infNFe[^>]*\sId="NFe(\d{44})"/)?.[1];
  const chave = idAttr ?? texto(bloco(xml, "infProt"), "chNFe");
  if (!/^\d{44}$/.test(chave)) throw new NfeInvalida("Não encontrei a chave de acesso (44 dígitos) na nota.");

  const ide = bloco(inf, "ide");
  const emit = bloco(inf, "emit");
  const dest = bloco(inf, "dest");
  const total = bloco(bloco(inf, "total"), "ICMSTot");

  const itens = blocos(inf, "det").map((det, index) => {
    const prod = bloco(det, "prod");
    return {
      numero: index + 1,
      codigo: texto(prod, "cProd"),
      descricao: texto(prod, "xProd"),
      cfop: texto(prod, "CFOP"),
      unidade: texto(prod, "uCom").toUpperCase(),
      quantidade: quantidade(prod, "qCom"),
      valorUnitario: quantidade(prod, "vUnCom"),
      valorTotal: numero(prod, "vProd"),
    };
  });
  // O atributo nItem fica na própria tag <det>, fora do conteúdo: busca de novo com ele.
  const comNumero = [...inf.matchAll(/<(?:\w+:)?det\s+nItem="(\d+)"/g)].map((m) => Number(m[1]));
  itens.forEach((item, index) => { if (comNumero[index]) item.numero = comNumero[index]; });

  const duplicatas = blocos(bloco(inf, "cobr"), "dup").map((dup) => ({
    numero: texto(dup, "nDup"),
    vencimento: data(texto(dup, "dVenc")),
    valor: numero(dup, "vDup"),
  })).filter((dup) => dup.vencimento && dup.valor > 0);

  return {
    chave,
    numero: texto(ide, "nNF"),
    serie: texto(ide, "serie"),
    emissao: data(texto(ide, "dhEmi") || texto(ide, "dEmi")),
    natureza: texto(ide, "natOp"),
    emitente: {
      cnpj: texto(emit, "CNPJ") || texto(emit, "CPF"),
      nome: texto(emit, "xNome"),
      fantasia: texto(emit, "xFant"),
      uf: texto(bloco(emit, "enderEmit"), "UF"),
    },
    destinatarioCnpj: texto(dest, "CNPJ") || texto(dest, "CPF"),
    valorProdutos: numero(total, "vProd"),
    valorNota: numero(total, "vNF"),
    baseIcms: numero(total, "vBC"),
    icms: numero(total, "vICMS"),
    ipi: numero(total, "vIPI"),
    itens,
    duplicatas,
  };
}
