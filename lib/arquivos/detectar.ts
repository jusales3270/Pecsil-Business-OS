/**
 * Que arquivo é este? Decide pelo conteúdo (os primeiros bytes e marcas do
 * formato), nunca só pela extensão — um .pdf renomeado para .ofx não engana.
 */
export type TipoArquivo = "pdf" | "xlsx" | "xls" | "ofx" | "nfe-xml" | "xml" | "desconhecido";

export function tipoDoArquivo(dados: Uint8Array): TipoArquivo {
  const inicio = new TextDecoder("latin1").decode(dados.subarray(0, Math.min(dados.length, 4096)));
  if (inicio.startsWith("%PDF")) return "pdf";
  // Excel 97–2003 (.xls): arquivo composto, assinatura D0 CF 11 E0 A1 B1 1A E1.
  if (dados[0] === 0xd0 && dados[1] === 0xcf && dados[2] === 0x11 && dados[3] === 0xe0) return "xls";
  if (dados[0] === 0x50 && dados[1] === 0x4b && dados[2] === 0x03 && dados[3] === 0x04) {
    // zip: é planilha se tiver a pasta xl/ (o nome aparece no diretório do zip)
    const tudo = new TextDecoder("latin1").decode(dados);
    return tudo.includes("xl/workbook.xml") ? "xlsx" : "desconhecido";
  }
  if (/OFXHEADER|<OFX>/i.test(inicio)) return "ofx";
  if (/<(\w+:)?(nfeProc|NFe)[\s>]/.test(inicio)) return "nfe-xml";
  if (/^\s*(﻿)?<\?xml|^\s*</.test(inicio)) return "xml";
  return "desconhecido";
}
