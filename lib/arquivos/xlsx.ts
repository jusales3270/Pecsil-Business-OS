/**
 * Leitor mínimo de planilha .xlsx, sem biblioteca: o .xlsx é um zip de XMLs.
 * Abre o zip com `node:zlib`, lê as strings compartilhadas e a PRIMEIRA aba,
 * e devolve uma matriz de células (texto ou número). Serve para extratos e
 * relatórios exportados pelos bancos/sistemas; fórmulas vêm com o último valor
 * calculado que o Excel gravou. Roda só no servidor.
 */
import { inflateRawSync } from "node:zlib";

export class XlsxInvalido extends Error {}

type Entrada = { nome: string; metodo: number; tamanho: number; inicio: number };

function entradasDoZip(buf: Buffer): Map<string, Entrada> {
  // Fim do diretório central: assinatura 0x06054b50 nos últimos ~64 KB.
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new XlsxInvalido("O arquivo não é uma planilha .xlsx válida.");
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const mapa = new Map<string, Entrada>();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxInvalido("Diretório do zip corrompido.");
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nLen).toString("utf8");
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    mapa.set(nome, { nome, metodo, tamanho, inicio });
    p += 46 + nLen + eLen + cLen;
  }
  return mapa;
}

function ler(buf: Buffer, e: Entrada): string {
  const dados = buf.subarray(e.inicio, e.inicio + e.tamanho);
  if (e.metodo === 0) return dados.toString("utf8");
  if (e.metodo === 8) return inflateRawSync(dados).toString("utf8");
  throw new XlsxInvalido(`Compressão ${e.metodo} não suportada.`);
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decod = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (s, n: string) =>
  n[0] === "#" ? String.fromCodePoint(n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10)) : ENT[n.toLowerCase()] ?? s);

/** Texto de um nó com <t> (inclusive texto rico, com vários <r><t>). */
const textoDe = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decod(m[1])).join("");

const colIndex = (ref: string) => {
  const letras = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export type Celula = string | number | null;

/** Linhas da primeira aba. Linhas vazias no meio viram `[]`. */
export function lerXlsx(buf: Buffer): Celula[][] {
  const zip = entradasDoZip(buf);
  const pegar = (nome: string) => { const e = zip.get(nome); return e ? ler(buf, e) : null; };

  const workbook = pegar("xl/workbook.xml");
  if (!workbook) throw new XlsxInvalido("O arquivo não é uma planilha .xlsx (falta xl/workbook.xml).");
  const primeira = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  const rels = pegar("xl/_rels/workbook.xml.rels") ?? "";
  let caminho = "xl/worksheets/sheet1.xml";
  if (primeira) {
    const alvo = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${primeira[1]}"`))?.match(/Target="([^"]+)"/)?.[1];
    if (alvo) caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
  }
  const folha = pegar(caminho);
  if (!folha) throw new XlsxInvalido("A primeira aba da planilha não foi encontrada.");

  const compartilhadas = [...(pegar("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));

  const linhas: Celula[][] = [];
  for (const row of folha.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const atributos = row[1] ?? row[3] ?? "";
    const numero = Number(atributos.match(/\br="(\d+)"/)?.[1] ?? linhas.length + 1);
    const celulas: Celula[] = [];
    for (const c of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const corpo = c[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valor: Celula = null;
      if (tipo === "s" && v !== undefined) valor = compartilhadas[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoDe(corpo);
      else if (tipo === "str" || tipo === "e") valor = v !== undefined ? decod(v) : "";
      else if (tipo === "b") valor = v === "1" ? 1 : 0;
      else if (v !== undefined) valor = Number(v);
      celulas[ref ? colIndex(ref) : celulas.length] = valor;
    }
    linhas[numero - 1] = Array.from(celulas, (x) => (x === undefined ? null : x));
  }
  return Array.from(linhas, (l) => l ?? []);
}
