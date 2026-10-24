/**
 * OCR local (decisão D4 do proprietário, 10/10/2026): o texto de PDF escaneado e de foto é lido
 * NO SERVIDOR da Pecsil, com o tesseract.js (WebAssembly) e o português empacotado pelo npm
 * (@tesseract.js-data/por). Nenhum arquivo sai da empresa e nada é baixado durante o uso.
 *
 * PDF escaneado: o pdfjs entrega as imagens de cada página (já decodificadas); viram PNG e vão
 * ao OCR. Foto (jpg/png): vai direto.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pngDe } from "./png";

export const LIMITE_PAGINAS_OCR = 20;
/** Prazo por imagem: passou disso, a página fica sem texto e o trabalhador é encerrado. */
export const PRAZO_OCR_MS = 60_000;

/**
 * Pasta do português. Pelo diretório do projeto, e não por require.resolve: dentro do Next o
 * empacotador troca o caminho por um endereço virtual ("[project]/…") que não existe no disco.
 */
function pastaDoPortugues(): string {
  const pasta = join(process.cwd(), "node_modules", "@tesseract.js-data", "por", "4.0.0");
  if (!existsSync(join(pasta, "por.traineddata.gz"))) throw new Error("Dados do português para o OCR não encontrados (@tesseract.js-data/por).");
  return pasta;
}

function comPrazo<T>(p: Promise<T>, ms: number, motivo: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, falha) => { t = setTimeout(() => falha(new Error(motivo)), ms); })]).finally(() => clearTimeout(t));
}

type Trabalhador = { recognize: (img: Buffer) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };

async function trabalhador(): Promise<Trabalhador> {
  const { createWorker } = await import("tesseract.js");
  const langPath = pastaDoPortugues();
  // errorHandler: sem ele, um erro do trabalhador vira exceção solta no processo e a chamada nunca termina.
  return (await comPrazo(createWorker("por", 1, { langPath, gzip: true, cacheMethod: "none", errorHandler: (e: unknown) => console.error("Erro no trabalhador do OCR", e) }), PRAZO_OCR_MS, "O OCR não iniciou a tempo.")) as unknown as Trabalhador;
}

/** Imagens das páginas de um PDF (as maiores de cada página), como PNG. */
export async function imagensDoPdf(dados: Uint8Array, limitePaginas = LIMITE_PAGINAS_OCR): Promise<Buffer[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: dados.slice(), verbosity: 0, isEvalSupported: false, useSystemFonts: false, isOffscreenCanvasSupported: false }).promise;
  const imagens: Buffer[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, limitePaginas); n++) {
      const pagina = await doc.getPage(n);
      const ops = await pagina.getOperatorList();
      let maior: { w: number; h: number; png: Buffer } | null = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        const id = ops.argsArray[i][0] as string;
        const img = await new Promise<{ width: number; height: number; kind: number; data?: Uint8ClampedArray } | null>((ok) => {
          try { (id.startsWith("g_") ? pagina.commonObjs : pagina.objs).get(id, ok); } catch { ok(null); }
        });
        if (!img?.data || img.width * img.height < 200 * 200) continue; // ícones e carimbos pequenos não interessam
        if (maior && img.width * img.height <= maior.w * maior.h) continue;
        maior = { w: img.width, h: img.height, png: pngDaImagem(img as { width: number; height: number; kind: number; data: Uint8ClampedArray }) };
      }
      if (maior) imagens.push(maior.png);
      pagina.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return imagens;
}

/** Imagem do pdfjs → PNG. kind: 1 = 1 bit por pixel (fax/scanner P&B), 2 = RGB, 3 = RGBA. */
function pngDaImagem({ width, height, kind, data }: { width: number; height: number; kind: number; data: Uint8ClampedArray }): Buffer {
  if (kind === 2) return pngDe(width, height, 3, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  if (kind === 3) {
    const rgb = new Uint8Array(width * height * 3);
    for (let p = 0, q = 0; p < width * height; p++, q += 4) { rgb[p * 3] = data[q]; rgb[p * 3 + 1] = data[q + 1]; rgb[p * 3 + 2] = data[q + 2]; }
    return pngDe(width, height, 3, rgb);
  }
  // 1 bit por pixel, linhas alinhadas em byte; bit 1 = branco.
  const cinza = new Uint8Array(width * height);
  const porLinha = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    cinza[y * width + x] = (data[y * porLinha + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
  }
  return pngDe(width, height, 1, cinza);
}

/** Texto de cada imagem (PNG/JPEG), em ordem. Um trabalhador por chamada; sempre encerrado. */
export async function ocr(imagens: Buffer[]): Promise<string[]> {
  if (!imagens.length) return [];
  const w = await trabalhador();
  try {
    const textos: string[] = [];
    for (const img of imagens) textos.push((await comPrazo(w.recognize(img), PRAZO_OCR_MS, "O OCR passou do prazo nesta página.")).data.text);
    return textos;
  } finally {
    await w.terminate();
  }
}
