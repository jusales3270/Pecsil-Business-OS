/**
 * Plano de contas de EXEMPLO (N-04): enxuto, no formato de uma indústria, só para testar o motor sem misturar com o
 * plano oficial da empresa (que vem do escritório, pela ECD). Não é recomendação contábil: o plano oficial é do
 * contador. Já traz os papéis ligados, para a escrituração rodar de ponta a ponta no teste.
 */
import type { ContaImportada, Natureza } from "./ecd";

type Linha = [codigo: string, nome: string, natureza: Natureza];
const LINHAS: Linha[] = [
  ["1", "ATIVO", "ativo"],
  ["1.1", "ATIVO CIRCULANTE", "ativo"],
  ["1.1.1", "DISPONIBILIDADES", "ativo"],
  ["1.1.1.01", "Caixa", "ativo"],
  ["1.1.1.02", "Bancos conta movimento", "ativo"],
  ["1.1.2", "CRÉDITOS", "ativo"],
  ["1.1.2.01", "Clientes e outras contas a receber", "ativo"],
  ["1.1.2.02", "Tributos a recuperar", "ativo"],
  ["1.1.3", "ESTOQUES", "ativo"],
  ["1.1.3.01", "Matérias-primas e materiais", "ativo"],
  ["1.2", "ATIVO NÃO CIRCULANTE", "ativo"],
  ["1.2.1", "IMOBILIZADO", "ativo"],
  ["1.2.1.01", "Máquinas e equipamentos", "ativo"],
  ["1.2.1.02", "Benfeitorias e instalações", "ativo"],
  ["2", "PASSIVO", "passivo"],
  ["2.1", "PASSIVO CIRCULANTE", "passivo"],
  ["2.1.1", "OBRIGAÇÕES", "passivo"],
  ["2.1.1.01", "Fornecedores e outras contas a pagar", "passivo"],
  ["2.1.1.02", "Obrigações trabalhistas", "passivo"],
  ["2.1.1.03", "Tributos a recolher", "passivo"],
  ["2.1.1.04", "Empréstimos e financiamentos", "passivo"],
  ["3", "PATRIMÔNIO LÍQUIDO", "pl"],
  ["3.1", "CAPITAL E RESERVAS", "pl"],
  ["3.1.1", "CAPITAL", "pl"],
  ["3.1.1.01", "Capital social", "pl"],
  ["3.1.1.02", "Lucros ou prejuízos acumulados", "pl"],
  ["4", "RESULTADO", "resultado"],
  ["4.1", "RECEITAS", "resultado"],
  ["4.1.1", "RECEITA OPERACIONAL", "resultado"],
  ["4.1.1.01", "Receita de vendas de produtos", "resultado"],
  ["4.1.1.02", "Receita de serviços", "resultado"],
  ["4.1.2", "RECEITAS FINANCEIRAS", "resultado"],
  ["4.1.2.01", "Juros recebidos", "resultado"],
  ["4.1.2.02", "Descontos obtidos", "resultado"],
  ["4.1.2.03", "Multas recebidas", "resultado"],
  ["4.2", "CUSTOS E DESPESAS", "resultado"],
  ["4.2.1", "CUSTOS DE PRODUÇÃO", "resultado"],
  ["4.2.1.01", "Materiais aplicados", "resultado"],
  ["4.2.1.02", "Mão de obra direta", "resultado"],
  ["4.2.1.03", "Custos indiretos de fabricação", "resultado"],
  ["4.2.2", "DESPESAS OPERACIONAIS", "resultado"],
  ["4.2.2.01", "Despesas administrativas", "resultado"],
  ["4.2.2.02", "Despesas comerciais", "resultado"],
  ["4.2.2.03", "Despesas tributárias", "resultado"],
  ["4.2.3", "DESPESAS FINANCEIRAS", "resultado"],
  ["4.2.3.01", "Juros pagos", "resultado"],
  ["4.2.3.02", "Multas pagas", "resultado"],
  ["4.2.3.03", "Descontos concedidos", "resultado"],
  ["4.2.3.04", "Tarifas bancárias", "resultado"],
];

export function planoDeExemplo(): { contas: ContaImportada[]; vinculos: { origem: "papel"; chave: string; codigo: string }[] } {
  const superiores = new Set(LINHAS.map(([c]) => c.split(".").slice(0, -1).join(".")).filter(Boolean));
  const contas = LINHAS.map(([codigo, nome, natureza]) => {
    const partes = codigo.split(".");
    return { codigo, nome, natureza, tipo: superiores.has(codigo) ? "sintetica" : "analitica", nivel: partes.length, superior_codigo: partes.length > 1 ? partes.slice(0, -1).join(".") : null, referencial: null } as ContaImportada;
  });
  const papeis: [string, string][] = [
    ["contas_a_pagar", "2.1.1.01"], ["contas_a_receber", "1.1.2.01"], ["juros_pagos", "4.2.3.01"], ["multas_pagas", "4.2.3.02"],
    ["descontos_obtidos", "4.1.2.02"], ["juros_recebidos", "4.1.2.01"], ["multas_recebidas", "4.1.2.03"], ["descontos_concedidos", "4.2.3.03"],
  ];
  return { contas, vinculos: papeis.map(([chave, codigo]) => ({ origem: "papel" as const, chave, codigo })) };
}
