// ============================================================
// Tipos de dados da Produção (alinhados com a API do Forja)
// ============================================================

export type Semaforo = 'verde' | 'amarelo' | 'vermelho';

export interface OSResumo {
  id: string;
  codigoGrv: string;
  prazoEntrega: string;
  prioridade: string;
  status: string;
  quantidadeTotal: number;
  cliente: { nome: string };
  artigo: { codigo: string; descricao: string };
}

export type OSAtrasada = OSResumo;

export interface KanbanCard {
  opLoteId: string;
  codigoOp: string;
  codigoGrv: string;
  numeroLote: number;
  cliente: string;
  artigo: string;
  status: string;
  prioridade: string;
  diasAtePrazo: number;
  semaforo: Semaforo;
  operador: string | null;
  programador: string | null;
  maquina: string | null;
  /** Lote fora da fábrica (metalização externa). */
  externo: boolean;
  fornecedor: string | null;
  /** Peças disponíveis nesta etapa, ou enviadas ao fornecedor. */
  quantidade: number;
  veioDe: PassoRoteiro | null;
  proxima: PassoRoteiro | null;
}

export interface PassoRoteiro {
  estacao: string;
  tipoServico: string;
}

export interface KanbanEtapa {
  etapaId: string;
  nome: string;
  ordemPadrao: number;
  total: number;
  cards: KanbanCard[];
}

export interface CardPipeline {
  opLoteId: string;
  codigoOp: string;
  codigoGrv: string;
  osId: string;
  numeroLote: number;
  cliente: string;
  artigo: string;
  artigoDescricao?: string;
  tipoServico: string;
  status: string;
  prioridade: string;
  quantidadeConcluida: number;
  quantidadePecas: number;
  diasAtePrazo: number;
  semaforo: Semaforo;
  desdeQuando: string | null;
  operador: string | null;
  maquina: string | null;
  paradaAtiva: {
    motivo: string;
    planejado: boolean;
    inicio: string;
  } | null;
  alertaInicioEm: string | null;
  etapaAvisada: string | null;
  terceirizada: boolean;
  fornecedor: string | null;
  prazoPrevistoDias: number | null;
  esperaHoras: number | null;
  liberaEm: string | null;
  exigeLoteCompleto: boolean;
  pecasDisponiveis: number;
  liberadasPelaAnterior: number;
}

export interface FasePipeline {
  tipoServicoId: string;
  nome: string;
  ordem: number;
  codigo: number | null;
  naFila: number;
  emProcesso: number;
  parado: number;
  total: number;
  cards: CardPipeline[];
}

export interface PipelineEtapa {
  etapaId: string;
  etapaNome: string;
  temFases: boolean;
  fases: FasePipeline[];
  semFase: CardPipeline[];
}

export interface ParadaAtiva {
  id: string;
  motivo: string;
  planejado: boolean;
  maquina: string | null;
  codigoOp: string;
  etapa: string;
  codigoGrv: string;
  cliente: string;
  inicio: string;
  minutosParado: number;
}

export interface ParadasPorMotivoInfo {
  minutos: number;
  ocorrencias: number;
  planejado: boolean;
}

export interface FantasmaOpParada {
  codigoOp: string;
  codigoGrv: string;
  etapa: string;
  horasParado: number;
}

export interface FantasmaTurno {
  operador: string;
}

export interface GrupoPontualidade {
  id: string;
  nome: string;
  total: number;
  atrasadas: number;
  mediaDiasAtraso: number;
}

export interface IndicadoresProducao {
  /** OS em aberto hoje. */
  carteira: { total: number; emDia: number; atrasadas: number };
  /** OS finalizadas na janela (padrão do Forja: 90 dias). */
  historico: {
    dias: number;
    inicio: string;
    fim: string;
    total: number;
    emDia: number;
    atrasadas: number;
    pontualidade: number | null;
    semDataConclusao: number;
    porCliente: GrupoPontualidade[];
    porTipo: GrupoPontualidade[];
    evolucao: { mes: string; emDia: number; atrasadas: number }[];
  };
}

export interface Gargalo {
  etapaId: string;
  nome: string;
  operacoes: number;
  pecas: number;
  horasPlanejadas: number;
  osAtrasadas: number;
}

export interface EnvioExterno {
  opLoteId: string;
  codigoGrv: string;
  codigoOp: string;
  tipoServico: string;
  numeroLote: number;
  cliente: string;
  artigo: string;
  descricao: string;
  fornecedor: string | null;
  quantidade: number | null;
  enviadoEm: string;
  diasFora: number;
  prazoEntrega: string;
  diasAtePrazo: number;
}

export interface DashboardData {
  geradoEm: string;
  indicadores: IndicadoresProducao;
  gargalos: Gargalo[];
  enviosExternos: EnvioExterno[];
  totalOSExternas: number;
  osPorStatus: Record<string, number>;
  osPorStatusLista: Record<string, OSResumo[]>;
  osAtrasadas: OSAtrasada[];
  kanban: KanbanEtapa[];
  pipelines: PipelineEtapa[];
  inspecao: Record<string, number>;
  paradas: {
    ativas: ParadaAtiva[];
    porMotivoHoje: Record<string, ParadasPorMotivoInfo>;
  };
  fantasmas: {
    opsParadas: FantasmaOpParada[];
    turnosNaoFechados: FantasmaTurno[];
  };
}

export interface ForjaConnectionStatus {
  online: boolean;
  /** `sem-acesso`: o perfil do usuário não tem Produção no Business OS. */
  modo: 'live' | 'sem-conexao' | 'sem-acesso' | 'erro';
  endpoint: string;
  latenciaMs?: number;
  ultimaAtualizacao?: string;
  erroMensagem?: string;
}

export type ProducaoSubmenu =
  | 'painel'
  | 'os'
  | 'fundicao'
  | 'paradas'
  | 'qualidade'
  | 'fantasmas'
  | 'bi'
  | 'config';
