/**
 * Horas dos terceiros a partir dos apontamentos da Portaria (lógica pura).
 *
 * Regra combinada com o proprietário (27/09/2026): o RH NÃO interpreta nem
 * corrige os apontamentos. Cada passagem vale o que a Portaria registrou
 * (saída − entrada) e as horas da pessoa são a soma simples das passagens.
 *
 * A Portaria grava a hora como texto ISO com um "Z" que não é fuso de verdade
 * ("2026-08-24T08:37:00.000Z" significa 08:37 na fábrica). Por isso a hora é
 * lida do próprio texto, sem conversão de fuso.
 */

export type TerceiroApontamento = {
  id: string;
  nome: string;
  /** "AAAA-MM-DD" */
  data: string;
  entrada: string;
  saida: string | null;
};

export type LinhaRelatorio = {
  data: string;
  dia: string;
  entrada: string;
  saida: string | null;
  /** null quando ainda não há saída registrada. */
  minutos: number | null;
};

export type PessoaRelatorio = { nome: string; linhas: LinhaRelatorio[]; totalMinutos: number };

export type RelatorioTerceiros = {
  mes: string;
  inicio: string;
  fim: string;
  pessoas: PessoaRelatorio[];
  totalMinutos: number;
  semSaida: number;
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "…T08:37:00.000Z", "08:37" ou "08:37:00" → "08:37". */
export function horaDoApontamento(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const match = valor.match(/(?:T|^)(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

const emMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** Minutos da passagem. Saída antes da entrada = virou a meia-noite. */
export function minutosDaPassagem(entrada: string, saida: string | null): number | null {
  if (!saida) return null;
  const diferenca = emMinutos(saida) - emMinutos(entrada);
  return diferenca >= 0 ? diferenca : diferenca + 24 * 60;
}

/** 13222 → "220h22"; 29 → "0h29". */
export function formatarHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export function diaDaSemana(data: string): string {
  const [y, m, d] = data.split("-").map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function formatarData(data: string): string {
  const [y, m, d] = data.split("-");
  return `${d}/${m}/${y}`;
}

/** Primeiro e último dia do mês "AAAA-MM". */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export function montarRelatorio(mes: string, apontamentos: TerceiroApontamento[]): RelatorioTerceiros {
  const porPessoa = new Map<string, LinhaRelatorio[]>();
  let semSaida = 0;
  for (const a of apontamentos) {
    const entrada = horaDoApontamento(a.entrada);
    if (!entrada) continue;
    const saida = horaDoApontamento(a.saida);
    const minutos = minutosDaPassagem(entrada, saida);
    if (minutos === null) semSaida += 1;
    const nome = a.nome.trim();
    porPessoa.set(nome, [...(porPessoa.get(nome) ?? []), { data: a.data, dia: diaDaSemana(a.data), entrada, saida, minutos }]);
  }
  const pessoas = [...porPessoa.entries()]
    .map(([nome, linhas]) => {
      linhas.sort((x, y) => x.data.localeCompare(y.data) || x.entrada.localeCompare(y.entrada));
      return { nome, linhas, totalMinutos: linhas.reduce((soma, l) => soma + (l.minutos ?? 0), 0) };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const { inicio, fim } = limitesDoMes(mes);
  return { mes, inicio, fim, pessoas, totalMinutos: pessoas.reduce((s, p) => s + p.totalMinutos, 0), semSaida };
}

/** Quem está na fábrica agora: entrada no dia sem saída registrada. */
export function naFabrica(apontamentos: TerceiroApontamento[]): TerceiroApontamento[] {
  return apontamentos
    .filter((a) => !horaDoApontamento(a.saida) && horaDoApontamento(a.entrada))
    .sort((a, b) => (horaDoApontamento(a.entrada) ?? "").localeCompare(horaDoApontamento(b.entrada) ?? ""));
}
