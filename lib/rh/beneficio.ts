// Regras dos benefícios do RH usadas pela tela e pelo servidor (sem banco).

/** Maior valor que cabe em numeric(18,2). */
export const VALOR_MAXIMO = 9_999_999_999_999_999.99;

/**
 * Lê um valor digitado em reais ("1.234,56", "R$ 85,90", "120", "120.5").
 * Vírgula é o separador decimal; ponto seguido de 3 dígitos é milhar.
 * Devolve null quando não é um valor válido (vazio, negativo, letras, grande demais).
 */
export function lerValorEmReais(texto: string): number | null {
  let t = texto.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const valor = Number(t);
  return Number.isFinite(valor) && valor <= VALOR_MAXIMO ? Math.round(valor * 100) / 100 : null;
}

/** Valor para o campo de digitação: 1234.5 → "1.234,50". */
export function valorParaDigitar(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

/** Custo médio por participante; null sem participantes (não divide por zero). */
export function mediaPorParticipante(custoMensal: number, participantes: number): number | null {
  return participantes > 0 ? custoMensal / participantes : null;
}

/**
 * Vigência sugerida para uma nova movimentação: o dia 1º do mês seguinte
 * (solicitações aprovadas entram na competência seguinte). `hoje` em AAAA-MM-DD.
 */
export function vigenciaSugerida(hoje: string): string {
  const [ano, mes] = hoje.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}


/** Uma adesão ativa: o colaborador participa do benefício, com o valor mensal, desde `inicio` (AAAA-MM-DD). */
export type AdesaoBeneficio = {
  planId: string;
  planName: string;
  employeeId: string;
  employeeName: string;
  department: string | null;
  inicio: string;
  valor: number | null;
};

/**
 * Custo mensal de um benefício no painel: a soma dos valores das adesões; sem nenhum valor nas adesões, o custo
 * digitado no catálogo (Editar valores).
 */
export function custoDoPlano(custoCatalogo: number, adesoes: { valor: number | null }[]): number {
  const comValor = adesoes.filter((a) => a.valor !== null);
  return comValor.length ? Math.round(comValor.reduce((s, a) => s + (a.valor ?? 0), 0) * 100) / 100 : custoCatalogo;
}

/**
 * O que a aprovação de uma solicitação faz nas adesões (o mesmo que o gatilho do banco,
 * rh_benefit_aplicar_solicitacao, para a tela mostrar na hora): adesão e alteração deixam o colaborador no benefício
 * com o valor da solicitação (alteração mantém o início); cancelamento tira; inclusão de dependente não mexe.
 */
export function aplicarAprovacao(
  adesoes: AdesaoBeneficio[],
  s: { acao: "enroll" | "change" | "cancel" | "add_dependent"; planId: string; planName: string; employeeId: string; employeeName: string; department: string | null; vigencia: string; valor: number | null },
): AdesaoBeneficio[] {
  const atual = adesoes.find((a) => a.planId === s.planId && a.employeeId === s.employeeId);
  const outras = adesoes.filter((a) => a !== atual);
  if (s.acao === "cancel") return outras;
  if (s.acao === "add_dependent") return adesoes;
  const inicio = s.acao === "change" && atual ? atual.inicio : s.vigencia;
  return [...outras, { planId: s.planId, planName: s.planName, employeeId: s.employeeId, employeeName: s.employeeName, department: s.department, inicio, valor: s.valor ?? atual?.valor ?? null }];
}
