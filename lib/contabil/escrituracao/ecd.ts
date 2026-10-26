/**
 * Plano de contas e saldos de abertura (N-04), de dois formatos:
 * - ECD (SPED Contábil, .txt com linhas |REG|campo|…|): I050 (contas), I051 (conta referencial da Receita),
 *   I150/I155 (saldos por período; vale o último período do arquivo, depois do encerramento);
 * - planilha CSV (; ou ,) com codigo, nome, natureza, tipo e, se houver, nivel, superior e referencial.
 * Puro. A abertura só leva as contas patrimoniais (ativo, passivo, PL): resultado começa zerado.
 */
import type { Lado } from "./regras";

export type Natureza = "ativo" | "passivo" | "pl" | "resultado" | "compensacao" | "outras";
export type ContaImportada = { codigo: string; nome: string; natureza: Natureza; tipo: "sintetica" | "analitica"; nivel: number; superior_codigo: string | null; referencial: string | null };
export type Saldo = { codigo: string; valor: number; lado: Lado };
export type Importado = { contas: ContaImportada[]; saldos: Saldo[]; saldosEm: string | null; empresa: { nome: string | null; cnpj: string | null }; avisos: string[] };

const NATUREZA_ECD: Record<string, Natureza> = { "01": "ativo", "02": "passivo", "03": "pl", "04": "resultado", "05": "compensacao", "09": "outras" };
const num = (v: string | undefined) => Number(String(v ?? "0").replace(/\./g, "").replace(",", ".")) || 0;
/** DDMMAAAA → AAAA-MM-DD. */
const dataEcd = (v: string | undefined) => (v && /^\d{8}$/.test(v) ? `${v.slice(4)}-${v.slice(2, 4)}-${v.slice(0, 2)}` : null);

export function lerEcd(texto: string): Importado {
  const contas: ContaImportada[] = [];
  const saldosPorPeriodo = new Map<string, Map<string, number>>();
  const avisos: string[] = [];
  let empresa = { nome: null as string | null, cnpj: null as string | null };
  let ultima: ContaImportada | null = null;
  let periodo: string | null = null;
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.startsWith("|")) continue;
    const f = linha.split("|").slice(1, -1);
    switch (f[0]) {
      case "0000": empresa = { nome: f[4] ?? null, cnpj: f[5] ?? null }; break;
      case "I050": {
        const natureza = NATUREZA_ECD[f[2]];
        if (!natureza) { avisos.push(`Conta ${f[5]}: natureza ${f[2]} desconhecida.`); ultima = null; break; }
        ultima = { codigo: f[5], nome: f[7], natureza, tipo: f[3] === "S" ? "sintetica" : "analitica", nivel: Number(f[4]) || 1, superior_codigo: f[6] || null, referencial: null };
        contas.push(ultima);
        break;
      }
      case "I051": if (ultima) ultima.referencial = f[f.length - 1] || ultima.referencial; break;
      case "I150": periodo = dataEcd(f[2]); if (periodo) saldosPorPeriodo.set(periodo, new Map()); break;
      case "I155": {
        if (!periodo) break;
        const m = saldosPorPeriodo.get(periodo)!;
        const v = num(f[7]) * (f[8] === "C" ? -1 : 1); // VL_SLD_FIN e IND_DC_FIN
        m.set(f[1], (m.get(f[1]) ?? 0) + v);
        break;
      }
    }
  }
  if (!contas.length) avisos.push("O arquivo não tem contas (registro I050): é mesmo uma ECD?");
  const ultimoPeriodo = [...saldosPorPeriodo.keys()].sort().pop() ?? null;
  const saldos = ultimoPeriodo ? [...saldosPorPeriodo.get(ultimoPeriodo)!].filter(([, v]) => Math.round(v * 100) !== 0).map(([codigo, v]) => ({ codigo, valor: Math.round(Math.abs(v) * 100) / 100, lado: (v > 0 ? "D" : "C") as Lado })) : [];
  return { contas, saldos, saldosEm: ultimoPeriodo, empresa, avisos };
}

const NATUREZA_TEXTO: [RegExp, Natureza][] = [[/^(0?1|ativo)/i, "ativo"], [/^(0?2|passivo)/i, "passivo"], [/^(0?3|pl|patrim)/i, "pl"], [/^(0?4|resultado|receita|despesa|custo)/i, "resultado"], [/^(0?5|compensa)/i, "compensacao"], [/^(0?9|outra)/i, "outras"]];
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Planilha CSV com cabeçalho. Nível e superior saem do código (1.1.01 → nível 3, superior 1.1) quando faltam. */
export function lerPlanoCsv(texto: string): Importado {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = (linhas[0]?.match(/;/g)?.length ?? 0) >= (linhas[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const cab = (linhas[0] ?? "").split(sep).map(semAcento);
  const col = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c.startsWith(n)));
  const ic = col("codigo", "cod", "conta"), inome = col("nome", "descricao", "titulo"), inat = col("natureza", "grupo"), itipo = col("tipo", "sintetica", "analitica");
  const inivel = col("nivel"), isup = col("superior", "conta superior", "pai"), iref = col("referencial", "conta referencial");
  const avisos: string[] = [];
  if (ic < 0 || inome < 0 || inat < 0) return { contas: [], saldos: [], saldosEm: null, empresa: { nome: null, cnpj: null }, avisos: ["A planilha precisa das colunas codigo, nome e natureza (e, se tiver, tipo, nivel, superior e referencial)."] };
  const contas: ContaImportada[] = [];
  for (const [k, l] of linhas.slice(1).entries()) {
    const f = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
    const codigo = f[ic], nome = f[inome];
    if (!codigo || !nome) continue;
    const natureza = NATUREZA_TEXTO.find(([re]) => re.test(semAcento(f[inat] ?? "")))?.[1];
    if (!natureza) { avisos.push(`Linha ${k + 2}: natureza "${f[inat] ?? ""}" desconhecida.`); continue; }
    const partes = codigo.split(/[.\-]/).filter(Boolean);
    const tipoTxt = semAcento(itipo >= 0 ? f[itipo] ?? "" : "");
    contas.push({
      codigo, nome, natureza,
      tipo: tipoTxt.startsWith("s") ? "sintetica" : tipoTxt.startsWith("a") ? "analitica" : "analitica",
      nivel: Number(inivel >= 0 ? f[inivel] : NaN) || partes.length,
      superior_codigo: (isup >= 0 ? f[isup] : "") || (partes.length > 1 ? codigo.slice(0, codigo.lastIndexOf(partes[partes.length - 1])).replace(/[.\-]$/, "") : null),
      referencial: (iref >= 0 ? f[iref] : "") || null,
    });
  }
  // Sem a coluna tipo: quem é superior de alguém é sintética.
  if (itipo < 0) {
    const superiores = new Set(contas.map((c) => c.superior_codigo).filter(Boolean));
    for (const c of contas) c.tipo = superiores.has(c.codigo) ? "sintetica" : "analitica";
  }
  return { contas, saldos: [], saldosEm: null, empresa: { nome: null, cnpj: null }, avisos };
}

/** Lançamento de abertura: saldos das contas patrimoniais analíticas; tem de fechar (débito = crédito). */
export function partidasDeAbertura(contas: readonly { id: string; codigo: string; natureza: Natureza; tipo: string }[], saldos: readonly Saldo[]) {
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));
  const faltam: string[] = [];
  const partidas: { conta_id: string; lado: Lado; valor: number }[] = [];
  for (const s of saldos) {
    const c = porCodigo.get(s.codigo);
    if (!c) { faltam.push(s.codigo); continue; }
    if (c.tipo !== "analitica" || !["ativo", "passivo", "pl"].includes(c.natureza)) continue;
    partidas.push({ conta_id: c.id, lado: s.lado, valor: s.valor });
  }
  const soma = (l: Lado) => partidas.filter((p) => p.lado === l).reduce((t, p) => t + Math.round(p.valor * 100), 0);
  return { partidas, faltam, fecha: soma("D") === soma("C"), debitos: soma("D") / 100, creditos: soma("C") / 100 };
}
