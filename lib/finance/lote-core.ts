import { emAberto, situacaoRecebivel, type Recebivel, type SituacaoRecebivel } from "./recebiveis-core.ts";

/**
 * Ações em lote em Contas a pagar e Contas a receber: quem confere marca vários títulos (ou todos do
 * filtro) e escolhe uma ação. Cada título passa pelas mesmas rotas e regras da ação feita um a um;
 * aqui fica só quem entra em cada ação. O que não entra é avisado, nunca alterado. Regras puras,
 * testadas em tests/finance-lote.test.mjs.
 */

export type AcaoLote = "baixar" | "aprovar" | "conta" | "vencimento" | "conferido" | "cancelar" | "excluir";

/** O que cada ação exige de quem opera: "aprovar" é quem dá baixa, aprova, cancela e exclui; "operar" é quem edita. */
export const PERMISSAO_LOTE: Record<AcaoLote, "aprovar" | "operar"> = {
  baixar: "aprovar", aprovar: "aprovar", cancelar: "aprovar", excluir: "aprovar",
  conta: "operar", vencimento: "operar", conferido: "operar",
};

export const ORDEM_LOTE: AcaoLote[] = ["baixar", "aprovar", "conta", "vencimento", "conferido", "cancelar", "excluir"];

export type TituloLote = Pick<Recebivel, "installments" | "originalAmount" | "status" | "issueDate"> & {
  id: string;
  paidAmount: number;
  reviewReason?: string | null;
};

const EM_ABERTO: SituacaoRecebivel[] = ["Em aberto", "Vencido", "Parcial", "Em aprovação"];

/** Por que o título fica fora da ação, ou null quando ele entra. */
export function motivoFora(acao: AcaoLote, t: TituloLote, hoje: string): string | null {
  const situacao = situacaoRecebivel(t, hoje);
  const aberto = EM_ABERTO.includes(situacao);
  switch (acao) {
    case "baixar":
      if (!aberto) return "não está em aberto";
      if (situacao === "Em aprovação") return "ainda em aprovação";
      return emAberto(t) > 0.004 ? null : "sem saldo em aberto";
    case "aprovar":
      return situacao === "Em aprovação" ? null : "não está em aprovação";
    case "cancelar":
      return aberto ? null : "não está em aberto";
    case "vencimento":
      if (t.installments.length !== 1) return t.installments.length ? "tem mais de uma parcela" : "não tem parcela";
      if (t.paidAmount > 0) return "já tem baixa";
      return null;
    case "conferido":
      return t.reviewReason ? null : "não tem aviso de revisar";
    case "conta":
    case "excluir":
      return null;
  }
}

export type Separacao<T> = { entram: T[]; fora: { titulo: T; motivo: string }[] };

/** Separa os selecionados entre os que entram na ação e os que ficam fora (com o motivo). */
export function separar<T extends TituloLote>(acao: AcaoLote, titulos: T[], hoje: string): Separacao<T> {
  const entram: T[] = [];
  const fora: { titulo: T; motivo: string }[] = [];
  for (const t of titulos) {
    const motivo = motivoFora(acao, t, hoje);
    if (motivo) fora.push({ titulo: t, motivo }); else entram.push(t);
  }
  return { entram, fora };
}

/** Os motivos agrupados, para o aviso ("3 ainda em aprovação · 1 sem saldo em aberto"). */
export function resumoFora(fora: { motivo: string }[]): string {
  const contagem = new Map<string, number>();
  for (const f of fora) contagem.set(f.motivo, (contagem.get(f.motivo) ?? 0) + 1);
  return [...contagem].map(([motivo, n]) => `${n} ${motivo}`).join(" · ");
}

/**
 * Roda a ação em cada título, poucos de cada vez, e devolve as falhas (com a mensagem da rota).
 * Uma falha não para as outras: o que gravou fica gravado.
 */
export async function executarLote<T extends { id: string }>(
  titulos: T[],
  acao: (t: T) => Promise<string | null>,
  aoAvancar: (feitos: number) => void,
  simultaneos = 4,
): Promise<{ titulo: T; erro: string }[]> {
  const falhas: { titulo: T; erro: string }[] = [];
  let proximo = 0;
  let feitos = 0;
  const trabalhador = async () => {
    while (proximo < titulos.length) {
      const t = titulos[proximo++];
      let erro: string | null;
      try { erro = await acao(t); } catch { erro = "Não foi possível concluir."; }
      if (erro) falhas.push({ titulo: t, erro });
      aoAvancar(++feitos);
    }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneos, titulos.length) }, trabalhador));
  return falhas;
}
