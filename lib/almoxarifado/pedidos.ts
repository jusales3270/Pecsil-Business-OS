/**
 * Pedido de material (material_requests) no formato das telas. Usado pelo
 * Almoxarifado (vê todos) e pela Fundição (vê só os pedidos dela).
 */
export const COLUNAS_PEDIDO =
  "id, numero, divisao, origem, urgencia, observacao, status, requested_by_name, cancel_reason, created_at, updated_at, material_request_items(produto, quantidade, unidade, observacao, ordem)";

type ItemLinha = { produto: string; quantidade: number | string; unidade: string; observacao: string | null; ordem: number };
export type PedidoLinha = {
  id: string; numero: number | string; divisao: string; origem: string | null; urgencia: string; observacao: string | null; status: string;
  requested_by_name: string | null; cancel_reason: string | null; created_at: string; updated_at: string; material_request_items: ItemLinha[] | null;
};

export function pedidoParaTela(row: PedidoLinha) {
  return {
    id: row.id,
    numero: Number(row.numero),
    divisao: row.divisao,
    origem: (row.origem === "FUNDICAO" ? "FUNDICAO" : "ALMOXARIFADO") as "FUNDICAO" | "ALMOXARIFADO",
    urgencia: row.urgencia,
    observacao: row.observacao,
    status: row.status,
    solicitante: row.requested_by_name,
    motivoCancelamento: row.cancel_reason,
    criadoEm: row.created_at,
    atualizadoEm: row.updated_at,
    itens: [...(row.material_request_items ?? [])].sort((a, b) => a.ordem - b.ordem)
      .map((item) => ({ produto: item.produto, quantidade: Number(item.quantidade), unidade: item.unidade, observacao: item.observacao })),
  };
}

export type ItemPedidoEntrada = { produto?: string; quantidade?: number; unidade?: string; observacao?: string };

/** Itens que vieram da tela: só linhas com descrição, e toda linha precisa de quantidade. */
export function itensDoPedido(itens: ItemPedidoEntrada[] | undefined): { itens: { produto: string; quantidade: number; unidade: string; observacao: string }[] } | { erro: string } {
  const validos = (itens ?? []).filter((item) => item.produto?.trim());
  if (!validos.length) return { erro: "Informe ao menos um item." };
  if (validos.some((item) => !(Number(item.quantidade) > 0))) return { erro: "Toda linha precisa de quantidade." };
  return { itens: validos.map((item) => ({ produto: item.produto!.trim(), quantidade: Number(item.quantidade), unidade: item.unidade ?? "UN", observacao: item.observacao ?? "" })) };
}
