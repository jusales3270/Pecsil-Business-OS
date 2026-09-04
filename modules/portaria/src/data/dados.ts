import type { Visita, ControleVeiculo, RegistroTerceiro, Recebido } from "../types";

export const visitasIniciais: Visita[] = [
  {
    id: "vis-001",
    data: new Date().toISOString().split("T")[0],
    empresa: "Gerdau Aços Especiais",
    visitante: "Carlos Eduardo Silva",
    horarioEntrada: "08:30",
    horarioSaida: "11:45",
    documento: "28.491.820-1",
    contato: "(11) 98765-4321",
    responsavel: "Compras",
    placaVeiculo: "BRA2E19",
    notasFiscais: [{ numero: "001842", valor: 14500.0 }],
    descricao: "Entrega",
  },
  {
    id: "vis-002",
    data: new Date().toISOString().split("T")[0],
    empresa: "Romi S.A.",
    visitante: "Fernando Martins",
    horarioEntrada: "09:15",
    horarioSaida: "",
    documento: "33.109.482-9",
    contato: "(19) 99123-8877",
    responsavel: "Fundição",
    placaVeiculo: "EZY8891",
    notasFiscais: [{ numero: "049812", valor: 3200.0 }],
    descricao: "Visita técnica",
  },
  {
    id: "vis-003",
    data: new Date().toISOString().split("T")[0],
    empresa: "Mercobronze",
    visitante: "Marcos Vinicius",
    horarioEntrada: "10:00",
    horarioSaida: "",
    documento: "41.982.100-3",
    contato: "(11) 97711-2233",
    responsavel: "Usinagem",
    placaVeiculo: "FGH4412",
    notasFiscais: [{ numero: "019482", valor: 78066.72 }],
    descricao: "Entrega",
  },
];

export const veiculosIniciais: ControleVeiculo[] = [
  {
    id: "frota-001",
    data: new Date().toISOString().split("T")[0],
    motorista: "Dalvaci",
    veiculo: "STRADA FLX5966",
    horarioSaida: "07:45",
    dataRetorno: new Date().toISOString().split("T")[0],
    horarioRetorno: "10:30",
    kmSaida: 124500,
    kmEntrada: 124580,
    kmRodados: 80,
    destino: "Campinas - Retirada de Matéria-Prima",
    notasFiscais: [{ numero: "009412", valor: 5400.0 }],
  },
  {
    id: "frota-002",
    data: new Date().toISOString().split("T")[0],
    motorista: "João",
    veiculo: "VW 11.180 DRC BZK6I78",
    horarioSaida: "08:15",
    dataRetorno: "",
    horarioRetorno: "",
    kmSaida: 89300,
    kmEntrada: 0,
    kmRodados: 0,
    destino: "São Paulo - Entrega de Peças Usinadas",
    notasFiscais: [{ numero: "010582", valor: 63856.04 }],
  },
];

export const terceirosIniciais: RegistroTerceiro[] = [
  {
    id: "terc-001",
    nome: "Márcio",
    data: new Date().toISOString().split("T")[0],
    horaEntrada: `${new Date().toISOString().split("T")[0]}T07:30:00.000Z`,
    horaSaida: `${new Date().toISOString().split("T")[0]}T12:00:00.000Z`,
    minutosTrabalhados: 270,
  },
  {
    id: "terc-002",
    nome: "Everton",
    data: new Date().toISOString().split("T")[0],
    horaEntrada: `${new Date().toISOString().split("T")[0]}T08:00:00.000Z`,
  },
];

export const recebidosIniciais: Recebido[] = [
  {
    id: "rec-001",
    data: new Date().toISOString().split("T")[0],
    horaRegistro: "09:40",
    remetente: "Mercado Livre - Fornecedor de EPIs",
    destinatario: "Almoxarifado",
    descricao: "Caixa contendo 20 pares de luvas e óculos de proteção.",
  },
  {
    id: "rec-002",
    data: new Date().toISOString().split("T")[0],
    horaRegistro: "10:15",
    remetente: "Correios / Sedex",
    destinatario: "Diretoria",
    descricao: "Envelope timbrado com documentação contratual.",
  },
];
