import type { DashboardData, ForjaConnectionStatus } from '../types';

export interface DashboardApiResponse {
  success: boolean;
  source: 'live' | 'sem-conexao';
  endpoint: string;
  data: DashboardData;
  warning?: string;
}

export async function fetchForjaDashboard(): Promise<{
  data: DashboardData;
  status: ForjaConnectionStatus;
}> {
  const inicio = performance.now();
  try {
    const res = await fetch('/api/forja/dashboard', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const latenciaMs = Math.round(performance.now() - inicio);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const payload: DashboardApiResponse = await res.json();

    return {
      data: payload.data,
      status: {
        online: payload.source === 'live',
        modo: payload.source === 'live' ? 'live' : 'mock',
        endpoint: payload.endpoint,
        latenciaMs,
        ultimaAtualizacao: new Date().toISOString(),
        erroMensagem: payload.warning,
      },
    };
  } catch (err: unknown) {
    const latenciaMs = Math.round(performance.now() - inicio);
    const erroMensagem = err instanceof Error ? err.message : String(err);

    // Painel vazio se a própria rota do Next falhar (nada de dado fictício)
    const { emptyForjaDashboardData } = await import('../data/emptyForjaData');

    return {
      data: emptyForjaDashboardData,
      status: {
        online: false,
        modo: 'erro',
        endpoint: '/api/forja/dashboard',
        latenciaMs,
        ultimaAtualizacao: new Date().toISOString(),
        erroMensagem,
      },
    };
  }
}
