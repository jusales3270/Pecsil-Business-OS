/**
 * Funções puras das ações da SARA que os agentes dos módulos usam (lib/sara/agentes/*). Ficam fora de acoes.ts
 * porque os agentes entram no pacote do navegador (pelo catálogo das SARAs): acoes.ts é só do servidor e puxa
 * código que lê o banco com a chave do servidor (lib/tarefas/sara.ts). Quem importa acoes.ts no lado do
 * navegador quebra a página; tests/sara-acoes.test.mjs confere.
 */

/**
 * Degrau 3: pedido rejeitado pelo Compras → o aviso traz "Refazer o pedido", com os mesmos itens (o
 * material do catálogo vai ligado). A pessoa ainda decide no cartão; o Compras recebe um pedido novo.
 */
export function refazerPedido(p: { numero: number; urgencia: string; divisao?: string; cancel_reason?: string | null;
  material_request_items?: { produto: string; quantidade: number; unidade: string | null; material_id?: string | null; observacao?: string | null }[] }, ferramenta: "pedir_material" | "pedir_material_fundicao") {
  const itens = (p.material_request_items ?? []).map((i) => ({ descricao: i.produto, quantidade: Number(i.quantidade), unidade: i.unidade ?? "UN",
    ...(i.material_id ? { material_id: i.material_id } : {}), ...(i.observacao ? { observacao: i.observacao } : {}) }));
  if (!itens.length) return undefined;
  return { ferramenta, rotulo: "Refazer o pedido", entrada: {
    itens, urgente: p.urgencia === "urgente", ...(ferramenta === "pedir_material" ? { divisao: p.divisao === "FUNDICAO" ? "FUNDICAO" : "USINAGEM" } : {}),
    observacao: `Refaz o pedido nº ${p.numero}, rejeitado pelo Compras${p.cancel_reason ? ` (${p.cancel_reason})` : ""}.`.slice(0, 300),
  } };
}

/** Números dos pedidos que já foram refeitos (a observação do pedido novo começa com "Refaz o pedido nº X"). */
export function jaRefeitos(pedidos: { observacao?: string | null }[]): Set<number> {
  return new Set(pedidos.map((p) => /^Refaz o pedido nº (\d+)/.exec(p.observacao ?? "")?.[1]).filter(Boolean).map(Number));
}
