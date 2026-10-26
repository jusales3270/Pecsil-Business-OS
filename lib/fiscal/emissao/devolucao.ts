/**
 * Devolução a partir da nota original: lê o XML da NF-e devolvida e devolve os itens no formato do editor da
 * emissão, cada um com o número do item na nota original (DFeReferenciado/nItem, exigido desde 03/11/2026). Puro.
 * Impostos e CFOP não vêm da nota original: saem da máscara de impostos da devolução, que quem emite escolhe.
 */
import { bloco, tag, textoXml } from "../ibs-cbs/leitura";

export type ItemDevolvivel = { nItem: number; codigo: string; descricao: string; ncm: string; unidade: string; quantidade: number; valorUnitario: number; desconto: number; origem: number };
export type NotaDevolvivel = { chave: string; numero: string | null; emissao: string | null; emitente: { documento: string | null; nome: string | null }; tipo: number | null; itens: ItemDevolvivel[] };

const num = (v: string | null) => (v ? Number(v) || 0 : 0);

export function lerNotaDevolvivel(xml: string): NotaDevolvivel | null {
  const inf = bloco(xml, "infNFe");
  const chave = xml.match(/<infNFe[^>]*Id="NFe(\d{44})"/)?.[1];
  if (!inf || !chave) return null;
  const ide = bloco(inf, "ide") ?? "";
  const emit = bloco(inf, "emit") ?? "";
  const itens: ItemDevolvivel[] = [];
  for (const m of inf.matchAll(/<det nItem="(\d+)">([\s\S]*?)<\/det>/g)) {
    const prod = bloco(m[2], "prod") ?? "";
    const icms = bloco(m[2], "ICMS") ?? "";
    itens.push({
      nItem: Number(m[1]), codigo: textoXml(tag(prod, "cProd")) ?? "", descricao: (textoXml(tag(prod, "xProd")) ?? "").slice(0, 120),
      ncm: tag(prod, "NCM") ?? "", unidade: (tag(prod, "uCom") ?? "UN").slice(0, 6).toUpperCase(),
      quantidade: num(tag(prod, "qCom")), valorUnitario: num(tag(prod, "vUnCom")), desconto: num(tag(prod, "vDesc")), origem: num(tag(icms, "orig")),
    });
  }
  return {
    chave, numero: tag(ide, "nNF"), emissao: tag(ide, "dhEmi") ?? tag(ide, "dEmi"),
    emitente: { documento: tag(emit, "CNPJ") ?? tag(emit, "CPF"), nome: textoXml(tag(emit, "xNome")) },
    tipo: tag(ide, "tpNF") === null ? null : Number(tag(ide, "tpNF")), itens,
  };
}
