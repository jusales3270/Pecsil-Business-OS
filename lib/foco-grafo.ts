import type { FocoGrafo } from "./cerebro/visual";

/**
 * Pedido para focar o Segundo Cérebro (a SARA central navega até lá e a tela pega o pedido quando monta, ou na hora,
 * se já estiver aberta). Mesmo jeito de lib/abrir-registro.ts: fica na memória da página, um pedido por vez.
 * Foco nulo volta ao cérebro inteiro.
 */

export type PedidoFoco = { foco: FocoGrafo | null };

const EVENTO = "pecsil:foco-grafo";
let pendente: PedidoFoco | null = null;

export function pedirFocoGrafo(foco: FocoGrafo | null) {
  pendente = { foco };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO));
}

/** Entrega o pedido pendente (e o consome). */
export function tomarFocoGrafo(): PedidoFoco | null {
  const p = pendente;
  pendente = null;
  return p;
}

export function ouvirFocoGrafo(fn: () => void): () => void {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
