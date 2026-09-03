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

export const demoComprasSnapshot: ComprasSnapshot = {
  source: "demo",
  cotacoes: [
    {
      id: 101,
      fornecedor: "Aços Ipanema Ltda",
      divisao: "USINAGEM",
      status: "PENDENTE",
      userId: "demo-user",
      aprovadoPor: null,
      motivoRejeicao: null,
      dataDecisao: null,
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      deletedAt: null,
      produtos: [
        {
          id: 1,
          produto: "Barra Redonda SAE 1045 Ø 50mm",
          quantidade: 120,
          unidade: "KG",
          valorUnit: 14.8,
          icms: 12,
          ipi: 5,
          prazo: "5 dias úteis",
          obs: "Certificado de usinabilidade exigido",
          status: "PENDENTE",
        },
        {
          id: 2,
          produto: "Tubo Mecânico ST 52 Ø 80x10mm",
          quantidade: 60,
          unidade: "M",
          valorUnit: 82.5,
          icms: 12,
          ipi: 5,
          prazo: "7 dias úteis",
          obs: "Corte em peças de 1000mm",
          status: "PENDENTE",
        },
      ],
    },
    {
      id: 102,
      fornecedor: "Refratários Sorocaba S/A",
      divisao: "FUNDICAO",
      status: "APROVADO",
      userId: "demo-user",
      aprovadoPor: "Júnior Sales",
      motivoRejeicao: null,
      dataDecisao: new Date(Date.now() - 86400000).toISOString(),
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      deletedAt: null,
      produtos: [
        {
          id: 3,
          produto: "Tinta Refratária base Álcool 20L",
          quantidade: 15,
          unidade: "BD",
          valorUnit: 245.0,
          icms: 18,
          ipi: 0,
          prazo: "Imediato",
          obs: "Para pintura de machos e moldes",
          status: "APROVADO",
        },
      ],
    },
    {
      id: 103,
      fornecedor: "Ferramentas & Insertos Brasil",
      divisao: "USINAGEM",
      status: "COMPRADO",
      userId: "demo-user",
      aprovadoPor: "Júnior Sales",
      motivoRejeicao: null,
      dataDecisao: new Date(Date.now() - 86400000 * 3).toISOString(),
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      deletedAt: null,
      produtos: [
        {
          id: 4,
          produto: "Inserto Metal Duro WNMG 080408-PM",
          quantidade: 50,
          unidade: "PC",
          valorUnit: 34.2,
          icms: 12,
          ipi: 6.5,
          prazo: "Entregue",
          obs: "Usinagem de desbaste pesado",
          status: "APROVADO",
        },
      ],
    },
  ],
  compras: [
    {
      id: 201,
      cotacaoId: 103,
      fornecedor: "Ferramentas & Insertos Brasil",
      produto: "Inserto Metal Duro WNMG 080408-PM (50 PC)",
      quantidade: 50,
      unidade: "PC",
      valorUnit: 34.2,
      total: 1710.0,
      nf: "NF-e 048.912",
      dataCompra: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
      obs: "Faturado 28 dias",
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
  ],
  summary: {
    totalCotacoes: 3,
    pendentes: 1,
    aprovadas: 1,
    compradas: 1,
    rejeitadas: 0,
    totalGasto: 1710.0,
    gastoUsinagem: 1710.0,
    gastoFundicao: 0,
  },
  loadedAt: new Date().toISOString(),
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
