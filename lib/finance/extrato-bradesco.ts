/**
 * Extrato do Bradesco Net Empresa exportado em planilha (.xls ou .xlsx):
 *   "Extrato de: Agência: 328  Conta: 6864-0"
 *   Data | Lançamento | Dcto. | Crédito (R$) | Débito (R$) | Saldo (R$)
 * em ordem do mais antigo para o mais novo, com o saldo depois de cada linha e uma
 * linha "Total" no fim. Depois vêm blocos à parte ("Últimos Lançamentos", "Saldos
 * Invest Fácil"): o de últimos lançamentos só entra se continuar o saldo do extrato
 * principal; se não continuar, falta período no arquivo e isso vira aviso.
 */
import type { Celula } from "../arquivos/xlsx";
import type { LancamentoOfx, SaldoDia } from "./ofx-parser";
import type { ExtratoPlanilha } from "./extrato-planilha";
import { PlanilhaInvalida, centavosPlanilha } from "./extrato-planilha.ts";

const texto = (v: Celula | undefined) => (v === null || v === undefined ? "" : String(v)).trim();
const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const iso = (t: string) => t.replace(DATA, "$3-$2-$1");

export type ExtratoBradesco = ExtratoPlanilha & { avisos: string[] };

export function pareceExtratoBradesco(linhas: Celula[][]): boolean {
  const topo = linhas.slice(0, 15).flat().map(texto).join(" ");
  return /Bradesco/i.test(topo) && /Extrato de:\s*Ag[eê]ncia/i.test(topo);
}

type Linha = { data: string; memo: string; documento: string; centavos: number; saldo: number | null };

function bloco(linhas: Celula[][], inicio: number): { itens: Linha[]; anterior: { data: string; centavos: number } | null; fim: number } {
  const itens: Linha[] = [];
  let anterior: { data: string; centavos: number } | null = null;
  let i = inicio;
  for (; i < linhas.length; i++) {
    const l = linhas[i] ?? [];
    const c0 = texto(l[0]);
    if (/^total$/i.test(c0)) break;
    if (!DATA.test(c0)) continue;
    const memo = texto(l[1]).replace(/\s+/g, " ");
    const saldo = texto(l[5]) ? centavosPlanilha(l[5]) : null;
    if (/^SALDO ANTERIOR$/i.test(memo)) { if (saldo !== null) anterior = { data: iso(c0), centavos: saldo }; continue; }
    const credito = texto(l[3]) ? centavosPlanilha(l[3]) : 0;
    const debito = texto(l[4]) ? centavosPlanilha(l[4]) : 0;
    itens.push({ data: iso(c0), memo, documento: texto(l[2]), centavos: credito + (debito > 0 ? -debito : debito), saldo });
  }
  return { itens, anterior, fim: i };
}

export function lerExtratoBradesco(linhas: Celula[][]): ExtratoBradesco {
  if (!pareceExtratoBradesco(linhas)) throw new PlanilhaInvalida("Esta planilha não é um extrato do Bradesco Net Empresa.");
  const topo = linhas.slice(0, 15).flat().map(texto).join(" ");
  const m = topo.match(/Ag[eê]ncia:\s*(\d+)\s+Conta:\s*([\d.]+)-?(\w)?/i);
  if (!m) throw new PlanilhaInvalida("Agência ou conta não encontradas no topo da planilha do Bradesco.");
  const agencia = m[1].padStart(4, "0");
  const numeroConta = m[2].replace(/\D/g, "");
  const digito = m[3] ?? "";

  const cabecalhos = linhas.map((l, i) => (texto(l?.[0]) === "Data" && /Lan[cç]amento/i.test(texto(l?.[1])) ? i : -1)).filter((i) => i >= 0);
  if (!cabecalhos.length) throw new PlanilhaInvalida("Não achei o cabeçalho Data | Lançamento | Dcto. | Crédito | Débito | Saldo.");
  const principal = bloco(linhas, cabecalhos[0] + 1);
  if (!principal.itens.length) throw new PlanilhaInvalida("A planilha do Bradesco não tem lançamentos.");
  const avisos: string[] = [];
  let itens = principal.itens;

  // Bloco "Últimos Lançamentos": entra só se continuar o saldo do principal.
  const ultimoSaldo = [...itens].reverse().find((x) => x.saldo !== null)?.saldo ?? null;
  const extra = cabecalhos[1] !== undefined ? bloco(linhas, cabecalhos[1] + 1) : null;
  if (extra && extra.itens.length) {
    if (extra.anterior && ultimoSaldo !== null && extra.anterior.centavos === ultimoSaldo) itens = [...itens, ...extra.itens];
    else avisos.push(`O extrato principal termina em ${itens[itens.length - 1].data.split("-").reverse().join("/")}, e os "Últimos lançamentos" (${extra.itens.length}) começam em ${extra.itens[0].data.split("-").reverse().join("/")} com outro saldo: falta o período entre eles neste arquivo. Os últimos lançamentos não foram incluídos.`);
  }

  let divergentes = 0;
  let saldo = principal.anterior?.centavos ?? null;
  for (const x of itens) {
    if (saldo !== null) saldo += x.centavos;
    if (x.saldo !== null) { if (saldo !== null && saldo !== x.saldo) divergentes++; saldo = x.saldo; }
  }

  const lancamentos: LancamentoOfx[] = itens.map((x) => ({ data: x.data, centavos: x.centavos, fitid: "", memo: x.memo, tipo: x.centavos < 0 ? "DEBIT" : "CREDIT", documento: x.documento || undefined }));
  const fimDoDia = new Map<string, number>();
  for (const x of itens) if (x.saldo !== null) fimDoDia.set(x.data, x.saldo);
  const saldosDiarios: SaldoDia[] = [...fimDoDia].map(([data, centavos]) => ({ data, centavos }));

  return {
    banco: "0237",
    conta: `${agencia}${numeroConta}${digito}`,
    tipoConta: "CHECKING",
    moeda: "BRL",
    inicio: itens[0].data,
    fim: itens[itens.length - 1].data,
    saldoAnterior: principal.anterior,
    lancamentos,
    saldosDiarios,
    saldoFinal: saldosDiarios.at(-1)?.centavos ?? null,
    agencia,
    numeroConta,
    digito,
    saldoCorridoDivergente: divergentes,
    avisos,
  };
}
