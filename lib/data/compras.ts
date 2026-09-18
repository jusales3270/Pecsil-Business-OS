export type Divisao = "USINAGEM" | "FUNDICAO";

export type StatusCotacao = "PENDENTE" | "APROVADO" | "REJEITADO" | "COMPRADO";

export type StatusProduto = "PENDENTE" | "APROVADO" | "REJEITADO";

export interface CotacaoProduto {
  id: number | string;
  cotacaoId?: number;
  produto: string;
  valorUnit: number;
  quantidade: number;
  unidade: string;
  icms: number;
  ipi: number;
  prazo: string;
  obs: string;
  status: StatusProduto;
  motivoRejeicao?: string | null;
}

export interface Cotacao {
  id: number;
  fornecedor: string;
  divisao: Divisao;
  status: StatusCotacao;
  userId: string;
  aprovadoPor: string | null;
  motivoRejeicao: string | null;
  dataDecisao: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // Campos retrocompatíveis ou legados
  produto?: string;
  valorUnit?: number;
  quantidade?: number;
  unidade?: string;
  icms?: number;
  ipi?: number;
  prazo?: string;
  obs?: string;
  produtos: CotacaoProduto[];
}

export interface Compra {
  id: number;
  cotacaoId: number;
  fornecedor: string;
  produto: string;
  quantidade: number;
  unidade: string;
  valorUnit: number;
  total: number;
  nf: string | null;
  dataCompra: string;
  obs: string | null;
  createdAt: string;
}

export interface ComprasSummary {
  totalCotacoes: number;
  pendentes: number;
  aprovadas: number;
  compradas: number;
  rejeitadas: number;
  totalGasto: number;
  gastoUsinagem: number;
  gastoFundicao: number;
}

export interface ComprasSnapshot {
  source: "supabase" | "demo";
  cotacoes: Cotacao[];
  compras: Compra[];
  notificacoes?: any[];
  summary: ComprasSummary;
  loadedAt: string;
}

// Sem conexão: vazio, nunca cotação ou compra fictícia.
export const demoComprasSnapshot: ComprasSnapshot = {
  source: "demo",
  cotacoes: [],
  compras: [],
  notificacoes: [],
  summary: calculateComprasSummary([], []),
  loadedAt: new Date(0).toISOString(),
};

export function calculateComprasSummary(cotacoes: Cotacao[], compras: Compra[]): ComprasSummary {
  let pendentes = 0;
  let aprovadas = 0;
  let compradas = 0;
  let rejeitadas = 0;

  for (const c of cotacoes) {
    if (c.status === "PENDENTE") pendentes++;
    else if (c.status === "APROVADO") aprovadas++;
    else if (c.status === "COMPRADO") compradas++;
    else if (c.status === "REJEITADO") rejeitadas++;
  }

  let totalGasto = 0;
  let gastoUsinagem = 0;
  let gastoFundicao = 0;

  const cotacaoMap = new Map<number, Cotacao>(cotacoes.map((c) => [c.id, c]));

  for (const comp of compras) {
    totalGasto += comp.total || 0;
    const parent = cotacaoMap.get(comp.cotacaoId);
    if (parent?.divisao === "USINAGEM") {
      gastoUsinagem += comp.total || 0;
    } else if (parent?.divisao === "FUNDICAO") {
      gastoFundicao += comp.total || 0;
    }
  }

  return {
    totalCotacoes: cotacoes.length,
    pendentes,
    aprovadas,
    compradas,
    rejeitadas,
    totalGasto,
    gastoUsinagem,
    gastoFundicao,
  };
}
