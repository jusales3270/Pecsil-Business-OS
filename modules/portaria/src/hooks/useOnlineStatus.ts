import { useState, useEffect, useCallback, useRef } from 'react';
import { processQueue, getQueueCount, type IdMapping } from "../lib/offlineQueue";
import { supabase } from "../lib/supabase";

interface OnlineStatus {
  /** Se o sistema detecta conectividade real com o Supabase */
  isOnline: boolean;
  /** Número de operações pendentes na fila offline */
  pendingCount: number;
  /** Se está atualmente processando a fila */
  isSyncing: boolean;
  /** Timestamp da última sincronização bem-sucedida */
  lastSyncTime: Date | null;
  /** Se acabou de sincronizar com sucesso (para feedback visual temporário) */
  justSynced: boolean;
  /** Força o reprocessamento da fila */
  forceSync: () => void;
}

/**
 * Hook que monitora a conectividade com o Supabase e processa a fila offline
 * automaticamente quando a conexão é restabelecida.
 *
 * @param onIdMappings Callback chamado com os mapeamentos de tempId → realId
 *                     após sincronização bem-sucedida, para atualizar os states.
 */
export function useOnlineStatus(
  onIdMappings?: (mappings: IdMapping[]) => void,
): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(getQueueCount);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [justSynced, setJustSynced] = useState(false);

  const onIdMappingsRef = useRef(onIdMappings);
  onIdMappingsRef.current = onIdMappings;

  const justSyncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncingRef = useRef(false);

  // Atualiza o contador de pendentes periodicamente (a cada 2s)
  useEffect(() => {
    const interval = setInterval(() => {
      setPendingCount(getQueueCount());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Processa a fila offline
  const syncQueue = useCallback(async () => {
    if (isSyncingRef.current) return;
    const count = getQueueCount();
    if (count === 0) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const result = await processQueue();
      setPendingCount(getQueueCount());

      if (result.processedCount > 0) {
        setLastSyncTime(new Date());
        setJustSynced(true);

        // Limpa o flag de "acabou de sincronizar" após 4 segundos
        if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
        justSyncedTimerRef.current = setTimeout(() => setJustSynced(false), 4000);

        // Notifica o App sobre os mapeamentos de ID para atualizar states
        if (result.idMappings.length > 0 && onIdMappingsRef.current) {
          onIdMappingsRef.current(result.idMappings);
        }
      }

      if (result.failedCount > 0) {
        console.warn(`[useOnlineStatus] ${result.failedCount} operações descartadas após máximo de tentativas.`);
      }
    } catch (err) {
      console.error('[useOnlineStatus] Erro ao processar fila:', err);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // Verifica conectividade real com o Supabase (honra navigator.onLine e detecta falhas de rede)
  const checkRealConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return false;
    }
    try {
      const { error } = await supabase.from('visitas').select('id').limit(1);
      // Se for erro específico de rede/fetch, está offline
      if (error && (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError'))) {
        return false;
      }
      return true;
    } catch {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
  }, []);

  // Ao abrir a página com conexão, envia o que ficou na fila. Sem isso, uma
  // fila salva num dia anterior só era enviada quando a conexão caísse e
  // voltasse — e o aviso de pendências ficava para sempre.
  useEffect(() => {
    let ativo = true;
    checkRealConnectivity().then((online) => {
      if (ativo && online) syncQueue();
    });
    return () => { ativo = false; };
  }, [checkRealConnectivity, syncQueue]);

  // Monitora eventos de online/offline do navegador
  useEffect(() => {
    const handleOnline = async () => {
      // Verifica conectividade real antes de marcar como online
      const reallyOnline = await checkRealConnectivity();
      setIsOnline(reallyOnline);
      if (reallyOnline) {
        syncQueue();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [checkRealConnectivity, syncQueue]);

  // Ping periódico a cada 30s para detectar reconexão em redes instáveis
  // (navigator.onLine pode reportar true mesmo sem conectividade real)
  useEffect(() => {
    const interval = setInterval(async () => {
      const reallyOnline = await checkRealConnectivity();
      const wasOffline = !isOnline;
      setIsOnline(reallyOnline);

      // Se transitou de offline → online, processa a fila
      if (wasOffline && reallyOnline) {
        syncQueue();
      }
    }, 30000); // 30 segundos

    return () => clearInterval(interval);
  }, [isOnline, checkRealConnectivity, syncQueue]);

  // Força sincronização manual
  const forceSync = useCallback(() => {
    syncQueue();
  }, [syncQueue]);

  // Cleanup do timer
  useEffect(() => {
    return () => {
      if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
    };
  }, []);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    lastSyncTime,
    justSynced,
    forceSync,
  };
}
