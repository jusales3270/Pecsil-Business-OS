/**
 * Leitor mínimo de planilha .xlsx, sem biblioteca: o .xlsx é um zip de XMLs.
 * Abre o zip com `node:zlib`, lê as strings compartilhadas e a PRIMEIRA aba,
 * e devolve uma matriz de células (texto ou número). Serve para extratos e
 * relatórios exportados pelos bancos/sistemas; fórmulas vêm com o último valor
 * calculado que o Excel gravou. Roda só no servidor.
 */
import { inflateRawSync } from "node:zlib";
import { prepararZip, ZipInvalido, type LimitesZip } from "../leitura/zip.ts";
import { atributoXml, elementosXml, orcamentoXml, referenciaCelula, textoSemMarcas, validarDimensao, XmlInvalido, type OrcamentoXml } from "../leitura/xml.ts";

export class XlsxInvalido extends Error {}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decod = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (s, n: string) =>
  n[0] === "#" ? String.fromCodePoint(n[1].toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10)) : ENT[n.toLowerCase()] ?? s);

/** Texto de <t>, inclusive runs de texto rico, com limite do formato Excel. */
function textoDe(xml: string, limite: OrcamentoXml): string {
  const partes: string[] = [];
  let tamanho = 0;
  for (const { conteudo } of elementosXml(xml, "t", limite)) {
    const texto = decod(textoSemMarcas(conteudo, limite, 32_000_000));
    tamanho += texto.length;
    if (tamanho > 32_767) throw new XmlInvalido("A célula ultrapassa o limite de texto da planilha.");
    limite.verificar();
    partes.push(texto);
  }
  return partes.join("");
}

export type Celula = string | number | null;

/** Linhas da primeira aba. Linhas vazias no meio viram `[]`. */
export function lerXlsx(buf: Buffer, limites: Partial<LimitesZip> = {}): Celula[][] {
  const zip = prepararZip(buf, limites);
  const limiteXml = orcamentoXml();
  const pegar = (nome: string) => {
    zip.verificarPrazo();
    const e = zip.mapa.get(nome);
    if (!e) return null;
    const comprimido = buf.subarray(e.inicio, e.inicio + e.tamanho);
    const teto = Math.floor(zip.teto(e));
    if (teto < 1 && e.expandido) throw new ZipInvalido("O arquivo compactado ultrapassa os limites de leitura segura.");
    let dados: Buffer;
    try { dados = e.metodo === 0 ? comprimido : inflateRawSync(comprimido, { maxOutputLength: Math.max(1, teto) }); }
    catch { throw new ZipInvalido("O arquivo compactado está inválido ou ultrapassa os limites de leitura segura."); }
    zip.contar(e, dados.byteLength, dados.byteLength);
    if (dados.byteLength !== e.expandido) throw new ZipInvalido("Tamanho da entrada do zip inválido.");
    return dados.toString("utf8");
  };

  const workbook = pegar("xl/workbook.xml");
  if (!workbook) throw new XlsxInvalido("O arquivo não é uma planilha .xlsx (falta xl/workbook.xml).");
  const primeira = elementosXml(workbook, "sheet", limiteXml).next().value;
  const relacao = primeira ? atributoXml(primeira.atributos, "r:id") : null;
  const rels = pegar("xl/_rels/workbook.xml.rels") ?? "";
  let caminho = "xl/worksheets/sheet1.xml";
  if (relacao) {
    for (const { atributos } of elementosXml(rels, "Relationship", limiteXml)) {
      if (atributoXml(atributos, "Id") !== relacao) continue;
      const alvo = atributoXml(atributos, "Target");
      if (alvo) caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
      break;
    }
  }
  const folha = pegar(caminho);
  if (!folha) throw new XlsxInvalido("A primeira aba da planilha não foi encontrada.");

  const compartilhadas: string[] = [];
  for (const { conteudo } of elementosXml(pegar("xl/sharedStrings.xml") ?? "", "si", limiteXml)) {
    if (compartilhadas.length >= 100_000) throw new XlsxInvalido("A planilha ultrapassa o limite de textos compartilhados.");
    compartilhadas.push(textoDe(conteudo, limiteXml));
  }
  validarDimensao(folha, limiteXml);

  const linhas: Celula[][] = [];
  let celulasDensas = 0;
  let celulasLidas = 0;
  for (const { atributos, conteudo: linha } of elementosXml(folha, "row", limiteXml)) {
    const numero = Number(atributoXml(atributos, "r") ?? linhas.length + 1);
    if (!Number.isSafeInteger(numero) || numero < 1 || numero > 100_000) throw new XlsxInvalido("A planilha ultrapassa o limite de linhas.");
    zip.verificarPrazo();
    const celulas: Celula[] = [];
    for (const { atributos: attrs, conteudo: corpo } of elementosXml(linha, "c", limiteXml)) {
      if (++celulasLidas > 1_000_000) throw new XlsxInvalido("A planilha ultrapassa o limite de células.");
      const ref = atributoXml(attrs, "r");
      const tipo = atributoXml(attrs, "t") ?? "n";
      const bruto = elementosXml(corpo, "v", limiteXml).next().value?.conteudo;
      const v = bruto === undefined ? undefined : decod(bruto);
      if (v !== undefined && v.length > 32_767) throw new XlsxInvalido("A célula ultrapassa o limite de texto da planilha.");
      let valor: Celula = null;
      if (tipo === "s" && v !== undefined) valor = compartilhadas[Number(v)] ?? "";
      else if (tipo === "inlineStr") valor = textoDe(corpo, limiteXml);
      else if (tipo === "str" || tipo === "e") valor = v ?? "";
      else if (tipo === "b") valor = v === "1" ? 1 : 0;
      else if (v !== undefined) valor = Number(v);
      const coluna = ref ? referenciaCelula(ref).coluna : celulas.length;
      if (!Number.isSafeInteger(coluna) || coluna < 0 || coluna >= 16_384) throw new XlsxInvalido("A planilha ultrapassa o limite de colunas.");
      celulas[coluna] = valor;
    }
    celulasDensas += celulas.length;
    if (celulasDensas > 1_000_000) throw new XlsxInvalido("A planilha ultrapassa o limite de células.");
    linhas[numero - 1] = Array.from(celulas, (x) => (x === undefined ? null : x));
  }
  return Array.from(linhas, (l) => l ?? []);
}
