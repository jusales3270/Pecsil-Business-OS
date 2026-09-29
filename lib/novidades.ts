/**
 * Novidades de cada versão, mostradas quando a pessoa clica em "Atualizar".
 *
 * Toda entrega que muda algo visível ganha uma entrada NO TOPO desta lista,
 * escrita para quem usa a plataforma (sem termo técnico). O `id` nunca muda:
 * o app aberto compara os ids que já conhece com os da versão nova no
 * servidor, e mostra só o que é novo para aquela pessoa.
 */

export type Novidade = {
  /** Único e estável (ex.: "2026-09-29-sugestoes"). */
  id: string;
  /** Data da publicação, AAAA-MM-DD. */
  data: string;
  /** Onde mudou (ex.: "Compras", "RH", "Plataforma"). */
  area: string;
  titulo: string;
  itens: string[];
};

export const NOVIDADES: Novidade[] = [
  {
    id: "2026-09-29-portaria-facial",
    data: "2026-09-29",
    area: "Portaria",
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
