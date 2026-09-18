import type { DashboardData, ForjaConnectionStatus } from '../types';
import { emptyForjaDashboardData } from '../data/emptyForjaData';

export interface DashboardApiResponse {
  success: boolean;
  source: 'live' | 'sem-conexao';
  endpoint: string;
  fetchedAt?: string;
  motivo?: string;
  data: DashboardData;
  warning?: string;
}

const ENDPOINT = '/api/forja/dashboard';

export async function fetchForjaDashboard(): Promise<{
  data: DashboardData;
  status: ForjaConnectionStatus;
}> {
  const inicio = performance.now();
  const falha = (modo: ForjaConnectionStatus['modo'], erroMensagem: string) => ({
    data: emptyForjaDashboardData,
    status: {
      online: false,
      modo,
      endpoint: ENDPOINT,
      latenciaMs: Math.round(performance.now() - inicio),
      ultimaAtualizacao: new Date().toISOString(),
      erroMensagem,
    },
  });

  try {
    const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' });

    // Sessão expirada: o lugar certo é o login.
    if (res.status === 401) {
      window.location.assign('/login');
      return falha('erro', 'Sessão expirada.');
    }
    if (res.status === 403) {
      return falha('sem-acesso', 'Seu perfil não tem acesso à Produção. Fale com o proprietário da conta.');
    }
    if (!res.ok) return falha('erro', `A plataforma respondeu ${res.status}.`);

    const payload: DashboardApiResponse = await res.json();
    const online = payload.source === 'live';
    return {
      data: payload.data,
      status: {
        online,
        modo: online ? 'live' : 'sem-conexao',
        endpoint: payload.endpoint,
        latenciaMs: Math.round(performance.now() - inicio),
        ultimaAtualizacao: payload.fetchedAt ?? new Date().toISOString(),
        erroMensagem: online ? undefined : payload.warning,
      },
    };
  } catch (err: unknown) {
    // Painel vazio se a própria rota do Next falhar (nada de dado fictício)
    return falha('erro', err instanceof Error ? err.message : String(err));
  }
}
