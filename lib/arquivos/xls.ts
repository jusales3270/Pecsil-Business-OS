/**
 * Leitor mínimo de planilha .xls (Excel 97–2003, formato BIFF8), sem biblioteca.
 * O Bradesco Net Empresa (e outros sistemas) ainda exportam nesse formato.
 *
 * O .xls é um "arquivo composto" (CFB, como um mini sistema de arquivos); dentro
 * dele, o fluxo "Workbook" tem os registros BIFF. Lê as strings compartilhadas e
 * as células da PRIMEIRA aba (texto, número, RK, fórmula com o último valor).
 * Devolve a mesma matriz do leitor de .xlsx. Roda só no servidor.
 */
import type { Celula } from "./xlsx";

export class XlsInvalido extends Error {}

const FIM = 0xfffffffe;
const LIVRE = 0xffffffff;

function fluxoWorkbook(buf: Buffer): Buffer {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) throw new XlsInvalido("O arquivo não é uma planilha .xls válida.");
  const setor = 1 << buf.readUInt16LE(0x1e);
  const miniSetor = 1 << buf.readUInt16LE(0x20);
  const nFat = buf.readUInt32LE(0x2c);
  const dirInicio = buf.readUInt32LE(0x30);
  const corte = buf.readUInt32LE(0x38);
  const miniFatInicio = buf.readUInt32LE(0x3c);
  let difat = buf.readUInt32LE(0x44);
  const nDifat = buf.readUInt32LE(0x48);
  const off = (s: number) => 512 + s * setor;

  // Setores da FAT: 109 no cabeçalho + cadeia DIFAT.
  const setoresFat: number[] = [];
  for (let i = 0; i < 109 && setoresFat.length < nFat; i++) setoresFat.push(buf.readUInt32LE(0x4c + i * 4));
  for (let k = 0; k < nDifat && difat !== FIM && difat !== LIVRE; k++) {
    const base = off(difat);
    for (let i = 0; i < setor / 4 - 1 && setoresFat.length < nFat; i++) setoresFat.push(buf.readUInt32LE(base + i * 4));
    difat = buf.readUInt32LE(base + setor - 4);
  }
  const fat: number[] = [];
  for (const s of setoresFat) for (let i = 0; i < setor / 4; i++) fat.push(buf.readUInt32LE(off(s) + i * 4));
  const cadeia = (inicio: number, tabela: number[]) => {
    const lista: number[] = [];
    for (let s = inicio; s !== FIM && s !== LIVRE && s < tabela.length && lista.length <= tabela.length; s = tabela[s]) lista.push(s);
    return lista;
  };
  const ler = (inicio: number, tamanho?: number) => {
    const partes = cadeia(inicio, fat).map((s) => buf.subarray(off(s), off(s) + setor));
    const tudo = Buffer.concat(partes);
    return tamanho === undefined ? tudo : tudo.subarray(0, tamanho);
  };

  const dir = ler(dirInicio);
  let raiz: { inicio: number; tamanho: number } | null = null;
  let workbook: { inicio: number; tamanho: number } | null = null;
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const nomeLen = dir.readUInt16LE(p + 0x40);
    if (!nomeLen) continue;
    const nome = dir.subarray(p, p + Math.max(0, nomeLen - 2)).toString("utf16le");
    const tipo = dir[p + 0x42];
    const entrada = { inicio: dir.readUInt32LE(p + 0x74), tamanho: dir.readUInt32LE(p + 0x78) };
    if (tipo === 5) raiz = entrada;
    if (tipo === 2 && (nome === "Workbook" || nome === "Book")) workbook = entrada;
  }
  if (!workbook) throw new XlsInvalido("A planilha .xls não tem o fluxo Workbook.");
  if (workbook.tamanho >= corte) return ler(workbook.inicio, workbook.tamanho);

  // Fluxo pequeno: fica no "mini stream" (dentro da entrada raiz), indexado pela mini FAT.
  if (!raiz) throw new XlsInvalido("Planilha .xls sem a entrada raiz.");
  const miniFatBytes = ler(miniFatInicio);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatBytes.readUInt32LE(i));
  const miniStream = ler(raiz.inicio, raiz.tamanho);
  const partes = cadeia(workbook.inicio, miniFat).map((s) => miniStream.subarray(s * miniSetor, (s + 1) * miniSetor));
  return Buffer.concat(partes).subarray(0, workbook.tamanho);
}

type Registro = { tipo: number; dados: Buffer; pos: number };

function registros(wb: Buffer): Registro[] {
  const lista: Registro[] = [];
  for (let p = 0; p + 4 <= wb.length; ) {
    const tipo = wb.readUInt16LE(p);
    const tamanho = wb.readUInt16LE(p + 2);
    lista.push({ tipo, dados: wb.subarray(p + 4, p + 4 + tamanho), pos: p });
    p += 4 + tamanho;
  }
  return lista;
}

/** Tabela de strings compartilhadas (SST + CONTINUE), respeitando as quebras entre registros. */
function stringsCompartilhadas(sst: Buffer[]): string[] {
  let bloco = 0;
  let p = 8; // cstTotal + cstUnique
  const total = sst[0].readUInt32LE(4);
  const atual = () => sst[bloco];
  const garantir = () => { while (bloco < sst.length && p >= atual().length) { bloco++; p = 0; } };
  const u8 = () => { garantir(); return atual()[p++]; };
  const u16 = () => { garantir(); const v = atual().readUInt16LE(p); p += 2; return v; };
  const u32 = () => { garantir(); const v = atual().readUInt32LE(p); p += 4; return v; };
  const pular = (n: number) => { while (n > 0) { garantir(); const k = Math.min(n, atual().length - p); p += k; n -= k; } };
  const lista: string[] = [];
  for (let i = 0; i < total && bloco < sst.length; i++) {
    const cch = u16();
    let flags = u8();
    const rich = flags & 0x08 ? u16() : 0;
    const ext = flags & 0x04 ? u32() : 0;
    let texto = "";
    let falta = cch;
    while (falta > 0) {
      garantir();
      if (p === 0 && texto.length > 0) flags = (flags & ~0x01) | (atual()[p++] & 0x01); // string continua noutro registro
      const largura = flags & 0x01 ? 2 : 1;
      const cabem = Math.min(falta, Math.floor((atual().length - p) / largura));
      const pedaco = atual().subarray(p, p + cabem * largura);
      texto += largura === 2 ? pedaco.toString("utf16le") : pedaco.toString("latin1");
      p += cabem * largura;
      falta -= cabem;
      if (falta > 0) { bloco++; p = 0; if (bloco < sst.length) flags = (flags & ~0x01) | (atual()[p++] & 0x01); }
    }
    pular(rich * 4 + ext);
    lista.push(texto);
  }
  return lista;
}

const rk = (v: number) => {
  let n: number;
  if (v & 0x02) n = v >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(0, 0);
    b.writeUInt32LE(v & 0xfffffffc, 4);
    n = b.readDoubleLE(0);
  }
  return v & 0x01 ? n / 100 : n;
};

function textoUnicode(d: Buffer, p: number): string {
  const cch = d.readUInt16LE(p);
  const flags = d[p + 2];
  return flags & 0x01 ? d.subarray(p + 3, p + 3 + cch * 2).toString("utf16le") : d.subarray(p + 3, p + 3 + cch).toString("latin1");
}

/** Linhas da primeira aba. */
export function lerXls(buf: Buffer): Celula[][] {
  const regs = registros(fluxoWorkbook(buf));
  const sst: Buffer[] = [];
  let primeiraAba = -1;
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    if (r.tipo === 0x0085 && primeiraAba < 0) primeiraAba = r.dados.readUInt32LE(0);
    if (r.tipo === 0x00fc) {
      sst.push(r.dados);
      for (let j = i + 1; j < regs.length && regs[j].tipo === 0x003c; j++) sst.push(regs[j].dados);
    }
  }
  const strings = sst.length ? stringsCompartilhadas(sst) : [];
  const inicio = primeiraAba >= 0 ? regs.findIndex((r) => r.pos === primeiraAba) : regs.findIndex((r, i) => i > 0 && r.tipo === 0x0809);
  if (inicio < 0) throw new XlsInvalido("A primeira aba da planilha .xls não foi encontrada.");

  const linhas: Celula[][] = [];
  const por = (row: number, col: number, v: Celula) => { (linhas[row] ??= [])[col] = v; };
  let formulaPendente: { row: number; col: number } | null = null;
  for (let i = inicio + 1; i < regs.length; i++) {
    const { tipo, dados: d } = regs[i];
    if (tipo === 0x000a) break; // EOF da aba
    if (tipo === 0x00fd) por(d.readUInt16LE(0), d.readUInt16LE(2), strings[d.readUInt32LE(6)] ?? "");
    else if (tipo === 0x0204) por(d.readUInt16LE(0), d.readUInt16LE(2), textoUnicode(d, 6));
    else if (tipo === 0x0203) por(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
    else if (tipo === 0x027e) por(d.readUInt16LE(0), d.readUInt16LE(2), rk(d.readUInt32LE(6)));
    else if (tipo === 0x00bd) {
      const row = d.readUInt16LE(0);
      const first = d.readUInt16LE(2);
      const n = (d.length - 6) / 6;
      for (let k = 0; k < n; k++) por(row, first + k, rk(d.readUInt32LE(4 + k * 6 + 2)));
    } else if (tipo === 0x0006) {
      const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
      if (d.readUInt16LE(12) === 0xffff) {
        if (d[6] === 0) formulaPendente = { row, col }; // o texto vem no registro STRING seguinte
        else if (d[6] === 1) por(row, col, d[8]);
        else por(row, col, "");
      } else por(row, col, d.readDoubleLE(6));
    } else if (tipo === 0x0207 && formulaPendente) {
      por(formulaPendente.row, formulaPendente.col, textoUnicode(d, 0));
      formulaPendente = null;
    } else if (tipo === 0x0205) por(d.readUInt16LE(0), d.readUInt16LE(2), d[7] === 0 ? d[6] : "");
  }
  return Array.from(linhas, (l) => Array.from(l ?? [], (x) => (x === undefined ? null : x)));
}
