/**
 * Ordem dos menus dentro de cada módulo (pedido do proprietário, 15/10/2026): alfabética, sem
 * diferenciar acento nem maiúscula, para achar rápido. A visão geral do módulo (Painel/Dashboard)
 * fica sempre no topo, como ponto de entrada.
 */
const PRIMEIROS = new Set(["painel", "dashboard", "visao geral", "inicio"]);
const chave = (rotulo: string) => rotulo.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export function ordenarPorRotulo<T>(lista: readonly T[], rotulo: (item: T) => string): T[] {
  return [...lista].sort((a, b) => {
    const ra = rotulo(a), rb = rotulo(b);
    const pa = PRIMEIROS.has(chave(ra)) ? 0 : 1, pb = PRIMEIROS.has(chave(rb)) ? 0 : 1;
    return pa - pb || ra.localeCompare(rb, "pt-BR", { sensitivity: "base" });
  });
}

export const ordenarMenu = <T extends { label: string }>(lista: readonly T[]) => ordenarPorRotulo(lista, (i) => i.label);
