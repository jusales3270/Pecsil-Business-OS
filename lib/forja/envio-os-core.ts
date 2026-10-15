/**
 * Núcleo puro do envio do orçamento ganho à Forja (sem rede, testável): monta o rascunho de OS a
 * partir do item do orçamento e decide quando tentar de novo.
 */

export type EnvioFila = {
  id: string;
  organization_id: string;
  ref: string;
  status: "pendente" | "enviado" | "erro" | "cancelar" | "cancelado";
  tentativas: number;
  forja_os_id: string | null;
  quote_item_id: string | null;
  quote: {
    numero: number; situacao: string; treino: boolean; pedido_cliente: string | null; prazo_entrega: string | null;
    observacoes: string | null; customer_id: string | null; cliente: { name: string } | null;
  } | null;
  item: {
    ordem: number | null; descricao: string; desenho: string | null; quantidade: number | string; preco_unitario: number | string;
    prazo_entrega: string | null; item_pedido: string | null; observacao: string | null;
    produto: { codigo: string; descricao: string; tipo_peca: string | null; material: string | null; forja_artigo_id: string | null } | null;
  } | null;
};

export type RascunhoOS = {
  refExterna: string;
  /** Orçamento de treino: a Forja guarda como TREINO e não deixa liberar. */
  treino: boolean;
  codigoProvisorio: string;
  cliente: { forjaId: string | null; nome: string };
  artigo: { forjaId: string | null; codigo: string; descricao: string; tipoProduto: string | null; material: string | null };
  quantidadeTotal: number;
  prazoEntrega: string | null;
  precoUnitario: number | null;
  valorTotal: number | null;
  poCliente: string | null;
  pedidoClienteItem: string | null;
  desenhoInformado: string | null;
  observacoes: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limpo = (v: string | null | undefined, max: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;

/** Prazo do item (ou do orçamento) às 17h de Brasília; sem prazo, a Forja usa 30 dias. */
export function prazoParaForja(data: string | null | undefined): string | null {
  return data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? `${data}T17:00:00-03:00` : null;
}

export function montarRascunhoOS(e: EnvioFila, clienteForjaId: string | null): { payload: RascunhoOS } | { erro: string } {
  const q = e.quote;
  const i = e.item;
  if (!q) return { erro: "O orçamento deste item não existe mais." };
  if (!i) return { erro: "O item do orçamento foi apagado: reabra e ganhe de novo para enviar." };
  if (!i.produto) return { erro: "O item está sem produto." };
  const quantidade = Number(i.quantidade);
  if (!Number.isInteger(quantidade) || quantidade < 1) return { erro: `A Forja só aceita quantidade inteira de peças (o item tem ${String(i.quantidade).replace(".", ",")}).` };
  if (!q.cliente?.name) return { erro: "O orçamento está sem cliente." };
  const preco = Number(i.preco_unitario);
  const pedido = limpo(q.pedido_cliente, 100);
  return {
    payload: {
      refExterna: e.ref,
      treino: q.treino,
      codigoProvisorio: q.treino ? `TREINO-T-${q.numero}/${i.ordem ?? 1}` : `ORC-${q.numero}/${i.ordem ?? 1}`,
      cliente: { forjaId: clienteForjaId && UUID.test(clienteForjaId) ? clienteForjaId : null, nome: q.cliente.name.slice(0, 200) },
      artigo: {
        forjaId: i.produto.forja_artigo_id && UUID.test(i.produto.forja_artigo_id) ? i.produto.forja_artigo_id : null,
        codigo: i.produto.codigo, descricao: (limpo(i.descricao, 500) ?? i.produto.descricao).slice(0, 500),
        tipoProduto: i.produto.tipo_peca, material: limpo(i.produto.material, 200),
      },
      quantidadeTotal: quantidade,
      prazoEntrega: prazoParaForja(i.prazo_entrega ?? q.prazo_entrega),
      precoUnitario: Number.isFinite(preco) ? preco : null,
      valorTotal: Number.isFinite(preco) ? Math.round(preco * quantidade * 100) / 100 : null,
      poCliente: pedido,
      pedidoClienteItem: pedido ? `Pedido ${pedido}${i.item_pedido ? ` · item ${i.item_pedido}` : ""}` : null,
      desenhoInformado: limpo(i.desenho, 200),
      observacoes: limpo([q.treino ? `TREINO (não vai para produção) · orçamento de treino T-${q.numero} · item ${i.ordem ?? 1}` : `Orçamento nº ${q.numero} · item ${i.ordem ?? 1}`, q.observacoes, i.observacao].filter(Boolean).join(" · "), 2000),
    },
  };
}

/**
 * Quando tentar de novo. Falha da rede/Forja: 5 min, dobrando até 6 h. Recusa de dado (4xx, item
 * fracionado…): de hora em hora, até alguém corrigir e usar "Tentar de novo".
 */
export function proximaTentativa(tentativas: number, permanente: boolean, agora = new Date()): Date {
  const minutos = permanente ? 60 : Math.min(5 * 2 ** Math.max(0, tentativas - 1), 360);
  return new Date(agora.getTime() + minutos * 60_000);
}

export const SITUACAO_OS_FORJA: Record<string, string> = {
  rascunho: "rascunho na Forja (aguarda o PCP)",
  aberta: "aberta (liberada para produção)",
  em_producao: "em produção",
  finalizada: "finalizada",
  atrasada: "atrasada",
  cancelada: "cancelada",
};
