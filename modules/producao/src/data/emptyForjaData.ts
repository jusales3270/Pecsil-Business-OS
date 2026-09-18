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
  osPorStatus: {},
  osPorStatusLista: {},
  osAtrasadas: [],
  kanban: [],
  pipelines: [],
  inspecao: {},
  paradas: { ativas: [], porMotivoHoje: {} },
  fantasmas: { opsParadas: [], turnosNaoFechados: [] },
};
