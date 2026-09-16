import type { Visita, ControleVeiculo, RegistroTerceiro, Recebido } from "../types";
// O histórico migrado do Cloud (dados-migrados.json, ~23 MB) vive no banco da
// Pecsil — importado por `scripts/import-portaria-json.mjs`. Não é mais embutido
// no bundle do navegador; sem conexão, a Portaria usa o cache local.
export const visitasIniciais: Visita[] = [];
export const veiculosIniciais: ControleVeiculo[] = [];
export const terceirosIniciais: RegistroTerceiro[] = [];
export const recebidosIniciais: Recebido[] = [];

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
