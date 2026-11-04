/**
 * Responsáveis da Portaria (04/11/2026): quem o RH marcou como "Responsável pelo setor" e todo diretor (Pessoas e
 * Acessos › Diretoria), no formato "Nome · Setor". É a lista do Responsável da visita e do Destinatário dos recebidos.
 * Enquanto o RH não marcar ninguém, a lista antiga vem junto dos diretores (reserva), para a Portaria não travar. Puro.
 */

export type Responsavel = { nome: string; setor: string; tipo?: string };

export const rotuloDoResponsavel = (r: Responsavel) => `${r.nome.trim()} · ${r.setor.trim()}`;

/** Só os diretores = o RH ainda não marcou ninguém. */
export const semMarcacaoDoRh = (itens: readonly Responsavel[]) => !itens.some((r) => r.tipo !== "diretor");

/** Os responsáveis do banco; sem marcação do RH, os diretores e a reserva. */
export function listaDeResponsaveis(itens: readonly Responsavel[], reserva: readonly string[]): string[] {
  const rotulos = itens.map(rotuloDoResponsavel);
  return semMarcacaoDoRh(itens) ? [...rotulos, ...reserva.filter((r) => !rotulos.includes(r))] : rotulos;
}

/** Ao editar uma visita antiga, o responsável gravado continua escolhível mesmo fora da lista. */
export function opcoesComAtual(lista: readonly string[], atual: string | null | undefined): string[] {
  const valor = (atual ?? "").trim();
  return valor && !lista.includes(valor) ? [valor, ...lista] : [...lista];
}

/** O filtro do histórico: a lista de hoje mais quem já aparece nas visitas carregadas. */
export function opcoesDoFiltro(lista: readonly string[], dasVisitas: readonly string[]): string[] {
  const extra = [...new Set(dasVisitas.map((v) => v.trim()).filter((v) => v && !lista.includes(v)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [...lista, ...extra];
}
