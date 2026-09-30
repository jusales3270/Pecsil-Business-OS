/**
 * Regras puras dos títulos a receber e a pagar (sem banco): situação do título pelo
 * vencimento, totais e agrupamento por cliente. Usadas pela tela, pelo painel e
 * pelo fluxo de caixa — o mesmo cálculo em todo lugar.
 *
 * Previsão (orçamento sem nota ou duplicata antecipada) nunca entra no total
 * "a receber": quem chama separa as duas listas antes (`isForecast`).
 */

export type RecebivelParcela = { dueDate: string; amount: number; settledAmount: number };

export type Recebivel = {
  id: string;
  counterparty: string;
  group: string | null;
  issueDate: string;
  originalAmount: number;
  status: string;
  isForecast: boolean;
  reviewReason: string | null;
  installments: readonly RecebivelParcela[];
};

/** "Recebido" vale para as duas direções: a tela de contas a pagar mostra como "Pago". */
export type SituacaoRecebivel = "Em aberto" | "Vencido" | "Parcial" | "Recebido" | "Cancelado" | "Em aprovação";

const vencimento = (titulo: Pick<Recebivel, "installments" | "issueDate">) => titulo.installments[0]?.dueDate ?? titulo.issueDate;

/** Quanto falta receber. Título sem parcela vale pelo valor cheio. */
export function emAberto(titulo: Pick<Recebivel, "installments" | "originalAmount" | "status">): number {
  if (titulo.status === "cancelled" || titulo.status === "settled") return 0;
  if (!titulo.installments.length) return titulo.originalAmount;
  return titulo.installments.reduce((acc, parcela) => acc + Math.max(0, parcela.amount - parcela.settledAmount), 0);
}

/**
 * A situação sai da data, não do que ficou gravado: um título "em aberto" que
 * venceu ontem é vencido hoje, sem ninguém editar.
 */
export function situacaoRecebivel(titulo: Pick<Recebivel, "installments" | "originalAmount" | "status" | "issueDate">, hoje: string): SituacaoRecebivel {
  if (titulo.status === "cancelled") return "Cancelado";
  if (titulo.status === "settled" || emAberto(titulo) <= 0) return "Recebido";
  // Conta a pagar nova espera aprovação antes de entrar na fila de pagamento.
  if (titulo.status === "pending_approval" || titulo.status === "draft") return "Em aprovação";
  if (vencimento(titulo) < hoje) return "Vencido";
  return titulo.installments.some((parcela) => parcela.settledAmount > 0) ? "Parcial" : "Em aberto";
}

export type ResumoRecebiveis = {
  aberto: number;
  vencido: number;
  aVencer: number;
  quantidade: number;
  quantidadeVencida: number;
  revisar: number;
  /** Vencimento futuro mais próximo (AAAA-MM-DD) ou nulo. */
  proximo: string | null;
};

export function resumoRecebiveis(titulos: readonly Recebivel[], hoje: string): ResumoRecebiveis {
  const resumo: ResumoRecebiveis = { aberto: 0, vencido: 0, aVencer: 0, quantidade: 0, quantidadeVencida: 0, revisar: 0, proximo: null };
  for (const titulo of titulos) {
    const valor = emAberto(titulo);
    if (valor <= 0) continue;
    const data = vencimento(titulo);
    resumo.aberto += valor;
    resumo.quantidade += 1;
    if (titulo.reviewReason) resumo.revisar += 1;
    if (data < hoje) {
      resumo.vencido += valor;
      resumo.quantidadeVencida += 1;
    } else {
      resumo.aVencer += valor;
      if (!resumo.proximo || data < resumo.proximo) resumo.proximo = data;
    }
  }
  return resumo;
}

export type GrupoRecebiveis<T extends Recebivel> = {
  nome: string;
  /** Razão social, quando o grupo inteiro é de um cliente só. */
  cliente: string | null;
  titulos: T[];
  aberto: number;
  vencido: number;
};

/** Agrupa pelo grupo do cliente (ou pelo cliente), maior valor em aberto primeiro; dentro, por vencimento. */
export function agruparRecebiveis<T extends Recebivel>(titulos: readonly T[], hoje: string): GrupoRecebiveis<T>[] {
  const mapa = new Map<string, GrupoRecebiveis<T>>();
  for (const titulo of titulos) {
    const nome = titulo.group ?? titulo.counterparty;
    const grupo = mapa.get(nome) ?? { nome, cliente: titulo.counterparty, titulos: [], aberto: 0, vencido: 0 };
    const valor = emAberto(titulo);
    grupo.titulos.push(titulo);
    grupo.aberto += valor;
    if (valor > 0 && vencimento(titulo) < hoje) grupo.vencido += valor;
    if (grupo.cliente !== titulo.counterparty) grupo.cliente = null;
    mapa.set(nome, grupo);
  }
  const grupos = [...mapa.values()];
  for (const grupo of grupos) grupo.titulos.sort((a, b) => vencimento(a).localeCompare(vencimento(b)) || b.originalAmount - a.originalAmount);
  return grupos.sort((a, b) => b.aberto - a.aberto || a.nome.localeCompare(b.nome, "pt-BR"));
}
