import { crc32, deflateRawSync } from "node:zlib";

/**
 * Planilha Excel (.xlsx) escrita pela plataforma, sem biblioteca (I-27; o leitor é lib/arquivos/xlsx.ts). Uma aba
 * por tabela, cabeçalho em negrito e congelado, filtro, largura das colunas pelo conteúdo. Número continua número
 * (soma e filtra no Excel), com o formato de moeda, número, dias ou data; texto é texto.
 */

export type FormatoCelula = "moeda" | "numero" | "dias" | "data" | "texto";
export type Celula = string | number | null;
export type Aba = { nome: string; colunas: { rotulo: string; formato: FormatoCelula }[]; linhas: Celula[][]; formatos?: FormatoCelula[][] };

/** Índice do estilo (cellXfs) de cada formato; número inteiro usa o 6 (sem casas), número com fração o 3. */
const ESTILO: Record<FormatoCelula, number> = { texto: 0, moeda: 2, numero: 3, dias: 4, data: 5 };
const INTEIRO = 6;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // Caractere de controle quebra o XML da planilha.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** A, B, …, Z, AA, AB… */
export function coluna(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Data (AAAA-MM-DD, com ou sem hora) no número de série do Excel; null se não for data. */
export function serialDaData(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t / 86_400_000 + 25_569 : null;
}

/** Nome de aba que o Excel aceita: sem [ ] : * ? / \, até 31 letras, sem repetir. */
export function nomesDeAbas(nomes: string[]): string[] {
  const usados = new Set<string>();
  return nomes.map((n, i) => {
    const base = (n.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || `Aba ${i + 1}`).slice(0, 31);
    let nome = base;
    for (let k = 2; usados.has(nome.toLowerCase()); k++) nome = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    usados.add(nome.toLowerCase());
    return nome;
  });
}

function celula(ref: string, v: Celula, formato: FormatoCelula): string {
  if (v === null || v === undefined || v === "") return "";
  if (formato === "data" && typeof v === "string") {
    const serial = serialDaData(v);
    if (serial !== null) return `<c r="${ref}" s="${ESTILO.data}"><v>${serial}</v></c>`;
  }
  if (typeof v === "number" && Number.isFinite(v) && formato !== "texto") {
    const estilo = formato === "numero" && Number.isInteger(v) ? INTEIRO : ESTILO[formato] || ESTILO.numero;
    return `<c r="${ref}" s="${estilo}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function folha(a: Aba): string {
  // Largura pelo que aparece: moeda ganha o "R$" e os pontos de milhar; data tem 10 letras.
  const mostrado = (v: Celula, f: FormatoCelula) => (typeof v === "number" && f === "moeda" ? String(Math.round(Math.abs(v))).length * 1.35 + 7 : f === "data" ? 10 : String(v ?? "").length);
  const larguras = a.colunas.map((c, j) => Math.round(Math.min(60, Math.max(10, c.rotulo.length + 2, ...a.linhas.slice(0, 200).map((l, i) => mostrado(l[j] ?? null, a.formatos?.[i]?.[j] ?? c.formato) + 2)))));
  const ultima = coluna(Math.max(0, a.colunas.length - 1));
  const cabecalho = `<row r="1">${a.colunas.map((c, j) => `<c r="${coluna(j)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${esc(c.rotulo)}</t></is></c>`).join("")}</row>`;
  const linhas = a.linhas.map((l, i) => `<row r="${i + 2}">${a.colunas.map((c, j) => celula(`${coluna(j)}${i + 2}`, l[j] ?? null, a.formatos?.[i]?.[j] ?? c.formato)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${larguras.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    + `<sheetData>${cabecalho}${linhas}</sheetData>`
    + (a.linhas.length ? `<autoFilter ref="A1:${ultima}${a.linhas.length + 1}"/>` : "")
    + `</worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="0\\ &quot;dias&quot;"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy"/></numFmts>`
  + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
  + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF8"/></patternFill></fill></fills>`
  + `<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`
  + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
  + `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
  + `</styleSheet>`;

/** O intervalo do filtro de cada aba com linhas (o Excel guarda num bloco só). */
function filtros(abas: Aba[], nomes: string[]): string {
  const itens = abas.flatMap((a, i) => (a.linhas.length
    ? [`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(nomes[i]).replace(/'/g, "''")}'!$A$1:$${coluna(Math.max(0, a.colunas.length - 1))}$${a.linhas.length + 1}</definedName>`]
    : []));
  return itens.length ? `<definedNames>${itens.join("")}</definedNames>` : "";
}

/** Os arquivos do .xlsx (caminho → conteúdo). */
export function partesDaPlanilha(abas: Aba[], titulo: string): [string, string][] {
  const nomes = nomesDeAbas(abas.map((a) => a.nome));
  return [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(titulo)}</dc:title><dc:creator>Pecsil Business OS</dc:creator></cp:coreProperties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${filtros(abas, nomes)}</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", ESTILOS],
    ...abas.map((a, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, folha(a)]),
  ];
}

/** Zip (deflate) com os arquivos, no formato que o Excel, o Numbers e o LibreOffice abrem. */
export function zip(arquivos: [string, string | Uint8Array][]): Uint8Array {
  const locais: Buffer[] = [], centrais: Buffer[] = [];
  let posicao = 0;
  for (const [nome, conteudo] of arquivos) {
    const dados = Buffer.from(conteudo);
    const comprimido = deflateRawSync(dados);
    const nomeB = Buffer.from(nome, "utf8");
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeB.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nomeB.length, 28); central.writeUInt32LE(posicao, 42);
    locais.push(local, nomeB, comprimido);
    centrais.push(central, nomeB);
    posicao += 30 + nomeB.length + comprimido.length;
  }
  const centralB = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(centralB.length, 12); fim.writeUInt32LE(posicao, 16);
  return new Uint8Array(Buffer.concat([...locais, centralB, fim]));
}

/** A planilha pronta, em bytes. */
export const gerarXlsx = (abas: Aba[], titulo: string) => zip(partesDaPlanilha(abas.length ? abas : [{ nome: "Planilha", colunas: [{ rotulo: "Sem dados", formato: "texto" }], linhas: [] }], titulo));
