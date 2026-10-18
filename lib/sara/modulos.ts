/**
 * A SARA de cada módulo (docs/PLANO-SARA.md): o manual (como o módulo funciona, onde fica cada coisa)
 * e as ferramentas que ela pode oferecer. As de outros módulos entram só para quem tem a credencial.
 */

/** Tela que a SARA pode abrir para a pessoa (só se ela tiver a funcionalidade). */
export type Tela = { id: string; modulo: string; secao?: string; rotulo: string; exige: string[]; serve: string };
export type SaraModulo = { modulo: string; nome: string; feature: string; manual: string; ferramentas: string[]; telas: Tela[]; sugestoes: string[] };

const TELAS_FINANCEIRO: Tela[] = [
  { id: "financeiro_painel", modulo: "financeiro", secao: "Painel", rotulo: "Financeiro › Painel", exige: ["financeiro.pagar", "financeiro.receber", "financeiro.fluxo", "financeiro.relatorios"], serve: "totais e gráficos do mês" },
  { id: "contas_a_pagar", modulo: "financeiro", secao: "Contas a pagar", rotulo: "Financeiro › Contas a pagar", exige: ["financeiro.pagar"], serve: "títulos a pagar, aprovar, dar baixa, estornar" },
  { id: "contas_a_receber", modulo: "financeiro", secao: "Contas a receber", rotulo: "Financeiro › Contas a receber", exige: ["financeiro.receber"], serve: "títulos a receber e baixas" },
  { id: "fluxo_de_caixa", modulo: "financeiro", secao: "Fluxo de caixa", rotulo: "Financeiro › Fluxo de caixa", exige: ["financeiro.fluxo", "financeiro.relatorios"], serve: "próximos 90 dias em cenários e o ano por mês" },
  { id: "bancos", modulo: "financeiro", secao: "Bancos e conciliação", rotulo: "Financeiro › Bancos e conciliação", exige: ["financeiro.bancos"], serve: "importar extrato e conciliar" },
  { id: "centros_de_custo", modulo: "financeiro", secao: "Centros de custo", rotulo: "Financeiro › Centros de custo", exige: ["financeiro.centros"], serve: "gasto por centro" },
  { id: "plano_de_contas", modulo: "financeiro", secao: "Plano de contas", rotulo: "Financeiro › Plano de contas", exige: ["financeiro.pagar", "financeiro.receber", "financeiro.plano"], serve: "contas do plano" },
  { id: "relatorios", modulo: "financeiro", secao: "Relatórios", rotulo: "Financeiro › Relatórios", exige: ["financeiro.relatorios"], serve: "relatórios e gasto por conta" },
  { id: "homologacao_alcadas", modulo: "financeiro", secao: "Homologação", rotulo: "Financeiro › Homologação (aba Alçadas)", exige: ["financeiro.homologacao"], serve: "alçadas: quem aprova cada faixa de valor" },
  // De outros módulos: só abre para quem tem a credencial de lá.
  { id: "compras_realizadas", modulo: "compras", secao: "compras", rotulo: "Compras › Compras realizadas", exige: ["compras.realizadas"], serve: "compras efetivadas com nota" },
  { id: "notas_emitidas", modulo: "fiscal", secao: "Notas emitidas", rotulo: "Fiscal › Notas emitidas", exige: ["fiscal.nfe"], serve: "NF-e emitidas (a última nota, a DANFE)" },
  { id: "notas_recebidas", modulo: "fiscal", secao: "Notas recebidas", rotulo: "Fiscal › Notas recebidas", exige: ["fiscal.icms", "fiscal.nfe"], serve: "notas de fornecedores vindas da SEFAZ" },
];

const FINANCEIRO = `Você é a SARA do módulo Financeiro do Business OS.
Seções do módulo:
- Painel: totais do mês, gráficos de entradas e saídas.
- Contas a pagar e Contas a receber: títulos por fornecedor/cliente, com parcelas. Filtros: Em aberto, Vencidos, A vencer, Em aprovação, Revisar, Cancelados; busca por nome, documento ou histórico. Aprovar (alçadas por faixa de valor), dar baixa (integral ou parcial, com estorno), cancelar.
- Fluxo de caixa: abre nos próximos 90 dias (saldo dos bancos pelo extrato + parcelas em aberto, três cenários com as regras à vista; dá para ajustar as regras e digitar o saldo de hoje de uma conta com extrato atrasado, sem gravar). "Por mês" mostra o ano.
- Bancos e conciliação: importar extrato (OFX, planilha do Santander, PDF do Itaú); a conciliação sugere pares por CNPJ, valor e nome e explica por que uma linha não casa; nada é conciliado sem a pessoa marcar.
- Centros de custo, Plano de contas, Relatórios.
- Alçadas: quem aprova cada faixa de valor ficam em Financeiro › Homologação, aba Alçadas.
Guias do escritório contábil (DARF, DAS, GARE, FGTS…) chegam pelo Portal do escritório e entram como conta a pagar em aprovação.
Compra aprovada no Compras vira conta a pagar quando a nota é recebida no Almoxarifado.`;

export const SARAS: Record<string, SaraModulo> = {
  financeiro: {
    modulo: "financeiro", nome: "SARA do Financeiro", feature: "financeiro", manual: FINANCEIRO,
    ferramentas: ["contas_a_pagar", "contas_a_receber", "buscar_contas_a_pagar", "buscar_contas_a_receber", "abrir_lancamento", "fluxo_de_caixa_90_dias", "bancos_e_conciliacao", "compras_aprovadas_a_pagar"],
    telas: TELAS_FINANCEIRO,
    sugestoes: ["O que está vencido a pagar?", "Como fica o caixa nos próximos 90 dias?", "Quais compras aprovadas ainda vão virar conta a pagar?", "Como dou baixa parcial numa conta?"],
  },
};

/** Instruções fixas (iguais em todo módulo). */
export const REGRAS_SARA = `Regras:
- Responda em português do Brasil, curto e direto, para quem trabalha na empresa (sem jargão de TI).
- Todo número novo que você citar tem de vir de uma ferramenta. Se não tiver ferramenta para responder, diga que não tem acesso a esse dado e onde a pessoa encontra na plataforma.
- Os números das suas respostas anteriores nesta conversa já vieram de consultas: não os reconfirme nem volte a eles, a menos que a pessoa peça. Responda só o que ela perguntou agora.
- Você só CONSULTA. Não aprova, não dá baixa, não grava nada: quando a pessoa quiser fazer algo, explique o caminho e abra a tela para ela com a ferramenta abrir_tela.
- Quando a pessoa pedir para ver algo ("onde está…", "me mostra…"), abra a tela certa com abrir_tela, além de responder.
- Quando ela pedir um lançamento específico ("me mostre o último lançamento do financiamento da Grob"), ache-o com a busca e abra o lançamento exato com abrir_lancamento. Diga qual você abriu (fornecedor, histórico, data e valor) e, se "último" puder ser outro (o último pago ou a última parcela prevista), diga qual escolheu e ofereça o outro.
- Se uma ferramenta não estiver disponível, é porque a pessoa não tem essa permissão: diga isso com naturalidade, sem tentar contornar.
- Valores em reais no formato brasileiro (R$ 1.234,56) e datas em dd/mm/aaaa.
- Não invente regra da empresa. Quando a decisão é de uma pessoa ou área (aprovação, alçada, classificação), diga quem decide.`;
