/**
 * offlineQueue.ts
 *
 * Fila de operações pendentes persistida em localStorage.
 * Quando a internet cai, as operações CRUD são enfileiradas aqui.
 * Quando a internet volta, processQueue() reenvia tudo ao Supabase.
 */

import {
  inserirVisita,
  atualizarVisitaDb,
  encerrarVisitaDb,
  excluirVisitaDb,
  inserirVeiculo,
  atualizarVeiculoDb,
  excluirVeiculoDb,
  inserirTerceiro,
  encerrarTerceiroDb,
  excluirTerceiroDb,
  salvarVisitante,
  inserirRecebido,
  excluirRecebidoDb,
} from './supabase';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type OperationType =
  | 'insert_visita'
  | 'update_visita'
  | 'delete_visita'
  | 'encerrar_visita'
  | 'insert_veiculo'
  | 'update_veiculo'
  | 'delete_veiculo'
  | 'insert_terceiro'
  | 'encerrar_terceiro'
  | 'delete_terceiro'
  | 'save_visitante'
  | 'insert_recebido'
  | 'delete_recebido';

export interface PendingOperation {
  /** UUID único da operação na fila */
  id: string;
  /** Tipo de operação CRUD */
  type: OperationType;
  /** Dados da operação (JSON-serializable) */
  payload: Record<string, unknown>;
  /** ID temporário usado no state local (para inserts) */
  tempId?: string;
  /** Timestamp ISO de quando a operação foi criada */
  timestamp: string;
  /** Quantas vezes já tentou reenviar (máx: 5) */
  retryCount: number;
}

/** Mapa de tempId → realId retornado após sincronização */
export type IdMapping = { tempId: string; realId: string };

// ─── Constantes ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pecsil_offline_queue';
const MAX_RETRIES = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── API Pública ────────────────────────────────────────────────────────────

/** Retorna a fila inteira do localStorage */
export function getQueue(): PendingOperation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingOperation[];
  } catch {
    return [];
  }
}

/** Número de operações pendentes */
export function getQueueCount(): number {
  return getQueue().length;
}

/** Salva a fila inteira no localStorage */
function saveQueue(queue: PendingOperation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('[OfflineQueue] Erro ao salvar fila no localStorage:', err);
  }
}

/** Adiciona uma operação à fila */
export function enqueueOperation(
  type: OperationType,
  payload: Record<string, unknown>,
  tempId?: string,
): void {
  const queue = getQueue();
  const op: PendingOperation = {
    id: generateId(),
    type,
    payload,
    tempId,
    timestamp: new Date().toISOString(),
    retryCount: 0,
  };
  queue.push(op);
  saveQueue(queue);
  console.log(`[OfflineQueue] Operação enfileirada: ${type}`, op.id);
}

/** Remove uma operação da fila pelo ID */
export function dequeueOperation(opId: string): void {
  const queue = getQueue().filter(op => op.id !== opId);
  saveQueue(queue);
}

/** Limpa toda a fila (usar com cuidado) */
export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Processamento da fila ──────────────────────────────────────────────────

/**
 * Processa todas as operações pendentes na fila, em ordem.
 * Retorna um array de IdMapping para atualizar os IDs temporários nos states.
 * Operações que falharem serão mantidas na fila (até MAX_RETRIES).
 */
export async function processQueue(): Promise<{
  idMappings: IdMapping[];
  processedCount: number;
  failedCount: number;
}> {
  const queue = getQueue();
  if (queue.length === 0) return { idMappings: [], processedCount: 0, failedCount: 0 };

  console.log(`[OfflineQueue] Processando ${queue.length} operação(ões) pendentes...`);

  const idMappings: IdMapping[] = [];
  const remaining: PendingOperation[] = [];
  let processedCount = 0;
  let failedCount = 0;

  for (const op of queue) {
    try {
      const result = await executeOperation(op);

      if (result.success) {
        processedCount++;
        if (result.realId && op.tempId) {
          idMappings.push({ tempId: op.tempId, realId: result.realId });
        }
        console.log(`[OfflineQueue] ✓ Operação processada: ${op.type}`, op.id);
      } else {
        // Falhou — incrementa retry e mantém na fila (se não excedeu limite)
        op.retryCount++;
        if (op.retryCount < MAX_RETRIES) {
          remaining.push(op);
          console.warn(`[OfflineQueue] ⚠ Retry ${op.retryCount}/${MAX_RETRIES}: ${op.type}`, op.id);
        } else {
          failedCount++;
          console.error(`[OfflineQueue] ✗ Operação descartada após ${MAX_RETRIES} tentativas: ${op.type}`, op.id);
        }
      }
    } catch (err) {
      op.retryCount++;
      if (op.retryCount < MAX_RETRIES) {
        remaining.push(op);
        console.warn(`[OfflineQueue] ⚠ Erro, retry ${op.retryCount}/${MAX_RETRIES}: ${op.type}`, err);
      } else {
        failedCount++;
        console.error(`[OfflineQueue] ✗ Descartada após ${MAX_RETRIES} tentativas: ${op.type}`, err);
      }
    }
  }

  // Salva apenas as operações que ainda não foram processadas
  saveQueue(remaining);

  console.log(`[OfflineQueue] Resultado: ${processedCount} processadas, ${remaining.length} pendentes, ${failedCount} descartadas`);

  return { idMappings, processedCount, failedCount };
}

// ─── Executor de operações individuais ──────────────────────────────────────

async function executeOperation(op: PendingOperation): Promise<{ success: boolean; realId?: string }> {
  const p = op.payload;

  switch (op.type) {
    case 'insert_visita': {
      const realId = await inserirVisita({
        data: p.data as string,
        empresa: p.empresa as string,
        visitante: p.visitante as string,
        horarioEntrada: p.horarioEntrada as string,
        horarioSaida: p.horarioSaida as string,
        documento: p.documento as string,
        contato: p.contato as string,
        responsavel: p.responsavel as string,
        placaVeiculo: p.placaVeiculo as string,
        notasFiscais: p.notasFiscais as { numero: string; valor: number }[],
        descricao: p.descricao as string,
        fotoBase64: p.fotoBase64 as string | undefined,
      });
      return realId ? { success: true, realId } : { success: false };
    }

    case 'update_visita': {
      await atualizarVisitaDb({
        id: p.id as string,
        data: p.data as string,
        empresa: p.empresa as string,
        visitante: p.visitante as string,
        horarioEntrada: p.horarioEntrada as string,
        documento: p.documento as string,
        contato: p.contato as string,
        responsavel: p.responsavel as string,
        placaVeiculo: p.placaVeiculo as string,
        notasFiscais: p.notasFiscais as { numero: string; valor: number }[],
        descricao: p.descricao as string,
      });
      return { success: true };
    }

    case 'delete_visita': {
      await excluirVisitaDb(p.id as string);
      return { success: true };
    }

    case 'encerrar_visita': {
      await encerrarVisitaDb(p.id as string, p.horarioSaida as string);
      return { success: true };
    }

    case 'insert_veiculo': {
      const realId = await inserirVeiculo({
        data: p.data as string,
        motorista: p.motorista as string,
        veiculo: p.veiculo as string,
        horarioSaida: p.horarioSaida as string,
        dataRetorno: p.dataRetorno as string,
        horarioRetorno: p.horarioRetorno as string,
        kmRodados: p.kmRodados as number,
        kmSaida: p.kmSaida as number,
        kmEntrada: p.kmEntrada as number,
        destino: p.destino as string,
        notasFiscais: p.notasFiscais as { numero: string; valor: number }[],
      });
      return realId ? { success: true, realId } : { success: false };
    }

    case 'update_veiculo': {
      await atualizarVeiculoDb({
        id: p.id as string,
        data: p.data as string,
        motorista: p.motorista as string,
        veiculo: p.veiculo as string,
        horarioSaida: p.horarioSaida as string,
        dataRetorno: p.dataRetorno as string,
        horarioRetorno: p.horarioRetorno as string,
        kmRodados: p.kmRodados as number,
        kmSaida: p.kmSaida as number,
        kmEntrada: p.kmEntrada as number,
        destino: p.destino as string,
        notasFiscais: p.notasFiscais as { numero: string; valor: number }[],
      });
      return { success: true };
    }

    case 'delete_veiculo': {
      await excluirVeiculoDb(p.id as string);
      return { success: true };
    }

    case 'insert_terceiro': {
      const realId = await inserirTerceiro({
        nome: p.nome as string,
        data: p.data as string,
        horaEntrada: p.horaEntrada as string,
      });
      return realId ? { success: true, realId } : { success: false };
    }

    case 'encerrar_terceiro': {
      await encerrarTerceiroDb(
        p.id as string,
        p.horaSaida as string,
        p.minutosTrabalhados as number,
      );
      return { success: true };
    }

    case 'delete_terceiro': {
      await excluirTerceiroDb(p.id as string);
      return { success: true };
    }

    case 'save_visitante': {
      // faceDescriptor armazenado como Array<number> no localStorage
      const descriptor = p.faceDescriptor
        ? new Float32Array(p.faceDescriptor as number[])
        : undefined;
      await salvarVisitante(
        p.nome as string,
        p.empresa as string,
        p.documento as string,
        p.contato as string,
        descriptor,
      );
      return { success: true };
    }

    case 'insert_recebido': {
      const realId = await inserirRecebido({
        data: p.data as string,
        horaRegistro: p.horaRegistro as string,
        remetente: p.remetente as string,
        destinatario: p.destinatario as string,
        descricao: p.descricao as string,
        fotoBase64: p.fotoBase64 as string | undefined,
      });
      return realId ? { success: true, realId } : { success: false };
    }

    case 'delete_recebido': {
      await excluirRecebidoDb(p.id as string);
      return { success: true };
    }

    default:
      console.warn(`[OfflineQueue] Tipo de operação desconhecido: ${op.type}`);
      return { success: false };
  }
}
