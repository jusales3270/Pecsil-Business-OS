/**
 * Novidades de cada versão, mostradas quando a pessoa clica em "Atualizar".
 *
 * Toda entrega que muda algo visível ganha uma entrada NO TOPO desta lista,
 * escrita para quem usa a plataforma (sem termo técnico). O `id` nunca muda:
 * o app aberto compara os ids que já conhece com os da versão nova no
 * servidor, e mostra só o que é novo para aquela pessoa.
 *
 * `modulos` diz a quem interessa: só quem tem acesso a um desses módulos vê
 * a novidade (quem é do RH não é avisado do Financeiro). Sem `modulos`, vale
 * para todos (mudança da plataforma inteira).
 */
import { hasModuleAccess, type AccessGrants } from "../modules/access-catalog";

export type Novidade = {
  /** Único e estável (ex.: "2026-09-29-sugestoes"). */
  id: string;
  /** Data da publicação, AAAA-MM-DD. */
  data: string;
  /** Onde mudou (ex.: "Compras", "RH", "Plataforma"). */
  area: string;
  /** Códigos dos módulos a quem interessa (ex.: ["compras"]). Vazio: todos. */
  modulos?: string[];
  titulo: string;
  itens: string[];
};

export const NOVIDADES: Novidade[] = [
  {
    id: "2026-09-30-financeiro-contas-a-pagar",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Contas a pagar, fluxo de caixa e gasto por conta",
    itens: [
      "Contas a pagar por fornecedor, com as abas A pagar, Previsões e Pagas (por mês). Filtros de situação, mês de vencimento e fornecedor.",
      "Registrar pagamento ou recebimento com data e valor: aceita baixa parcial, e o que passar do valor entra como juros ou tarifa.",
      "Fluxo de caixa do ano, mês a mês: o que já entrou e saiu, o que está em aberto e as previsões à parte.",
      "Novo relatório Gasto por conta do plano: custos, despesas e investimentos por mês, pelo rateio de cada título.",
      "Todo título a pagar pode ser editado por quem opera e excluído por quem aprova.",
    ],
  },
  {
    id: "2026-09-30-financeiro-contas-a-receber",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Contas a receber por cliente, com previsão separada",
    itens: [
      "Contas a receber agrupado por cliente, com total em aberto, vencido e a vencer de cada grupo.",
      "Duas abas: A receber (nota emitida) e Previsões (orçamento sem nota ou duplicata já antecipada). Previsão não entra no total, no painel nem no fluxo de caixa.",
      "Busca por cliente, documento, histórico ou conta; filtros de situação e de grupo.",
      "Cada título abre com histórico, observação e a conta do plano (ou o rateio, quando são duas contas). Quem tem permissão confirma o recebimento ou cancela o título ali mesmo.",
      "Todo título pode ser editado (cliente, valor, vencimento, conta, observação, previsão) por quem opera, e excluído por quem aprova.",
      "A situação Vencido sai da data de vencimento, sem precisar ajustar à mão.",
    ],
  },
  {
    id: "2026-09-30-financeiro-plano-de-contas",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Plano de contas",
    itens: [
      "Nova seção Plano de contas no Financeiro, com as 318 contas do sistema atual e os mesmos códigos.",
      "Busca por código ou nome, grupos que abrem e fecham e o tipo de cada conta (receita, custo, despesa, investimento, repasse).",
      "Quem tem permissão inclui, edita, inativa e exclui contas.",
      "Para realocar, segure a conta e arraste até o grupo: ela assume o próximo código daquele grupo, e as outras contas não mudam.",
    ],
  },
  {
    id: "2026-09-29-janelas-centrais",
    data: "2026-09-29",
    area: "Plataforma",
    titulo: "Janelas que não fecham sozinhas",
    itens: [
      "Fichas, detalhes e cadastros (RH, Financeiro, Compras, Portaria e demais) abrem no centro da tela.",
      "Clicar fora da janela não fecha mais: nada do que está sendo digitado se perde. Para fechar, use o X, Cancelar ou a tecla Esc.",
    ],
  },
  {
    id: "2026-09-29-rh-sst-validade",
    data: "2026-09-29",
    area: "RH",
    modulos: ["rh"],
    titulo: "Exames e treinamentos mudam de situação sozinhos",
    itens: [
      "A situação de ASOs e treinamentos agora sai da data de vencimento, sem precisar ajustar à mão.",
      "Vence em até 60 dias: A vencer · Atenção (mostra quantos dias faltam). Vencido: Crítico. Mais de 60 dias: Conforme · Regular.",
      "Para renovar, use \"Registrar nova validade\" no registro e informe a nova data.",
    ],
  },
  {
    id: "2026-09-29-portaria-facial",
    data: "2026-09-29",
    area: "Portaria",
    modulos: ["portaria"],
    titulo: "Reconhecimento facial corrigido",
    itens: [
      "Buscar Visitante (Auto-preencher) volta a reconhecer a pessoa da foto e preenche nome, empresa, documento e contato.",
      "Quando o rosto parece com mais de uma pessoa, a tela pergunta \"É uma destas?\" para você escolher.",
      "A foto tirada só para buscar não é mais guardada; só a foto de cadastro de quem vem pela primeira vez.",
    ],
  },
  {
    id: "2026-09-29-novidades",
    data: "2026-09-29",
    area: "Plataforma",
    titulo: "O que mudou, a cada atualização",
    itens: [
      "Ao clicar em Atualizar, esta janela mostra o que a nova versão traz antes de recarregar.",
    ],
  },
  {
    id: "2026-09-29-sugestoes",
    data: "2026-09-29",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Sugestões ao digitar fornecedor e produto",
    itens: [
      "Na cotação, a partir da 2ª letra o campo Fornecedor sugere os fornecedores cadastrados; nomes antigos já unificados levam ao nome certo.",
      "O campo Produto sugere as descrições do histórico, na grafia mais usada, com o último preço pago; os produtos que já vieram do fornecedor aparecem primeiro.",
      "Escolher o produto também preenche a unidade.",
      "Em Novo fornecedor, quem já existe aparece na lista e abre o cadastro, sem duplicar.",
    ],
  },
  {
    id: "2026-09-29-fornecedores",
    data: "2026-09-29",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Fornecedores: cadastro e histórico de compras",
    itens: [
      "Nova aba Fornecedores dentro de Compras (também no menu lateral), com total comprado, compras, cotações e última compra de cada fornecedor.",
      "Em cada fornecedor: as compras com NF, as cotações, o preço pago em cada produto ao longo do tempo e o cadastro completo (contato, endereço, prazo de pagamento).",
      "Nomes escritos de jeitos diferentes aparecem como possíveis duplicados, para unificar em um clique.",
    ],
  },
  {
    id: "2026-09-29-compras-oficial",
    data: "2026-09-29",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Compras oficial na plataforma",
    itens: [
      "Todas as cotações e compras do app antigo foram trazidas para cá; o Compras oficial agora é este.",
      "O valor unitário aceita 3 casas decimais (ex.: 17,905).",
      "Diretores veem a tela de Gestor; gerentes, assistentes e estagiários, a de Orçamentista.",
      "Aprovar aparece em verde e rejeitar em vermelho, e o sino de avisos voltou a aparecer.",
    ],
  },
  {
    id: "2026-09-28-visual",
    data: "2026-09-28",
    area: "Plataforma",
    titulo: "Visual",
    itens: [
      "A aba selecionada fica destacada em azul em todos os módulos.",
      "A Portaria acompanha o modo escuro.",
      "Logos novas para o modo claro e o modo escuro.",
    ],
  },
];

/** O que a versão nova traz que esta versão aberta ainda não tem. */
export function novidadesNovas(doServidor: readonly Novidade[], conhecidas: readonly Novidade[]): Novidade[] {
  const ids = new Set(conhecidas.map((n) => n.id));
  return doServidor.filter((n) => !ids.has(n.id));
}

export type AcessoNovidades = { isOwner: boolean; grants: AccessGrants };

/** Só o que interessa a esta pessoa: novidades dos módulos a que ela tem acesso. */
export function novidadesPara(lista: readonly Novidade[], acesso: AcessoNovidades): Novidade[] {
  return lista.filter((n) => !n.modulos?.length || n.modulos.some((m) => hasModuleAccess(acesso, m)));
}
