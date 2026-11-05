/**
 * Texto de um arquivo (Segundo Cérebro, Etapa 3). Roda no navegador (coleta: lê no próprio
 * computador, antes de conferir) e no servidor (o texto guardado de cada documento, sempre
 * relido a partir do original). O tipo vem do conteúdo (`tipoDoArquivo`), não da extensão.
 *
 * PDF e .xls dependem de onde roda (pdfjs do navegador × do servidor; .xls só no servidor):
 * quem chama passa o extrator. PDF sem texto (escaneado) e foto ficam para o OCR do servidor.
 */
import { tipoDoArquivo, type TipoArquivo } from "../arquivos/detectar.ts";
import { abrirZip, LIMITES_ZIP } from "./zip.ts";
import { atributoXml, elementosXml, orcamentoXml, referenciaCelula, textoSemMarcas, validarDimensao, XmlInvalido, type OrcamentoXml } from "./xml.ts";

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

/** Consome cada run uma vez; /[ \t]+\n/ tentava todo sufixo de um run sem newline. */
const normalizarEspacos = (t: string) => {
  const semCR = t.replace(/\r/g, "");
  return semCR.replace(/[ \t]+/g, (run, inicio: number) => semCR[inicio + run.length] === "\n" ? "" : run).replace(/\n{3,}/g, "\n\n");
};
const limpar = (t: string) => normalizarEspacos(t).trim().slice(0, LIMITE_TEXTO);

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

function textoDosNos(xml: string, limite: OrcamentoXml): string {
  const partes: string[] = [];
  let tamanho = 0;
  for (const { conteudo } of elementosXml(xml, "t", limite)) {
    const texto = decodificarXml(textoSemMarcas(conteudo, limite, LIMITES_ZIP.entrada));
    tamanho += texto.length;
    if (tamanho > 32_767) throw new XmlInvalido("A célula ultrapassa o limite de texto da planilha.");
    limite.verificar();
    partes.push(texto);
  }
  return partes.join("");
}

async function textoDocx(dados: Uint8Array): Promise<string> {
  const xml = await abrirZip(dados).ler("word/document.xml");
  if (!xml) return "";
  const limite = orcamentoXml(), partes: string[] = [];
  let tamanho = 0;
  for (const { conteudo } of elementosXml(xml, "w:p", limite)) {
    const bruto = normalizarEspacos(decodificarXml(textoSemMarcas(conteudo, limite, LIMITES_ZIP.entrada, "", true)));
    const texto = (partes.length ? bruto : bruto.trimStart()).slice(0, LIMITE_TEXTO - tamanho);
    limite.verificar();
    partes.push(texto); tamanho += texto.length + 1;
    if (tamanho >= LIMITE_TEXTO) break;
  }
  return partes.join("\n");
}

async function textoXlsx(dados: Uint8Array): Promise<string> {
  const zip = abrirZip(dados), limite = orcamentoXml();
  const compartilhadas: string[] = [];
  for (const { conteudo } of elementosXml((await zip.ler("xl/sharedStrings.xml")) ?? "", "si", limite)) {
    if (compartilhadas.length >= 100_000) throw new XmlInvalido("A planilha ultrapassa o limite de textos compartilhados.");
    compartilhadas.push(textoDosNos(conteudo, limite));
  }
  const abas = zip.nomes.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const linhas: string[] = [];
  let caracteres = 0, lidas = 0, celulasLidas = 0;
  for (const aba of abas) {
    const xml = (await zip.ler(aba)) ?? "";
    validarDimensao(xml, limite);
    for (const { atributos, conteudo: linha } of elementosXml(xml, "row", limite)) {
      const numero = Number(atributoXml(atributos, "r") ?? lidas + 1);
      if (!Number.isSafeInteger(numero) || numero < 1 || numero > 100_000) throw new XmlInvalido("A planilha ultrapassa o limite de linhas.");
      if (++lidas > 20_000) return linhas.join("\n");
      const celulas: string[] = [];
      let tamanhoLinha = 0;
      for (const { atributos: attrs, conteudo: corpo } of elementosXml(linha, "c", limite)) {
        if (++celulasLidas > 1_000_000) throw new XmlInvalido("A planilha ultrapassa o limite de células.");
        const ref = atributoXml(attrs, "r");
        if (ref) referenciaCelula(ref);
        const t = atributoXml(attrs, "t");
        const v = decodificarXml(elementosXml(corpo, "v", limite).next().value?.conteudo ?? "");
        if (v.length > 32_767) throw new XmlInvalido("A célula ultrapassa o limite de texto da planilha.");
        const valor = t === "inlineStr" ? textoDosNos(corpo, limite)
          : t === "s" ? compartilhadas[Number(v)] ?? "" : v;
        if (!valor.trim()) continue;
        const restante = Math.max(0, LIMITE_TEXTO - caracteres - tamanhoLinha);
        celulas.push(valor.slice(0, restante));
        tamanhoLinha += Math.min(valor.length, restante) + 3;
        if (tamanhoLinha + caracteres >= LIMITE_TEXTO) break;
      }
      if (celulas.length) { linhas.push(celulas.join(" | ")); caracteres += tamanhoLinha + 1; }
      if (caracteres >= LIMITE_TEXTO || linhas.length >= 20_000) return linhas.join("\n");
    }
  }
  return linhas.join("\n");
}

/** Texto XML limitado antes de decode/joins; OFX também usa remoção monotônica de marcas. */
const textoXml = (xml: string) => decodificarXml(textoSemMarcas(xml, orcamentoXml(), LIMITE_TEXTO, "\n")).split("\n").map((s) => s.trim()).filter(Boolean).join("\n");

/** Lê o texto do arquivo. Nunca lança: falha vira "sem_texto" com o motivo. */
export async function lerTexto(dados: Uint8Array, extratores: Extratores = {}): Promise<Leitura> {
  if (dados.byteLength > LIMITES_ZIP.arquivo) return { status: "sem_texto", tipo: "desconhecido", ocr: false, motivo: "O arquivo ultrapassa o limite de leitura segura." };
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
      case "ofx": return lido("ofx", textoSemMarcas(textoPuro(dados), orcamentoXml(), LIMITE_TEXTO, " ", false, false));
      case "imagem": return { status: "sem_texto", tipo, ocr: true, motivo: "foto ou digitalização" };
      default:
        return pareceTexto(dados) ? lido("txt", textoPuro(dados)) : { status: "sem_texto", tipo, ocr: false, motivo: "formato sem leitor" };
    }
  } catch (e) {
    return { status: "sem_texto", tipo, ocr: tipo === "pdf", motivo: e instanceof Error ? e.message.slice(0, 200) : "falha na leitura" };
  }
}
