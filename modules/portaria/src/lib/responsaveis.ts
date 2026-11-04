/**
 * Responsáveis da Portaria (04/11/2026): quem o RH marcou como "Responsável pelo setor" e todo diretor (Pessoas e
 * Acessos › Diretoria), no formato "Nome · Setor". É a lista do Responsável da visita, do filtro das visitas e do
 * Destinatário dos recebidos. A lista fixa antiga saiu (proprietário, 04/11/2026). Puro.
 */

export type Responsavel = { nome: string; setor: string; tipo?: string };

export const rotuloDoResponsavel = (r: Responsavel) => `${r.nome.trim()} · ${r.setor.trim()}`;

export const listaDeResponsaveis = (itens: readonly Responsavel[]): string[] => itens.map(rotuloDoResponsavel);

/** Ao editar uma visita antiga, o responsável gravado continua no campo (sem ele, a edição apagaria o valor). */
export function opcoesComAtual(lista: readonly string[], atual: string | null | undefined): string[] {
  const valor = (atual ?? "").trim();
  return valor && !lista.includes(valor) ? [valor, ...lista] : [...lista];
}
