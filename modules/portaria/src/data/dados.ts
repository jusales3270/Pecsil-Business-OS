import type { Visita, ControleVeiculo, RegistroTerceiro, Recebido } from "../types";
import migrados from "./dados-migrados.json";

export const visitasIniciais: Visita[] = (migrados?.visitas as Visita[]) || [];
export const veiculosIniciais: ControleVeiculo[] = (migrados?.frota as ControleVeiculo[]) || [];
export const terceirosIniciais: RegistroTerceiro[] = (migrados?.terceiros as RegistroTerceiro[]) || [];
export const recebidosIniciais: Recebido[] = (migrados?.encomendas as Recebido[]) || [];
export const visitantesIniciais = migrados?.visitantes || [];

export const RESPONSAVEIS_INICIAIS = [
  "Compras",
  "Diretoria",
  "Engenharia",
  "Expedição",
  "Financeiro",
  "Fundição",
  "Manutenção",
  "Produção",
  "Qualidade",
  "RH",
  "Segurança do Trabalho",
  "TI",
  "Usinagem",
];
