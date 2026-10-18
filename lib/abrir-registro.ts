/**
 * Pedido para abrir um registro exato dentro de uma tela (a SARA navega até o módulo e a tela pega o
 * pedido quando monta, ou na hora, se já estiver aberta). Fica na memória da página: um pedido por vez.
 */

export type PedidoRegistro = { tipo: "titulo"; id: string; direcao: "payable" | "receivable"; aba: "aberto" | "previsoes" | "quitados"; mes: string | null };

const EVENTO = "pecsil:abrir-registro";
let pendente: PedidoRegistro | null = null;

export function pedirRegistro(p: PedidoRegistro) {
  pendente = p;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENTO));
}

/** Entrega o pedido pendente a quem o atende (e o consome). */
export function tomarRegistro(atende: (p: PedidoRegistro) => boolean): PedidoRegistro | null {
  if (!pendente || !atende(pendente)) return null;
  const p = pendente;
  pendente = null;
  return p;
}

export function ouvirRegistro(fn: () => void): () => void {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}
