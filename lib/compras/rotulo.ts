/**
 * Nome de uma compra pela fase. Enquanto espera a aprovação (ou depois de
 * rejeitada) ela é "Cotação nº N"; aprovada, vira "OC nº N". O número é o
 * mesmo do começo ao fim: quem procurar "283" acha a mesma compra.
 * A compra direta nasce aprovada, então já é OC.
 */
export type CompraRotulavel = {
  id: number;
  status?: string | null;
  origem?: string | null;
  produtos?: { status?: string | null }[] | null;
};

export function ehOrdemDeCompra(c: CompraRotulavel): boolean {
  if (c.origem === "direta") return true;
  if (c.status === "APROVADO" || c.status === "COMPRADO") return true;
  if (c.status === "REJEITADO") return false;
  return (c.produtos ?? []).some((p) => p.status === "APROVADO");
}

/** "Cotação nº 283", "OC nº 283" ou "OC nº 283 · compra direta" (`curto` tira o complemento). */
export function rotuloCompra(c: CompraRotulavel, opcoes: { curto?: boolean } = {}): string {
  if (!ehOrdemDeCompra(c)) return `Cotação nº ${c.id}`;
  return c.origem === "direta" && !opcoes.curto ? `OC nº ${c.id} · compra direta` : `OC nº ${c.id}`;
}

/** Para o que só existe depois da compra (compra registrada, material a caminho, recebimento). */
export const rotuloOC = (id: number | string) => `OC nº ${id}`;
