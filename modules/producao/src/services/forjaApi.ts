import type { DashboardData, ForjaConnectionStatus } from '../types';

export interface DashboardApiResponse {
  success: boolean;
  source: 'live' | 'mock-fallback';
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

    // Import dinâmico do mock de contingência se a própria rota Next falhar
    const { mockForjaDashboardData } = await import('../data/mockForjaData');

    return {
      data: mockForjaDashboardData,
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
