import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardData, ForjaConnectionStatus } from '../types';
import { fetchForjaDashboard } from '../services/forjaApi';
import { emptyForjaDashboardData } from '../data/emptyForjaData';

export function useProducaoDashboard(intervaloSegundos = 30) {
  const [data, setData] = useState<DashboardData>(emptyForjaDashboardData);
  const [status, setStatus] = useState<ForjaConnectionStatus>({
    online: false,
    modo: 'mock',
    endpoint: '/api/forja/dashboard',
  });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(intervaloSegundos);

  const mountedRef = useRef(true);

  const carregarDados = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetchForjaDashboard();
      if (mountedRef.current) {
        setData(res.data);
        setStatus(res.status);
      }
    } catch {
      // Já tratado com fallback no fetchForjaDashboard
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setIsRefreshing(false);
        setCountdown(intervaloSegundos);
      }
    }
  }, [intervaloSegundos]);

  // Carga inicial
  useEffect(() => {
    mountedRef.current = true;
    carregarDados();
    return () => {
      mountedRef.current = false;
    };
  }, [carregarDados]);

  // Temporizador regressivo e auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          carregarDados();
          return intervaloSegundos;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoRefresh, intervaloSegundos, carregarDados]);

  const toggleAutoRefresh = useCallback(() => {
    setAutoRefresh((prev) => !prev);
  }, []);

  return {
    data,
    status,
    loading,
    isRefreshing,
    autoRefresh,
    countdown,
    refetch: () => carregarDados(true),
    toggleAutoRefresh,
  };
}
