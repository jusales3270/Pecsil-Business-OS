/**
 * Contrato de experiência no cadastro do RH (proprietário, 28/10/2026). Quem entra em experiência ainda não
 * é efetivo da empresa: o período é de 60 ou 90 dias, contado do início (o primeiro dia conta). Dois dias
 * antes do fim, quem decide no RH recebe o aviso no sino e no Bom dia (sino e WhatsApp). Regras puras (sem
 * banco), testadas em tests/rh-experiencia.test.mjs; o banco calcula o mesmo fim (employees.experiencia_fim).
 */

export const PERIODOS_EXPERIENCIA = [60, 90] as const;
export type PeriodoExperiencia = (typeof PERIODOS_EXPERIENCIA)[number];
/** Quantos dias antes do fim o aviso sai. */
export const AVISO_EXPERIENCIA_DIAS = 2;

const meioDia = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const somar = (iso: string, n: number) => new Date(meioDia(iso) + n * 86_400_000).toISOString().slice(0, 10);
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export const periodoValido = (n: unknown): n is PeriodoExperiencia => PERIODOS_EXPERIENCIA.includes(Number(n) as PeriodoExperiencia);

/** Último dia do período: início + dias − 1 (60 dias a partir de 01/10 terminam em 29/11). */
export function fimDaExperiencia(inicio: string, periodo: number): string {
  return somar(inicio, periodo - 1);
}

/** Dias do dia de hoje até o fim (0 = termina hoje; negativo = já terminou). */
export function diasParaOFim(hoje: string, fim: string): number {
  return Math.round((meioDia(fim) - meioDia(hoje)) / 86_400_000);
}

/** Avisa do dia D−2 até o próprio fim (se o D−2 cair num dia sem Bom dia, o aviso ainda sai no dia seguinte). */
export const avisarExperiencia = (hoje: string, fim: string) => {
  const n = diasParaOFim(hoje, fim);
  return n >= 0 && n <= AVISO_EXPERIENCIA_DIAS;
};

/** "Jorge Jesus, em experiência, está a 2 dias do vencimento do seu período de 60 dias (vence em 29/11)." */
export function fraseDoAviso(a: { nome: string; periodo: number; fim: string; hoje: string }): string {
  const n = diasParaOFim(a.hoje, a.fim);
  if (n <= 0) return `${a.nome}, em experiência, tem o seu período de ${a.periodo} dias vencendo hoje (${dataBR(a.fim)}).`;
  return `${a.nome}, em experiência, está a ${n} ${n === 1 ? "dia" : "dias"} do vencimento do seu período de ${a.periodo} dias (vence em ${dataBR(a.fim)}).`;
}
