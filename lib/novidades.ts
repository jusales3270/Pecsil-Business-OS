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
    id: "2026-10-08-notas-xml-pdf",
    data: "2026-10-08",
    area: "Fiscal e Almoxarifado",
    modulos: ["fiscal", "almoxarifado"],
    titulo: "Notas fiscais: envie o XML ou o PDF",
    itens: [
      "No Painel do ICMS, o botão Enviar notas aceita vários XML e DANFEs em PDF de uma vez: a plataforma lê, reconhece o fornecedor e mostra o que vai lançar antes de gravar.",
      "Nota que já está no painel não entra de novo, e o mesmo XML e PDF da mesma nota contam uma vez só.",
      "No Almoxarifado, o botão Enviar nota acha o pedido a caminho daquele fornecedor e abre o recebimento já preenchido.",
      "Quando a nota vem do PDF, os valores aparecem para conferência. Se o fornecedor do cadastro ainda não tem CNPJ, ele passa a ter o da nota.",
    ],
  },
  {
    id: "2026-10-08-financeiro-enviar-extrato",
    data: "2026-10-08",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Enviar extrato direto na plataforma",
    itens: [
      "Em Bancos e conciliação, o botão Enviar extrato aceita o OFX de qualquer banco, a planilha do Santander e o PDF do Itaú.",
      "A plataforma descobre o banco e a conta, confere os saldos de cada dia e mostra o que vai fazer antes de gravar: quantos lançamentos são novos, quantos já se conciliam sozinhos e quantos ficam para revisar.",
      "Mandar o mesmo arquivo de novo não duplica nada: ela avisa que o arquivo já foi enviado e grava só o que for novo.",
    ],
  },
  {
    id: "2026-10-06-financeiro-bancos-conciliacao",
    data: "2026-10-06",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Bancos e conciliação com o extrato do Itaú",
    itens: [
      "A aba Bancos e conciliação agora mostra o saldo real da conta e todos os lançamentos do extrato do banco.",
      "Cada lançamento aparece como A conciliar, Conciliado ou Ignorado. Os que já têm pagamento registrado foram ligados sozinhos quando a data e o valor batem.",
      "Em cada pendência: Conciliar (escolhe o pagamento certo entre as sugestões), Criar conta (para tarifas, tributos, folha e o que ainda não foi lançado), Ignorar ou Desfazer.",
      "Nada é ligado sem a sua confirmação. Transferências entre contas da empresa e antecipação de recebíveis ficam à parte e não entram como receita.",
    ],
  },
  {
    id: "2026-10-02-financeiro-historico-a-revisar",
    data: "2026-10-02",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Contas a pagar enxuto e Histórico a revisar",
    itens: [
      "O que foi pago antes de 2026 e não é parcelamento saiu das telas e dos totais. Fica guardado e pode voltar.",
      "Nova aba Histórico a revisar: cada parcelamento ou financiamento vindo do sistema antigo aparece com o início, as parcelas pagas e as que faltam.",
      "Em cada um: Aprovar (sobe para o Contas a pagar), Editar (corrige fornecedor, conta e parcelas) ou Excluir (tira do Financeiro).",
      "Novo filtro de data no Contas a pagar e no Contas a receber: escolha um dia e veja o que vence nele (ou, na aba Pagas/Recebidas, o que foi pago ou recebido naquele dia).",
    ],
  },
  {
    id: "2026-10-01-almoxarifado",
    data: "2026-10-01",
    area: "Almoxarifado",
    modulos: ["almoxarifado"],
    titulo: "Novo módulo Almoxarifado",
    itens: [
      "Peça o material que está faltando direto ao Compras, com urgência quando for o caso. Você acompanha cada passo: em cotação, aprovado, comprado.",
      "Em A caminho ficam as compras já avisadas. Quando o material chegar, clique em Receber, anexe o XML da nota (ou digite) e confira os itens.",
      "Ao confirmar, a nota vira conta a pagar para o Financeiro, com os vencimentos certos, e entra no Painel do ICMS. Sem planilha.",
    ],
  },
  {
    id: "2026-10-01-fiscal-icms",
    data: "2026-10-01",
    area: "Fiscal",
    modulos: ["fiscal"],
    titulo: "Painel do ICMS",
    itens: [
      "As notas de entrada do mês com crédito de ICMS e IPI, por centro (Fundição, Usinagem, Administrativo), no lugar da planilha.",
      "As notas recebidas no Almoxarifado entram sozinhas. As do administrativo e de terceiros entram em Nova nota, com o XML ou digitadas.",
      "Marque XML, lançamento e autorização em um clique, e registre o livro de apuração do mês.",
    ],
  },
  {
    id: "2026-10-01-compras-pedidos-almoxarifado",
    data: "2026-10-01",
    area: "Compras",
    modulos: ["compras"],
    titulo: "Pedidos do Almoxarifado no Compras",
    itens: [
      "Nova aba Pedidos do Almoxarifado: o material que está faltando chega aqui, e Cotar abre a cotação já com os itens.",
      "O Comprar virou Aviso de compra: a nota fiscal não é mais exigida nessa hora, o Almoxarifado lança quando o material chegar.",
      "Ao dar o aviso de compra, o Financeiro e o Almoxarifado são avisados sozinhos.",
    ],
  },
  {
    id: "2026-10-01-avisos-no-sino",
    data: "2026-10-01",
    area: "Plataforma",
    titulo: "Avisos no sino",
    itens: [
      "O sino do topo mostra os avisos dos fluxos em que você participa, com o número de não lidos. Clique no aviso para ir direto à tela certa.",
    ],
  },
  {
    id: "2026-09-30-financeiro-historico-pagar",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Histórico de contas pagas desde 2016",
    itens: [
      "Contas a pagar recebeu o histórico do sistema antigo de 2016 em diante (fornecedores de A até BOL): mais de 10 mil títulos, quase todos já pagos, com data e valor do pagamento.",
      "Nova aba Histórico a conferir: títulos antigos que o sistema antigo ainda mostrava em aberto. Ficam fora do total a pagar, do painel e do fluxo até a equipe conferir cada um: registrar o pagamento, cancelar ou Manter em aberto.",
      "Pagamento feito com desconto aparece quitado, com o desconto registrado.",
    ],
  },
  {
    id: "2026-09-30-financeiro-painel-graficos",
    data: "2026-09-30",
    area: "Financeiro",
    modulos: ["financeiro"],
    titulo: "Painel do Financeiro com gráficos",
    itens: [
      "Novo gráfico de pagamentos, recebimentos e resultado mês a mês, comparado com o ano anterior quando houver lançamentos.",
      "Gráfico do que está a receber e a pagar por mês de vencimento. Passe o mouse para ver o valor de cada mês.",
      "Comparação do mês atual com o anterior, com a variação em porcentagem.",
      "O anel de A receber e a pagar foi redesenhado e o saldo agora cabe dentro dele.",
      "Ações que exigem atenção agora ficam abaixo dos gráficos.",
      "As seções do Financeiro (Contas a pagar, Plano de contas, Relatórios…) também aparecem no menu lateral, abaixo de Financeiro.",
      "A aba Plano de contas aparece para todos do Financeiro, para consulta. Incluir, editar, mover e excluir contas continua com quem tem a permissão Plano de contas.",
      "O painel e o relatório de gasto por conta abrem rápido com todos os títulos carregados, e o relatório mostra o ano inteiro.",
    ],
  },
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
