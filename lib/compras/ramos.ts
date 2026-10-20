/**
 * Ramos de um pedido de material (pedido do proprietário, 20/10/2026): cada item do pedido pode ser
 * cotado com um fornecedor diferente. A situação de cada item segue a MESMA regra do banco
 * (`compras_estado_itens`, migração 202610200004): o banco decide a situação do pedido; esta cópia só
 * desenha a tela sem ir ao servidor a cada clique.
 */

export type EstadoItem = "aberto" | "em_cotacao" | "aprovado" | "comprado" | "rejeitado";

export type ProdutoDoPedido = { produto: string; status?: string | null; pedidoItemId?: string | null };
export type CotacaoDoPedido = { id: number; status: string; deletedAt?: string | null; produtos?: ProdutoDoPedido[] | null };
export type CompraDoPedido = { cotacaoId: number; produto: string };
export type RamoDoPedido = { id: string; situacao: "aguardando" | "cotado" | "cancelado"; cotacaoId: number | null; itens: string[] };

export const ROTULO_ESTADO: Record<EstadoItem, string> = {
  aberto: "Sem cotação",
  em_cotacao: "Em cotação",
  aprovado: "Aprovado",
  comprado: "Comprado",
  rejeitado: "Rejeitado",
};

/** Situação de cada item do pedido, pelas cotações (itens ligados), pelas compras e pelos ramos. */
export function estadoDosItens(itemIds: string[], cotacoes: CotacaoDoPedido[], compras: CompraDoPedido[], ramos: RamoDoPedido[]): Record<string, EstadoItem> {
  const vivas = cotacoes.filter((c) => !c.deletedAt);
  const comprouProduto = (c: CotacaoDoPedido, produto: string) => compras.some((k) => k.cotacaoId === c.id && k.produto === produto);
  const ligados = (item: string) => vivas.flatMap((c) => (c.produtos ?? []).filter((p) => p.pedidoItemId === item).map((p) => ({ c, p })));
  const temProduto = (cotacaoId: number | null) => vivas.some((c) => c.id === cotacaoId && (c.produtos ?? []).length > 0);
  const resultado: Record<string, EstadoItem> = {};
  for (const item of itemIds) {
    const l = ligados(item);
    const status = (p: ProdutoDoPedido) => p.status || "PENDENTE";
    if (l.some(({ c, p }) => status(p) === "APROVADO" && (c.status === "COMPRADO" || comprouProduto(c, p.produto)))) resultado[item] = "comprado";
    else if (l.some(({ c, p }) => status(p) === "APROVADO" && (c.status === "APROVADO" || c.status === "PENDENTE"))) resultado[item] = "aprovado";
    else if (l.some(({ c, p }) => status(p) === "PENDENTE" && c.status !== "REJEITADO")
      || ramos.some((r) => r.itens.includes(item) && (r.situacao === "aguardando" || (r.situacao === "cotado" && !temProduto(r.cotacaoId))))) resultado[item] = "em_cotacao";
    else if (l.length) resultado[item] = "rejeitado";
    else resultado[item] = "aberto";
  }
  return resultado;
}

/** Itens que ainda podem ir para um fornecedor (cotar ou comprar): tudo o que não foi comprado. */
export const podeEncaminhar = (estado: EstadoItem | undefined) => estado !== "comprado";

/** Número com vírgula (pt-BR) → número; vazio ou inválido → NaN. */
export function numeroBr(texto: string): number {
  const t = String(texto ?? "").trim().replace(/\s/g, "");
  if (!t) return Number.NaN;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}
