export type UserRole = 'ORCAMENTISTA' | 'GESTOR';

export type Divisao = 'USINAGEM' | 'FUNDICAO';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export type StatusCotacao = 'PENDENTE' | 'APROVADO' | 'REJEITADO' | 'COMPRADO';

export type StatusProduto = 'PENDENTE' | 'APROVADO' | 'REJEITADO';

export interface CotacaoProduto {
  id: string;
  produto: string;
  valorUnit: number;
  quantidade: number;
  unidade: string;
  icms: number;
  ipi: number;
  prazo: string;
  obs: string;
  status?: StatusProduto;
  motivoRejeicao?: string;
}

export interface Cotacao {
  id: number;
  fornecedor: string;
  produtos?: CotacaoProduto[];
  // Campos raízes opcionais para compatibilidade retroativa
  produto?: string;
  valorUnit?: number;
  quantidade?: number;
  unidade?: string;
  icms?: number;
  ipi?: number;
  prazo?: string;
  obs?: string;
  status: StatusCotacao;
  divisao: Divisao;
  userId: number;
  aprovadoPor: string | null;
  motivoRejeicao: string | null;
  dataDecisao: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Compra {
  id: number;
  cotacaoId: number;
  fornecedor: string;
  produto: string;
  quantidade: number;
  unidade: string;
  valorUnit: number;
  total: number;
  nf: string | null;
  dataCompra: string;
  obs: string | null;
  createdAt: string;
}

export type TipoNotificacao = 'COTACAO_APROVADA' | 'COTACAO_REJEITADA' | 'NOVA_COTACAO_PENDENTE' | 'COTACAO_COMPRADA';

export interface Notificacao {
  id: number;
  userId: number;
  cotacaoId: number | null;
  tipo: TipoNotificacao;
  mensagem: string;
  lida: boolean;
  createdAt: string;
}

export interface IcmsRow {
  id?: number;
  planilha_id?: number;
  fantasia: string;
  emitida: string;
  recebida: string;
  fornecedor: string;
  nfe: string;
  valor: number;
  vlr_cobrado: number;
  icms: number;
  ipi: number;
  tipo: string;
  centro: string;
  status: string;
  obs: string;
}

export interface IcmsPlanilha {
  id?: number;
  mes: string;           // formato "YYYY-MM"
  uploaded_at?: string;
  uploaded_by?: string;
}

export interface IcmsLivroLinha {
  id?: number;
  planilha_id?: number;
  data: string;
  descricao: string;
  credito: number;
  debito: number;
  saldo: number;
}

export type Page = 
  | 'login'
  | 'dashboard'
  | 'cotacoes'
  | 'compras'
  | 'pendentes'
  | 'historico'
  | 'icms';
