/**
 * Que arquivo é este? Decide pelo conteúdo (os primeiros bytes e marcas do
 * formato), nunca só pela extensão — um .pdf renomeado para .ofx não engana.
 */
export type TipoArquivo = "pdf" | "xlsx" | "xls" | "docx" | "ofx" | "nfe-xml" | "xml" | "imagem" | "desconhecido";

export function tipoDoArquivo(dados: Uint8Array): TipoArquivo {
  const inicio = new TextDecoder("latin1").decode(dados.subarray(0, Math.min(dados.length, 4096)));
  if (inicio.startsWith("%PDF")) return "pdf";
  // Excel 97–2003 (.xls): arquivo composto, assinatura D0 CF 11 E0 A1 B1 1A E1.
  if (dados[0] === 0xd0 && dados[1] === 0xcf && dados[2] === 0x11 && dados[3] === 0xe0) return "xls";
  if (dados[0] === 0x50 && dados[1] === 0x4b && dados[2] === 0x03 && dados[3] === 0x04) {
    // zip: é planilha se tiver a pasta xl/, e Word se tiver word/ (os nomes aparecem no diretório do zip)
    const tudo = new TextDecoder("latin1").decode(dados);
    return tudo.includes("xl/workbook.xml") ? "xlsx" : tudo.includes("word/document.xml") ? "docx" : "desconhecido";
  }
  // Foto ou digitalização: JPEG (FF D8 FF) ou PNG (89 50 4E 47).
  if ((dados[0] === 0xff && dados[1] === 0xd8 && dados[2] === 0xff) || (dados[0] === 0x89 && dados[1] === 0x50 && dados[2] === 0x4e && dados[3] === 0x47)) return "imagem";
  if (/OFXHEADER|<OFX>/i.test(inicio)) return "ofx";
  if (/<(\w+:)?(nfeProc|NFe)[\s>]/.test(inicio)) return "nfe-xml";
  if (/^\s*(﻿)?<\?xml|^\s*</.test(inicio)) return "xml";
  return "desconhecido";
}
