import type { DashboardData } from "../types";

/**
 * Painel vazio.
 *
 * Quando a API do Forja não responde, a plataforma mostra este conjunto vazio
 * e avisa que está sem conexão — antes exibia números de produção fictícios
 * indistinguíveis dos reais.
 */
export const emptyForjaDashboardData: DashboardData = {
  geradoEm: new Date(0).toISOString(),
  indicadores: {
    carteira: { total: 0, emDia: 0, atrasadas: 0 },
    historico: {
      dias: 0, inicio: "", fim: "", total: 0, emDia: 0, atrasadas: 0, pontualidade: null,
      semDataConclusao: 0, porCliente: [], porTipo: [], evolucao: [],
    },
  },
  gargalos: [],
  enviosExternos: [],
  totalOSExternas: 0,
  osPorStatus: {},
  osPorStatusLista: {},
  osAtrasadas: [],
  kanban: [],
  pipelines: [],
  inspecao: {},
  paradas: { ativas: [], porMotivoHoje: {} },
  fantasmas: { opsParadas: [], turnosNaoFechados: [] },
};
