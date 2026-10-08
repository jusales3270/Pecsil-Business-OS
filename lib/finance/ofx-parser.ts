/**
 * Leitor de extrato bancário em OFX (SGML da versão 1.0.2, como o Itaú exporta).
 *
 * Devolve só o que a conciliação precisa: a conta, os lançamentos e os saldos
 * diários. Tudo em centavos inteiros, para a soma não derivar por ponto
 * flutuante. As linhas "SALDO ANTERIOR" e "SALDO TOTAL DISPONÍVEL DIA" que o
 * banco mistura aos lançamentos NÃO são lançamentos: viram saldo e servem de
 * conferência (`conferirSaldos`). É texto puro; o arquivo nunca sai do servidor.
 *
 * O cabeçalho do Itaú diz CHARSET 1252, mas o arquivo vem em UTF-8: use
 * `textoOfx(buffer)`, que tenta UTF-8 e só cai para Windows-1252 se não for.
 */

/** Texto do arquivo OFX: UTF-8 quando válido; senão Windows-1252/latin1. */
export function textoOfx(dados: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(dados);
  } catch {
    return new TextDecoder("latin1").decode(dados);
  }
}

export type LancamentoOfx = {
  /** AAAA-MM-DD */
  data: string;
  /** Centavos, negativo para saída. */
  centavos: number;
  fitid: string;
  memo: string;
  tipo: string;
  /** Número do documento, quando o banco informa (planilha do Santander). */
  documento?: string;
};

export type SaldoDia = { data: string; centavos: number };

export type ExtratoOfx = {
  banco: string;
  /** BRANCHID do OFX (alguns bancos informam a agência separada da conta). */
  agenciaOfx?: string;
  conta: string;
  tipoConta: string;
  moeda: string;
  inicio: string | null;
  fim: string | null;
  saldoAnterior: { data: string; centavos: number } | null;
  lancamentos: LancamentoOfx[];
  saldosDiarios: SaldoDia[];
  /** Saldo final informado no cabeçalho (LEDGERBAL), se houver. */
  saldoFinal: number | null;
};

export class OfxInvalido extends Error {}

const SALDO_ANTERIOR = /^SALDO ANTERIOR$/i;
const SALDO_DO_DIA = /^SALDO (TOTAL DISPON|EM CONTA)/i;

const campo = (bloco: string, tag: string) => {
  const achou = bloco.match(new RegExp(`<${tag}>([^\\r\\n<]*)`));
  return achou ? achou[1].trim() : "";
};

const dataOfx = (valor: string) => {
  const d = valor.slice(0, 8);
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
};

/** "-2095.00" → -209500, sem passar por float. */
export function centavosDe(texto: string): number {
  const limpo = texto.trim().replace(",", ".");
  const achou = limpo.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!achou) throw new OfxInvalido(`Valor inválido no OFX: "${texto}"`);
  const centavos = Number(achou[2]) * 100 + Number((achou[3] ?? "0").padEnd(2, "0"));
  return achou[1] ? -centavos : centavos;
}

export function lerOfx(texto: string): ExtratoOfx {
  if (!/<OFX>/i.test(texto) || !/<STMTTRN>/i.test(texto)) throw new OfxInvalido("O arquivo não parece um extrato OFX.");

  const lancamentos: LancamentoOfx[] = [];
  const saldosDiarios: SaldoDia[] = [];
  let saldoAnterior: ExtratoOfx["saldoAnterior"] = null;

  for (const m of texto.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const bloco = m[1];
    const data = dataOfx(campo(bloco, "DTPOSTED"));
    const memo = campo(bloco, "MEMO");
    const valor = campo(bloco, "TRNAMT");
    if (!data || !valor) throw new OfxInvalido("Lançamento sem data ou valor no OFX.");
    const centavos = centavosDe(valor);

    if (SALDO_ANTERIOR.test(memo)) {
      saldoAnterior = { data, centavos };
    } else if (SALDO_DO_DIA.test(memo)) {
      saldosDiarios.push({ data, centavos });
    } else {
      lancamentos.push({ data, centavos, fitid: campo(bloco, "FITID"), memo, tipo: campo(bloco, "TRNTYPE") });
    }
  }

  const balanco = texto.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^\r\n<]*)/i);
  return {
    banco: campo(texto, "BANKID"),
    agenciaOfx: campo(texto, "BRANCHID") || undefined,
    conta: campo(texto, "ACCTID"),
    tipoConta: campo(texto, "ACCTTYPE"),
    moeda: campo(texto, "CURDEF") || "BRL",
    inicio: dataOfx(campo(texto, "DTSTART")) || null,
    fim: dataOfx(campo(texto, "DTEND")) || null,
    saldoAnterior,
    lancamentos,
    saldosDiarios,
    saldoFinal: balanco ? centavosDe(balanco[1]) : null,
  };
}

export type ConferenciaSaldos = {
  /** Dias com saldo informado pelo banco. */
  dias: number;
  /** Dias em que saldo anterior + lançamentos não chega ao saldo informado. */
  divergentes: { data: string; esperado: number; calculado: number }[];
  /** Saldo calculado depois do último lançamento (inclui os dias sem linha de saldo). */
  saldoCalculado: number;
};

/**
 * Anda dia a dia: saldo do dia anterior + lançamentos do dia tem de dar o saldo
 * informado pelo banco. É a trava da carga: se algum dia não fechar, o arquivo
 * foi lido errado ou veio incompleto.
 */
export function conferirSaldos(extrato: ExtratoOfx): ConferenciaSaldos {
  const porDia = new Map<string, number>();
  for (const l of extrato.lancamentos) porDia.set(l.data, (porDia.get(l.data) ?? 0) + l.centavos);

  let saldo = extrato.saldoAnterior?.centavos ?? 0;
  const divergentes: ConferenciaSaldos["divergentes"] = [];
  const datas = [...new Set([...porDia.keys(), ...extrato.saldosDiarios.map((s) => s.data)])].sort();
  const informado = new Map(extrato.saldosDiarios.map((s) => [s.data, s.centavos]));

  for (const data of datas) {
    saldo += porDia.get(data) ?? 0;
    const esperado = informado.get(data);
    if (esperado === undefined) continue;
    if (esperado !== saldo) divergentes.push({ data, esperado, calculado: saldo });
    saldo = esperado;
  }
  return { dias: extrato.saldosDiarios.length, divergentes, saldoCalculado: saldo };
}
