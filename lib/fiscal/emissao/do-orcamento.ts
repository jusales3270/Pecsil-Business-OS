/**
 * Nota que nasce do orçamento (docs/PLANO-ORCAMENTO.md, E4) — o "assistente de faturamento" do
 * GRV: destinatário pelo cadastro do cliente, itens pelo produto (código, NCM, unidade, origem),
 * preço do orçamento, pedido de compra e nº do item do cliente em cada item, e o CFOP de venda de
 * produção pela UF. Com a máscara de impostos do orçamento completa, o item já sai com CFOP, CSTs e
 * alíquotas dela (os mesmos números que o orçamento mostrou); incompleta, só o CFOP vem dela.
 * O Jefferson confere e ajusta antes de validar. Puro e testável.
 */
import { impostosDoItem, situacaoDaMascara, type Mascara } from "../mascaras";
import { itemPadrao, notaVazia } from "./normalizar";
import type { Destinatario, NotaNfe } from "./tipos";

export type ClienteFiscal = {
  name: string; tax_id: string | null; ie: string | null; ind_ie: number | null; email_nfe: string | null; cep: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null;
  codigo_municipio: string | null; uf: string | null; telefone: string | null;
};
export type ProdutoFiscal = { codigo: string; ncm: string | null; unidade: string; origem: number };
export type LinhaAFaturar = {
  item_id: string; numero: number; pedido_cliente: string | null; descricao: string; preco_unitario: number; item_pedido: string | null;
};

export function destinatarioDoCliente(c: ClienteFiscal): Destinatario {
  const ind = c.ind_ie === 2 || c.ind_ie === 9 ? c.ind_ie : 1;
  return {
    ...notaVazia().destinatario,
    documento: (c.tax_id ?? "").replace(/\D/g, ""), nome: c.name.slice(0, 60), indIE: ind, ie: c.ie ?? "", email: c.email_nfe ?? "",
    cep: c.cep ?? "", logradouro: c.logradouro ?? "", numero: c.numero ?? "", complemento: c.complemento ?? "", bairro: c.bairro ?? "",
    municipio: c.municipio ?? "", codigoMunicipio: c.codigo_municipio ?? "", uf: c.uf ?? "", fone: c.telefone ?? "",
  };
}

export function notaDoOrcamento(a: {
  cliente: ClienteFiscal;
  linhas: { linha: LinhaAFaturar; quantidade: number; produto: ProdutoFiscal; mascara?: Mascara | null; ipiAliquota?: number | null }[];
  ufEmitente: string;
  crt: number;
}): NotaNfe {
  const destinatario = destinatarioDoCliente(a.cliente);
  const fora = Boolean(destinatario.uf && a.ufEmitente && destinatario.uf !== a.ufEmitente);
  const cfopPadrao = fora ? "6101" : "5101";
  const mascaras = [...new Map(a.linhas.filter((l) => l.mascara).map((l) => [l.mascara!.id, l.mascara!])).values()];
  const naturezas = [...new Set(mascaras.map((m) => m.natureza).filter(Boolean))];
  const obsLegais = [...new Set(mascaras.map((m) => m.obs_nota).filter(Boolean))] as string[];
  const orcamentos = [...new Set(a.linhas.map((l) => l.linha.numero))];
  const pedidos = [...new Set(a.linhas.map((l) => l.linha.pedido_cliente).filter(Boolean))];
  return {
    ...notaVazia(),
    natureza: naturezas.length === 1 ? String(naturezas[0]) : "VENDA DE PRODUCAO DO ESTABELECIMENTO",
    destinatario,
    consumidorFinal: destinatario.indIE === 9,
    itens: a.linhas.map(({ linha, quantidade, produto, mascara, ipiAliquota }) => ({
      ...itemPadrao(mascara?.cfop ?? cfopPadrao, a.crt),
      ...(mascara && situacaoDaMascara(mascara) !== "incompleta" ? impostosDoItem(mascara, ipiAliquota ?? null) : mascara ? { mascara: mascara.codigo } : {}),
      codigo: produto.codigo, descricao: linha.descricao, ncm: produto.ncm ?? "", unidade: produto.unidade || "PC",
      quantidade, valorUnitario: Number(linha.preco_unitario), origem: produto.origem ?? 0,
      itemOrcamento: linha.item_id,
      ...(linha.pedido_cliente ? { pedidoCompra: linha.pedido_cliente } : {}),
      ...(linha.item_pedido ? { itemPedido: linha.item_pedido } : {}),
    })),
    infoComplementar: [
      `Orçamento ${orcamentos.map((n) => `#${n}`).join(", ")}`,
      pedidos.length ? `Pedido de compra ${pedidos.join(", ")}` : "",
      ...obsLegais,
    ].filter(Boolean).join(" · "),
  };
}
