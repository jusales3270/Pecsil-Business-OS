export interface NotaFiscalItem {
  numero: string;
  valor: number;
}

export interface Visita {
  id: string;
  data: string;
  empresa: string;
  visitante: string;
  horarioEntrada: string;
  horarioSaida: string;
  documento: string;
  contato: string;
  responsavel: string;
  placaVeiculo: string;
  notasFiscais: NotaFiscalItem[];
  descricao: string;
  fotoBase64?: string;
  faceDescriptor?: Float32Array;
}

export interface ControleVeiculo {
  id: string;
  data: string;
  motorista: string;
  veiculo: string;
  horarioSaida: string;
  dataRetorno: string;
  horarioRetorno: string;
  kmRodados: number;
  kmSaida: number;
  kmEntrada: number;
  destino: string;
  notasFiscais: NotaFiscalItem[];
}

export type TipoDescricao = 
  | 'Entrega' 
  | 'Visita' 
  | 'Visita técnica' 
  | 'Coleta' 
  | 'Trocar Caçamba' 
  | 'Boleto' 
  | 'Reunião' 
  | 'Outro';

export const MOTORISTAS = [
  'Dalvaci',
  'Domingo',
  'João',
  'Maros',
  'Nilton',
  'Rafael',
  'Romualdo',
  'Rosana'
] as const;

export const VEICULOS = [
  'VW - EXPRESS - FZI7276',
  'VW/13.180 CM EYL1643',
  'VW 11.180 DRC BZK6I78',
  'STRADA GEP1442',
  'STRADA FLX5966'
] as const;

export const RESPONSAVEIS = [
  'Almoxarifado',
  'Ana Claudia',
  'Compras',
  'Diretoria',
  'Domingo',
  'Edimilson',
  'Ferramentaria',
  'Fundição',
  'Gerência',
  'Jefferson',
  'Julio',
  'Leila',
  'Marketing',
  'PCP',
  'Produção',
  'Rafael',
  'Ricardo',
  'Rosana',
  'T.I',
  'Vendas',
] as const;

export const DESCRICOES: TipoDescricao[] = [
  'Entrega',
  'Visita',
  'Visita técnica',
  'Coleta',
  'Trocar Caçamba',
  'Boleto',
  'Reunião',
  'Outro'
];

export interface RegistroTerceiro {
  id: string;
  nome: string;
  data: string;
  horaEntrada: string;    // ISO timestamp string
  horaSaida?: string;     // ISO timestamp string (undefined = ainda dentro)
  minutosTrabalhados?: number;
}

// Prestadores de serviço terceirizados (ordem alfabética)
export const TERCEIROS = [
  'Adriano',
  'Ailton',
  'Alex',
  'Claudemir',
  'Dalvacy',
  'Diego',
  'Everton',
  'Márcio',
  'Nilton',
  'Romualdo',
  'Victor',
  'Victor Pinheiro',
  'Wesley',
] as const;

export interface Recebido {
  id: string;
  data: string;
  horaRegistro: string;
  remetente: string;
  destinatario: string;
  descricao: string;
  fotoBase64?: string;
}

export const DESTINATARIOS = RESPONSAVEIS;
