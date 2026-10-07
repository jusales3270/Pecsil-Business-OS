/**
 * Extrato do Santander exportado em planilha (Excel), no formato do Internet Banking:
 *   linha 1: AGENCIA | 0065 | CONTA | 130073247
 *   linha 3: Data | Histórico | Documento | Valor (R$) | Saldo (R$)
 *   depois, um lançamento por linha, do MAIS NOVO para o mais antigo, com o saldo
 *   corrido depois de cada lançamento.
 *
 * Recebe as linhas já lidas da planilha (matriz de células) e devolve o mesmo
 * formato do leitor de OFX, para a carga e a conciliação serem as mesmas. O saldo
 * corrido vira a conferência: cada linha tem de dar o saldo da linha de cima.
 */
import type { ExtratoOfx, LancamentoOfx, SaldoDia } from "./ofx-parser";

export class PlanilhaInvalida extends Error {}

export type ExtratoPlanilha = ExtratoOfx & {
  agencia: string;
  numeroConta: string;
  digito: string;
  /** Linhas em que saldo anterior + valor não dá o saldo informado. */
  saldoCorridoDivergente: number;
};

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

/** Número da planilha (ou texto "1.234,56") em centavos inteiros. */
export function centavosPlanilha(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  const t = texto(v).replace(/[R$\s]/g, "");
  if (!t) throw new PlanilhaInvalida("Valor vazio na planilha.");
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  if (!Number.isFinite(n)) throw new PlanilhaInvalida(`Valor inválido na planilha: "${t}"`);
  return Math.round(n * 100);
}

const dataBr = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = texto(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

const diaAnterior = (data: string) => new Date(Date.parse(`${data}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function lerExtratoSantander(linhas: unknown[][]): ExtratoPlanilha {
  const cab = linhas.findIndex((l) => /^data$/i.test(texto(l[0])) && /hist/i.test(texto(l[1])) && /valor/i.test(texto(l[3])) && /saldo/i.test(texto(l[4])));
  if (cab < 0) throw new PlanilhaInvalida("Não achei o cabeçalho Data | Histórico | Documento | Valor | Saldo.");
  const topo = linhas.slice(0, cab).flat().map(texto);
  const agencia = topo[topo.findIndex((t) => /^ag[eê]ncia$/i.test(t)) + 1] ?? "";
  const conta = (topo[topo.findIndex((t) => /^conta$/i.test(t)) + 1] ?? "").replace(/\D/g, "");
  if (!agencia || !conta) throw new PlanilhaInvalida("Agência ou conta não encontradas no topo da planilha.");

  const brutas = linhas
    .slice(cab + 1)
    .filter((l) => dataBr(l[0]))
    .map((l) => ({ data: dataBr(l[0]), memo: texto(l[1]).replace(/\s+/g, " "), documento: texto(l[2]), centavos: centavosPlanilha(l[3]), saldo: centavosPlanilha(l[4]) }));
  if (!brutas.length) throw new PlanilhaInvalida("A planilha não tem lançamentos.");

  // Do mais antigo para o mais novo (a planilha vem ao contrário).
  const ordem = [...brutas].reverse();
  let divergentes = 0;
  for (let i = 1; i < ordem.length; i++) if (ordem[i - 1].saldo + ordem[i].centavos !== ordem[i].saldo) divergentes++;

  const lancamentos: LancamentoOfx[] = ordem.map((l) => ({
    data: l.data,
    centavos: l.centavos,
    fitid: "",
    memo: l.memo,
    tipo: l.centavos < 0 ? "DEBIT" : "CREDIT",
    documento: l.documento && !/^0+$/.test(l.documento) ? l.documento : undefined,
  }));
  // Saldo do fim de cada dia = saldo da última linha do dia.
  const fimDoDia = new Map<string, number>();
  for (const l of ordem) fimDoDia.set(l.data, l.saldo);
  const saldosDiarios: SaldoDia[] = [...fimDoDia].map(([data, centavos]) => ({ data, centavos }));
  const primeira = ordem[0];

  return {
    banco: "0033",
    conta: `${agencia}${conta}`,
    tipoConta: "CHECKING",
    moeda: "BRL",
    inicio: primeira.data,
    fim: ordem[ordem.length - 1].data,
    saldoAnterior: { data: diaAnterior(primeira.data), centavos: primeira.saldo - primeira.centavos },
    lancamentos,
    saldosDiarios,
    saldoFinal: ordem[ordem.length - 1].saldo,
    agencia,
    numeroConta: conta.slice(0, -1),
    digito: conta.slice(-1),
    saldoCorridoDivergente: divergentes,
  };
}
