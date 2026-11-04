/**
 * Responsáveis da Portaria (04/11/2026): quem o RH marcou como "Responsável pelo setor", no formato "Nome · Setor". É a
 * lista do Responsável da visita e do Destinatário dos recebidos. Enquanto ninguém estiver marcado, vale a lista antiga
 * (reserva), para a Portaria não travar. Puro.
 */

export type Responsavel = { nome: string; setor: string };

export const rotuloDoResponsavel = (r: Responsavel) => `${r.nome.trim()} · ${r.setor.trim()}`;

/** Os marcados; sem nenhum, a reserva. */
export function listaDeResponsaveis(marcados: readonly string[], reserva: readonly string[]): string[] {
  return marcados.length ? [...marcados] : [...reserva];
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
