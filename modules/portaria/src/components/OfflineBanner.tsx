import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

interface OfflineBannerProps {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  justSynced: boolean;
}

/**
 * Banner fixo no topo da tela que mostra o status de conexão:
 * - Offline: vermelho/amarelo com contagem de pendentes
 * - Sincronizando: azul com spinner
 * - Sincronizado com sucesso: verde momentâneo (desaparece após 4s)
 * - Online sem pendentes: nada (não renderiza)
 */
export function OfflineBanner({ isOnline, pendingCount, isSyncing, justSynced }: OfflineBannerProps) {
  // Online, sem pendentes, e não acabou de sincronizar → não mostra nada
  if (isOnline && pendingCount === 0 && !isSyncing && !justSynced) {
    return null;
  }

  // Estado: acabou de sincronizar com sucesso
  if (justSynced && isOnline && pendingCount === 0) {
    return (
      <div className="bg-emerald-500 text-white px-4 py-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 animate-in slide-in-from-top duration-300 shadow-md"
           style={{ zIndex: 9999 }}>
        <CheckCircle2 className="w-4 h-4" />
        <span>Conexão restabelecida · Dados sincronizados com sucesso!</span>
      </div>
    );
  }

  // Estado: sincronizando a fila
  if (isSyncing) {
    return (
      <div className="bg-blue-500 text-white px-4 py-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 shadow-md"
           style={{ zIndex: 9999 }}>
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>Reconectando · Sincronizando {pendingCount} {pendingCount === 1 ? 'operação pendente' : 'operações pendentes'}...</span>
      </div>
    );
  }

  // Estado: offline com pendentes
  if (!isOnline && pendingCount > 0) {
    return (
      <div className="bg-amber-500 text-white px-4 py-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 shadow-md"
           style={{ zIndex: 9999 }}>
        <WifiOff className="w-4 h-4" />
        <span>Sem conexão · {pendingCount} {pendingCount === 1 ? 'operação pendente' : 'operações pendentes'} — serão salvas quando a internet voltar</span>
      </div>
    );
  }

  // Estado: offline sem pendentes
  if (!isOnline) {
    return (
      <div className="bg-red-500 text-white px-4 py-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 shadow-md"
           style={{ zIndex: 9999 }}>
        <WifiOff className="w-4 h-4" />
        <span>Sem conexão com a internet</span>
      </div>
    );
  }

  // Estado: online mas com pendentes (fila ainda não processada)
  if (isOnline && pendingCount > 0) {
    return (
      <div className="bg-amber-500 text-white px-4 py-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 shadow-md"
           style={{ zIndex: 9999 }}>
        <AlertTriangle className="w-4 h-4" />
        <span>{pendingCount} {pendingCount === 1 ? 'operação pendente' : 'operações pendentes'} aguardando sincronização</span>
      </div>
    );
  }

  return null;
}
