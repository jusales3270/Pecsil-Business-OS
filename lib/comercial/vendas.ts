/**
 * Comercial › Vendas (docs/PLANO-ORCAMENTO.md, E1 e E2): o que vem da tela vira dado limpo, com a
 * mensagem certa para quem preenche. Puro e testável; o banco confere de novo (checks e RLS).
 */
import { lerNumeroBr } from "../numero-br";

export const TIPOS_PECA: Record<string, string> = {
  forma: "Forma", bloco: "Bloco", fundo_forma: "Fundo de forma", fundo_bloco: "Fundo de bloco", molde: "Molde",
  arruela: "Arruela", cabeca_sopro: "Cabeça de sopro", forminha: "Forminha", puncao: "Punção", funil: "Funil", outro: "Outro",
};

export const SITUACOES_ORCAMENTO: Record<string, string> = {
  rascunho: "Rascunho", enviado: "Enviado ao cliente", ganho: "Ganho", perdido: "Perdido", cancelado: "Cancelado",
};

export const MODALIDADES_FRETE: Record<number, string> = { 0: "Por conta da Pecsil (CIF)", 1: "Por conta do cliente (FOB)", 2: "Por conta de terceiros", 9: "Sem frete" };

const txt = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const opc = (v: unknown, max: number) => txt(v, max) || null;
const num = (v: unknown) => lerNumeroBr(v, NaN);
const data = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export type ProdutoEntrada = {
  codigo: string | null; descricao: string; group_id: string | null; customer_id: string | null; tipo_peca: string | null;
  unidade: string; ncm: string | null; origem: number; material: string | null; desenho_codigo: string | null; desenho_revisao: string | null;
  nome_cliente: string | null; peso_liquido: number | null; observacoes: string | null; ativo: boolean; cloned_from: string | null;
};

export function normalizarProduto(v: unknown): { produto: ProdutoEntrada; erros: string[] } {
  const b = (v ?? {}) as Record<string, unknown>;
  const erros: string[] = [];
  const codigo = opc(b.codigo, 30)?.toUpperCase() ?? null;
  if (codigo && !/^[0-9A-Z][0-9A-Z.\-/]{0,29}$/.test(codigo)) erros.push("Código interno: use letras, números, ponto, hífen ou barra.");
  const descricao = txt(b.descricao, 120).toUpperCase();
  if (!descricao) erros.push("Informe a descrição.");
  const ncm = String(b.ncm ?? "").replace(/\D/g, "");
  if (ncm && ncm.length !== 8) erros.push("O NCM tem 8 dígitos.");
  const unidade = txt(b.unidade, 6).toUpperCase() || "PC";
  if (!/^[A-Z0-9]{1,6}$/.test(unidade)) erros.push("Unidade: até 6 letras ou números (ex.: PC, CJ, KG).");
  const tipo = txt(b.tipo_peca, 20);
  const origem = Number(b.origem ?? 0);
  const peso = num(b.peso_liquido);
  if (!Number.isNaN(peso) && peso < 0) erros.push("Peso não pode ser negativo.");
  return {
    erros,
    produto: {
      codigo, descricao, group_id: uuid(b.group_id), customer_id: uuid(b.customer_id), tipo_peca: tipo in TIPOS_PECA ? tipo : null,
      unidade, ncm: ncm || null, origem: Number.isInteger(origem) && origem >= 0 && origem <= 8 ? origem : 0,
      material: opc(b.material, 60)?.toUpperCase() ?? null, desenho_codigo: opc(b.desenho_codigo, 60), desenho_revisao: opc(b.desenho_revisao, 20),
      nome_cliente: opc(b.nome_cliente, 120), peso_liquido: Number.isNaN(peso) ? null : peso, observacoes: opc(b.observacoes, 2000),
      ativo: b.ativo === undefined ? true : Boolean(b.ativo), cloned_from: uuid(b.cloned_from),
    },
  };
}

export type ItemOrcamentoEntrada = {
  id: string | null; product_id: string; descricao: string; desenho: string | null; unidade: string; quantidade: number; preco_unitario: number;
  prazo_entrega: string | null; item_pedido: string | null; observacao: string | null;
};
export type OrcamentoEntrada = {
  customer_id: string | null; contato: string | null; crm_card_id: string | null; data_orcamento: string | null; validade: string | null;
  pedido_cliente: string | null; condicao_pagamento: string | null; frete_modalidade: number; prazo_entrega: string | null; observacoes: string | null;
  /** Máscara de impostos (Fiscal): a nota nasce com ela. */
  mascara_id: string | null;
  /** Orçamento de treino (numeração T-, sem previsão, sem evento; apagado na entrada em produção). Só na criação. */
  treino: boolean;
  itens: ItemOrcamentoEntrada[];
};

export function normalizarOrcamento(v: unknown): { orcamento: OrcamentoEntrada; erros: string[] } {
  const b = (v ?? {}) as Record<string, unknown>;
  const erros: string[] = [];
  const customer = uuid(b.customer_id);
  if (!customer) erros.push("Escolha o cliente.");
  const frete = Number(b.frete_modalidade ?? 9);
  const itensBrutos = Array.isArray(b.itens) ? b.itens.slice(0, 200) : [];
  const itens = itensBrutos.map((x, k) => {
    const i = (x ?? {}) as Record<string, unknown>;
    const n = `Item ${k + 1}`;
    const product = uuid(i.product_id);
    if (!product) erros.push(`${n}: escolha o produto.`);
    const quantidade = num(i.quantidade);
    if (!(quantidade > 0)) erros.push(`${n}: quantidade maior que zero.`);
    const preco = num(i.preco_unitario);
    if (Number.isNaN(preco) || preco < 0) erros.push(`${n}: preço unitário inválido.`);
    const unidade = txt(i.unidade, 6).toUpperCase() || "PC";
    return {
      id: uuid(i.id), product_id: product ?? "", descricao: txt(i.descricao, 120).toUpperCase(), desenho: opc(i.desenho, 80), unidade,
      quantidade: quantidade > 0 ? quantidade : 0, preco_unitario: preco >= 0 ? preco : 0, prazo_entrega: data(i.prazo_entrega),
      item_pedido: opc(i.item_pedido, 20), observacao: opc(i.observacao, 500),
    };
  });
  itens.forEach((i, k) => { if (!i.descricao) erros.push(`Item ${k + 1}: falta a descrição.`); });
  return {
    erros,
    orcamento: {
      customer_id: customer, contato: opc(b.contato, 120), crm_card_id: uuid(b.crm_card_id), data_orcamento: data(b.data_orcamento),
      validade: data(b.validade), pedido_cliente: opc(b.pedido_cliente, 60), condicao_pagamento: opc(b.condicao_pagamento, 120),
      frete_modalidade: [0, 1, 2, 9].includes(frete) ? frete : 9, prazo_entrega: data(b.prazo_entrega), observacoes: opc(b.observacoes, 2000),
      mascara_id: uuid(b.mascara_id), treino: b.treino === true, itens,
    },
  };
}

/** Total do orçamento (soma de quantidade × preço, em centavos arredondados). */
export const totalOrcamento = (itens: { quantidade: number | string; preco_unitario: number | string }[]) =>
  Math.round(itens.reduce((a, i) => a + Number(i.quantidade) * Number(i.preco_unitario), 0) * 100) / 100;
