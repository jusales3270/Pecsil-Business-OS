/**
 * Texto de um arquivo (Segundo Cérebro, Etapa 3). Roda no navegador (coleta: lê no próprio
 * computador, antes de conferir) e no servidor (o texto guardado de cada documento, sempre
 * relido a partir do original). O tipo vem do conteúdo (`tipoDoArquivo`), não da extensão.
 *
 * PDF e .xls dependem de onde roda (pdfjs do navegador × do servidor; .xls só no servidor):
 * quem chama passa o extrator. PDF sem texto (escaneado) e foto ficam para o OCR do servidor.
 */
import { tipoDoArquivo, type TipoArquivo } from "../arquivos/detectar.ts";
import { abrirZip } from "./zip.ts";

export const LIMITE_TEXTO = 200_000;
export const LIMITE_PAGINAS_TEXTO = 50;

export type MetodoLeitura = "pdf" | "docx" | "xlsx" | "xls" | "xml" | "ofx" | "txt" | "ocr";

export type Leitura =
  | { status: "lido"; metodo: MetodoLeitura; texto: string; paginas: number | null }
  /** Sem texto para ler: `ocr` diz se o OCR do servidor pode tentar (PDF escaneado, foto). */
  | { status: "sem_texto"; tipo: TipoArquivo; ocr: boolean; motivo: string };

export type Extratores = {
  /** Texto de cada página do PDF (até o limite de páginas). */
  pdf?: (dados: Uint8Array) => Promise<string[]>;
  /** Linhas de uma planilha .xls (Excel 97–2003). */
  xls?: (dados: Uint8Array) => Promise<string[]>;
};

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const decodificarXml = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (s, n: string) =>
  n[0] === "#" ? String.fromCodePoint(n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10)) : ENT[n.toLowerCase()] ?? s);

const limpar = (t: string) => t.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, LIMITE_TEXTO);

/** Texto puro: UTF-8, ou Latin-1 quando o UTF-8 não fecha (arquivos antigos do Windows). */
function textoPuro(dados: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(dados);
  return utf8.includes("�") ? new TextDecoder("latin1").decode(dados) : utf8;
}

/** Parece texto (CSV, TXT)? Sem bytes de controle nos primeiros 4 KB. */
function pareceTexto(dados: Uint8Array): boolean {
  const n = Math.min(dados.length, 4096);
  if (!n) return false;
  let ruins = 0;
  for (let i = 0; i < n; i++) { const b = dados[i]; if (b === 0 || (b < 9) || (b > 13 && b < 32)) ruins++; }
  return ruins / n < 0.01;
}

async function textoDocx(dados: Uint8Array): Promise<string> {
  const xml = await abrirZip(dados).ler("word/document.xml");
  if (!xml) return "";
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map(([p]) => decodificarXml(p.replace(/<w:tab\/>/g, "\t").replace(/<w:br\/>/g, "\n").replace(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (_, t) => t ?? "")))
    .join("\n");
}

async function textoXlsx(dados: Uint8Array): Promise<string> {
  const zip = abrirZip(dados);
  const compartilhadas = [...((await zip.ler("xl/sharedStrings.xml")) ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(([, si]) => decodificarXml([...si.matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join("")));
  const abas = zip.nomes.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const linhas: string[] = [];
  for (const aba of abas) {
    const xml = (await zip.ler(aba)) ?? "";
    for (const [, linha] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const celulas = [...linha.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(([, attrs, corpo = ""]) => {
        const t = attrs.match(/\bt="(\w+)"/)?.[1];
        if (t === "inlineStr") return decodificarXml(corpo.replace(/<[^>]+>/g, ""));
        const v = corpo.match(/<v>([^<]*)<\/v>/)?.[1] ?? "";
        return t === "s" ? compartilhadas[Number(v)] ?? "" : decodificarXml(v);
      }).filter((c) => c.trim());
      if (celulas.length) linhas.push(celulas.join(" | "));
      if (linhas.length > 20_000) break;
    }
  }
  return linhas.join("\n");
}

/** Texto dos campos de um XML (NF-e e outros): o conteúdo entre as marcas, um por linha. */
const textoXml = (xml: string) => [...xml.matchAll(/>([^<>]+)</g)].map((m) => decodificarXml(m[1].trim())).filter(Boolean).join("\n");

/** Lê o texto do arquivo. Nunca lança: falha vira "sem_texto" com o motivo. */
export async function lerTexto(dados: Uint8Array, extratores: Extratores = {}): Promise<Leitura> {
  const tipo = tipoDoArquivo(dados);
  const lido = (metodo: MetodoLeitura, texto: string, paginas: number | null = null): Leitura => {
    const t = limpar(texto);
    return t.length >= 3 ? { status: "lido", metodo, texto: t, paginas } : { status: "sem_texto", tipo, ocr: false, motivo: "o arquivo não tem texto" };
  };
  try {
    switch (tipo) {
      case "pdf": {
        if (!extratores.pdf) return { status: "sem_texto", tipo, ocr: true, motivo: "leitor de PDF indisponível aqui" };
        const paginas = await extratores.pdf(dados);
        const texto = paginas.join("\n\n");
        // Escaneado: menos de 10 letras por página, em média. Fica para o OCR.
        if (texto.replace(/\s/g, "").length < 10 * Math.max(1, paginas.length)) return { status: "sem_texto", tipo, ocr: true, motivo: "PDF escaneado (sem texto)" };
        return lido("pdf", texto, paginas.length);
      }
      case "docx": return lido("docx", await textoDocx(dados));
      case "xlsx": return lido("xlsx", await textoXlsx(dados));
      case "xls": return extratores.xls ? lido("xls", (await extratores.xls(dados)).join("\n")) : { status: "sem_texto", tipo, ocr: false, motivo: "planilha antiga (.xls): lida depois de guardada" };
      case "nfe-xml":
      case "xml": return lido("xml", textoXml(textoPuro(dados)));
      case "ofx": return lido("ofx", textoPuro(dados).replace(/<[^>]+>/g, " "));
      case "imagem": return { status: "sem_texto", tipo, ocr: true, motivo: "foto ou digitalização" };
      default:
        return pareceTexto(dados) ? lido("txt", textoPuro(dados)) : { status: "sem_texto", tipo, ocr: false, motivo: "formato sem leitor" };
    }
  } catch (e) {
    return { status: "sem_texto", tipo, ocr: tipo === "pdf", motivo: e instanceof Error ? e.message.slice(0, 200) : "falha na leitura" };
  }
}
