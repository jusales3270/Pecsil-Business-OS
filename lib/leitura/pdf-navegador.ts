/**
 * Texto de PDF no NAVEGADOR (coleta: lê no próprio computador, antes de conferir). O worker do
 * pdfjs é servido pela própria plataforma (`public/pdfjs/`, mesma versão do pacote — um teste
 * confere), sem CDN: o arquivo não sai do computador.
 */
import { LIMITE_PAGINAS_TEXTO } from "./texto";

export const WORKER_PDF = "/pdfjs/pdf.worker-4.10.38.min.mjs";

export async function paginasPdfNavegador(dados: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_PDF;
  const doc = await pdfjs.getDocument({ data: dados.slice(), isEvalSupported: false }).promise;
  try {
    const paginas: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, LIMITE_PAGINAS_TEXTO); n++) {
      const conteudo = await (await doc.getPage(n)).getTextContent();
      paginas.push(conteudo.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join(""));
    }
    return paginas;
  } finally {
    await doc.destroy();
  }
}
