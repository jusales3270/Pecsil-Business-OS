/**
 * Texto posicionado de um PDF (cada pedaço com x, y e largura), com o pdfjs.
 * É a entrada dos leitores de relatório e de extrato em PDF. Roda só no servidor;
 * o arquivo não sai da máquina.
 */
export type ItemPdf = { x: number; y: number; w: number; s: string };

export class PdfInvalido extends Error {}

export async function textoDoPdf(dados: Uint8Array, limitePaginas = 2000): Promise<ItemPdf[][]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await getDocument({ data: dados, verbosity: 0, isEvalSupported: false, useSystemFonts: false }).promise;
  } catch {
    throw new PdfInvalido("Não consegui abrir o PDF.");
  }
  if (doc.numPages > limitePaginas) throw new PdfInvalido(`O PDF tem ${doc.numPages} páginas; o limite é ${limitePaginas}.`);
  const paginas: ItemPdf[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const conteudo = await (await doc.getPage(n)).getTextContent();
    paginas.push(
      conteudo.items
        .filter((i): i is typeof i & { str: string; transform: number[]; width: number } => "str" in i && !!i.str.trim())
        .map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str })),
    );
  }
  await doc.destroy();
  return paginas;
}

/** Junta os pedaços em linhas (mesmo y, com tolerância), da esquerda para a direita. */
export function linhasDoPdf(pagina: ItemPdf[], tolerancia = 2): ItemPdf[][] {
  const ordenados = [...pagina].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: ItemPdf[][] = [];
  for (const it of ordenados) {
    const atual = linhas.at(-1);
    if (atual && Math.abs(atual[0].y - it.y) <= tolerancia) atual.push(it);
    else linhas.push([it]);
  }
  return linhas.map((l) => l.sort((a, b) => a.x - b.x));
}
