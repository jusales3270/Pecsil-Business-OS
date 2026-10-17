/**
 * Fluxo de caixa dos próximos 90 dias (F-07). Só regra, sem banco, sem React e sem IA: a tela e os
 * testes usam a mesma conta. Parte do saldo dos bancos (pelo extrato, ou o que a pessoa digitar para
 * uma conta com extrato atrasado) e soma, dia a dia, as parcelas em aberto conforme o cenário.
 *
 * Em todos os cenários: o que venceu há mais de 90 dias fica fora (a tela avisa quanto é); o que está
 * a pagar e já venceu (até 90 dias) sai hoje; contas em aprovação entram como saída; previsão que já
 * passou da data fica fora (não virou conta: é previsão velha).
 */

export type Parcela = {
  id: string; direcao: "entra" | "sai"; vencimento: string; valor: number;
  previsao: boolean; emAprovacao: boolean; quem: string | null; descricao: string | null; documento: string | null;
};
export type Conta = { id: string; nome: string; agencia: string | null; conta: string | null; saldo: number; ultimo: string | null };
export type CenarioId = "otimista" | "base" | "conservador";
export type Regras = {
  /** Dias de atraso somados a cada recebimento que ainda vai vencer. */
  atrasoReceber: number;
  /** A receber já vencido (até 90 dias): entra hoje, entra daqui a 30 dias ou fica fora. */
  vencidoReceber: "hoje" | "em_30_dias" | "fora";
  previsoesEntrada: boolean;
  previsoesSaida: boolean;
};

export const CENARIOS: Record<CenarioId, { nome: string; regras: Regras }> = {
  otimista: { nome: "Otimista", regras: { atrasoReceber: 0, vencidoReceber: "hoje", previsoesEntrada: true, previsoesSaida: true } },
  base: { nome: "Pelo vencimento", regras: { atrasoReceber: 0, vencidoReceber: "em_30_dias", previsoesEntrada: false, previsoesSaida: false } },
  conservador: { nome: "Conservador", regras: { atrasoReceber: 15, vencidoReceber: "fora", previsoesEntrada: false, previsoesSaida: true } },
};
export const ORDEM_CENARIOS: CenarioId[] = ["conservador", "base", "otimista"];

export const DIAS = 90;
/** Extrato com mais de tantos dias: o saldo da conta pode não ser o de hoje. */
export const EXTRATO_ATRASADO_DIAS = 7;

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

/** Data ISO (AAAA-MM-DD) somada de n dias, sem fuso. */
export function maisDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/** Frases das regras, para a tela mostrar o porquê de cada número. */
export function explicar(r: Regras): string[] {
  return [
    r.atrasoReceber ? `A receber entra ${r.atrasoReceber} dias depois do vencimento.` : "A receber entra no dia do vencimento.",
    r.vencidoReceber === "hoje" ? "A receber já vencido (até 90 dias) entra hoje."
      : r.vencidoReceber === "em_30_dias" ? "A receber já vencido (até 90 dias) entra daqui a 30 dias."
      : "A receber já vencido fica fora.",
    "A pagar já vencido (até 90 dias) sai hoje; a pagar em aprovação conta como saída.",
    "Previsão que já passou da data fica fora: não virou conta.",
    r.previsoesEntrada && r.previsoesSaida ? "Previsões de entrada e de saída entram."
      : r.previsoesSaida ? "Previsões de saída entram; as de entrada ficam fora."
      : r.previsoesEntrada ? "Previsões de entrada entram; as de saída ficam fora."
      : "Previsões ficam fora: só o que já é conta.",
  ];
}

/** Dia (0 = hoje … 90) em que a parcela pesa no caixa pelo cenário, ou null se fica fora. */
export function diaDaParcela(p: Parcela, r: Regras, hoje: string): number | null {
  if (p.valor <= 0) return null;
  if (p.previsao && !(p.direcao === "entra" ? r.previsoesEntrada : r.previsoesSaida)) return null;
  const atraso = diasEntre(p.vencimento, hoje); // > 0: já venceu
  if (atraso > 90) return null;
  if (p.previsao && atraso > 0) return null;
  let dia: number;
  if (atraso > 0) {
    if (p.direcao === "sai") dia = 0;
    else if (r.vencidoReceber === "fora") return null;
    else dia = r.vencidoReceber === "hoje" ? 0 : 30;
  } else {
    dia = -atraso + (p.direcao === "entra" ? r.atrasoReceber : 0);
  }
  return dia <= DIAS ? dia : null;
}

export type Dia = { data: string; entra: number; sai: number; saldo: number };
export type Semana = { inicio: string; fim: string; entra: number; sai: number; saldoFinal: number; parcelas: Parcela[] };
export type Projecao = {
  saldoInicial: number; saldoFinal: number; entra: number; sai: number;
  menor: { valor: number; data: string }; primeiroNegativo: string | null;
  dias: Dia[]; semanas: Semana[];
};

/** Saldo de partida: o do extrato de cada conta, ou o digitado pela pessoa para ela. */
export function saldoDePartida(contas: Conta[], digitado: Record<string, number | undefined> = {}): number {
  return reais(contas.reduce((s, c) => s + centavos(digitado[c.id] ?? c.saldo), 0));
}

export function projetar(parcelas: Parcela[], r: Regras, hoje: string, saldoInicial: number): Projecao {
  const entra = new Array<number>(DIAS + 1).fill(0), sai = new Array<number>(DIAS + 1).fill(0);
  const porDia: Parcela[][] = Array.from({ length: DIAS + 1 }, () => []);
  for (const p of parcelas) {
    const d = diaDaParcela(p, r, hoje);
    if (d === null) continue;
    (p.direcao === "entra" ? entra : sai)[d] += centavos(p.valor);
    porDia[d].push(p);
  }
  let saldo = centavos(saldoInicial), menor = { c: Infinity, dia: 0 }, primeiroNegativo: number | null = null;
  const dias: Dia[] = [];
  for (let d = 0; d <= DIAS; d++) {
    saldo += entra[d] - sai[d];
    if (saldo < menor.c) menor = { c: saldo, dia: d };
    if (saldo < 0 && primeiroNegativo === null) primeiroNegativo = d;
    dias.push({ data: maisDias(hoje, d), entra: reais(entra[d]), sai: reais(sai[d]), saldo: reais(saldo) });
  }
  // 13 semanas: 0–6, 7–13, … 84–90.
  const semanas: Semana[] = [];
  for (let ini = 0; ini <= DIAS; ini += 7) {
    const fim = Math.min(ini + 6, DIAS);
    const faixa = dias.slice(ini, fim + 1);
    semanas.push({
      inicio: faixa[0].data, fim: faixa.at(-1)!.data,
      entra: reais(faixa.reduce((s, x) => s + centavos(x.entra), 0)), sai: reais(faixa.reduce((s, x) => s + centavos(x.sai), 0)),
      saldoFinal: faixa.at(-1)!.saldo,
      parcelas: porDia.slice(ini, fim + 1).flat().sort((a, b) => b.valor - a.valor),
    });
  }
  return {
    saldoInicial, saldoFinal: reais(saldo),
    entra: reais(entra.reduce((s, x) => s + x, 0)), sai: reais(sai.reduce((s, x) => s + x, 0)),
    menor: { valor: reais(menor.c), data: maisDias(hoje, menor.dia) },
    primeiroNegativo: primeiroNegativo === null ? null : maisDias(hoje, primeiroNegativo),
    dias, semanas,
  };
}

/** Contas com extrato atrasado (o saldo pode não ser o de hoje). */
export function contasAtrasadas(contas: Conta[], hoje: string): Conta[] {
  return contas.filter((c) => !c.ultimo || diasEntre(c.ultimo, hoje) > EXTRATO_ATRASADO_DIAS);
}

/** A pagar vencido (até 90 dias, sem previsão): pode ser conta já paga sem a baixa. */
export function vencidoAPagar(parcelas: Parcela[], hoje: string): { valor: number; n: number } {
  const v = parcelas.filter((p) => p.direcao === "sai" && !p.previsao && diasEntre(p.vencimento, hoje) > 0 && diasEntre(p.vencimento, hoje) <= 90);
  return { valor: reais(v.reduce((s, p) => s + centavos(p.valor), 0)), n: v.length };
}
