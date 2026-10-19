/**
 * Catálogo de eventos entre módulos.
 *
 * Cada módulo ANUNCIA o que acontece; por enquanto ninguém reage — as reações
 * entre departamentos vêm quando cada processo for mapeado
 * (docs/PROCESSOS-PECSIL.md). Os eventos são emitidos por gatilhos no banco
 * (supabase/migrations/202609210001_module_events.sql e
 * 202609210002_master_data.sql); o teste tests/event-catalog.test.mjs garante
 * que todo tipo emitido lá está descrito aqui.
 */

export interface EventType {
  type: string;
  module: string;
  label: string;
  description: string;
}

export const EVENT_MODULES: Record<string, string> = {
  comercial: "Comercial",
  compras: "Compras",
  rh: "Recursos Humanos",
  financeiro: "Financeiro",
  portaria: "Portaria & Acesso",
  acesso: "Acessos",
  cadastros: "Cadastros",
  producao: "Produção",
  almoxarifado: "Almoxarifado",
  fundicao: "Fundição",
  fiscal: "Fiscal",
  ti: "TI",
  fundacao: "Fundação",
};

export const EVENT_CATALOG: readonly EventType[] = [
  { type: "comercial.email.recebido", module: "comercial", label: "E-mail recebido", description: "Mensagem registrada numa das caixas monitoradas." },
  { type: "comercial.email.classificado", module: "comercial", label: "E-mail classificado", description: "O e-mail foi classificado (pedido, cobrança, dúvida ou outro) pelo Jev ou por uma pessoa." },
  { type: "comercial.card.criado", module: "comercial", label: "Card criado", description: "Um pedido, cobrança ou dúvida entrou no funil." },
  { type: "comercial.card.movido", module: "comercial", label: "Card movido", description: "O card mudou de etapa no funil." },
  { type: "comercial.card.ganho", module: "comercial", label: "Card ganho", description: "O card foi fechado como ganho." },
  { type: "comercial.card.perdido", module: "comercial", label: "Card perdido", description: "O card foi fechado como perdido, com motivo." },
  { type: "comercial.orcamento.ganho", module: "comercial", label: "Orçamento ganho", description: "O cliente aprovou o orçamento (com o pedido de compra e a cotação anexados); vira previsão a receber." },
  { type: "comercial.orcamento.perdido", module: "comercial", label: "Orçamento perdido", description: "O orçamento foi fechado como perdido, com motivo." },
  { type: "compras.cotacao.criada", module: "compras", label: "Cotação lançada", description: "Uma cotação entrou para aprovação." },
  { type: "compras.cotacao.aprovada", module: "compras", label: "Cotação aprovada (virou OC)", description: "A cotação foi aprovada (total ou parcialmente) e passou a ser a OC de mesmo número." },
  { type: "compras.cotacao.rejeitada", module: "compras", label: "Cotação rejeitada", description: "A cotação foi rejeitada." },
  { type: "compras.cotacao.reaberta", module: "compras", label: "Cotação reaberta", description: "A cotação voltou para aprovação." },
  { type: "compras.cotacao.comprada", module: "compras", label: "OC comprada", description: "A OC virou compra." },
  { type: "compras.direta.registrada", module: "compras", label: "Compra direta registrada", description: "Compra sem cotação, autorizada pela diretoria, que já nasce como OC (pela nota recebida ou lançada pelo Compras)." },
  { type: "compras.compra.registrada", module: "compras", label: "Compra registrada", description: "Compra efetivada com nota fiscal." },
  { type: "almoxarifado.solicitacao.criada", module: "almoxarifado", label: "Material pedido", description: "O Almoxarifado pediu material ao Compras." },
  { type: "almoxarifado.recebimento.confirmado", module: "almoxarifado", label: "Material recebido", description: "Nota fiscal lançada no recebimento: virou conta a pagar e entrou no Painel do ICMS." },
  { type: "almoxarifado.solicitacao.cancelada", module: "almoxarifado", label: "Pedido de material cancelado", description: "O pedido de material foi cancelado antes da compra." },
  { type: "fundicao.pedido.criado", module: "fundicao", label: "Material pedido pela Fundição", description: "A Fundição pediu material ao Compras pelo painel dela." },
  { type: "fundicao.pedido.cancelado", module: "fundicao", label: "Pedido da Fundição cancelado", description: "O pedido de material da Fundição foi cancelado antes da compra." },
  { type: "fundacao.coleta.acesso_concedido", module: "fundacao", label: "Acesso a pasta concedido", description: "Alguém credenciado concedeu acesso a uma pasta do computador para a coleta de arquivos." },
  { type: "fundacao.coleta.concluida", module: "fundacao", label: "Coleta de arquivos concluída", description: "Uma coleta terminou: arquivos lidos, repetidos e guardados nos setores." },
  { type: "fundacao.documento.enviado", module: "fundacao", label: "Documento guardado", description: "Um documento foi guardado na pasta de um setor (enviado à mão ou original de extrato/nota)." },
  { type: "fundacao.sugestao.decidida", module: "fundacao", label: "Sugestão da IA decidida", description: "Alguém aceitou, recusou, corrigiu ou ignorou uma sugestão do modelo de decisão." },
  { type: "ti.ativo.cadastrado", module: "ti", label: "Equipamento cadastrado", description: "Novo equipamento no inventário de TI." },
  { type: "ti.ativo.alterado", module: "ti", label: "Equipamento alterado", description: "Dados ou situação de um equipamento do inventário de TI mudaram." },
  { type: "ti.incidente.registrado", module: "ti", label: "Queda registrada", description: "O vigia externo registrou uma queda (servidor, backup ou internet), ou a TI registrou um incidente à mão." },
  { type: "ti.incidente.confirmado", module: "ti", label: "Causa da queda confirmada", description: "A TI confirmou a causa de uma queda (energia, internet, servidor…)." },
  { type: "ti.chamado.aberto", module: "ti", label: "Chamado de TI aberto", description: "Alguém da empresa abriu um chamado para a TI." },
  { type: "ti.chamado.resolvido", module: "ti", label: "Chamado de TI resolvido", description: "A TI resolveu um chamado (com a solução e se foi no prazo)." },
  { type: "ti.regras.alteradas", module: "ti", label: "Regras dos chamados revisadas", description: "As categorias e os prazos dos chamados de TI mudaram." },
  { type: "producao.os.aberta", module: "producao", label: "OS aberta", description: "Uma OS do Forja passou a existir no Business OS." },
  { type: "producao.os.status", module: "producao", label: "OS mudou de situação", description: "A OS mudou de status no Forja (em produção, finalizada, atrasada…)." },
  { type: "producao.entrada.registrada", module: "producao", label: "Entrada de produção", description: "Peças de um orçamento ganho ficaram prontas e liberadas para faturar." },
  { type: "fiscal.config.alterada", module: "fiscal", label: "Configuração fiscal alterada", description: "Dados do emitente, ambiente, série ou a busca das notas na SEFAZ mudaram." },
  { type: "fiscal.certificado.enviado", module: "fiscal", label: "Certificado digital enviado", description: "O proprietário enviou (ou trocou) o certificado A1; o arquivo e a senha ficam no cofre." },
  { type: "fiscal.certificado.removido", module: "fiscal", label: "Certificado digital removido", description: "O certificado saiu do cofre; a busca na SEFAZ foi desligada." },
  { type: "fiscal.dfe.recebida", module: "fiscal", label: "Nota recebida da SEFAZ", description: "A SEFAZ registrou uma nota emitida contra o CNPJ da empresa." },
  { type: "fiscal.dfe.cancelada", module: "fiscal", label: "Nota recebida cancelada", description: "O emitente cancelou na SEFAZ uma nota emitida contra a empresa (avisa se ela já estava no Painel do ICMS)." },
  { type: "fiscal.competencia.enviada", module: "fiscal", label: "Competência enviada ao escritório", description: "A empresa marcou o fechamento do mês como pronto para o escritório de contabilidade." },
  { type: "fiscal.competencia.conferida", module: "fiscal", label: "Competência conferida", description: "O escritório de contabilidade conferiu o fechamento do mês." },
  { type: "fiscal.competencia.fechada", module: "fiscal", label: "Competência fechada", description: "O fechamento do mês foi encerrado pela empresa." },
  { type: "fiscal.malote.registrado", module: "fiscal", label: "Malote enviado", description: "A empresa registrou o envio de um malote de documentos ao escritório." },
  { type: "fiscal.malote.recebido", module: "fiscal", label: "Malote recebido", description: "O escritório confirmou o recebimento de um malote." },
  { type: "fiscal.pendencia.aberta", module: "fiscal", label: "Pendência com o escritório", description: "Uma pendência foi aberta no portal (pela empresa ou pelo escritório)." },
  { type: "producao.os.faturada", module: "producao", label: "OS faturada", description: "A OS recebeu número de nota fiscal." },
  { type: "rh.colaborador.admitido", module: "rh", label: "Colaborador cadastrado", description: "Novo colaborador no quadro." },
  { type: "rh.colaborador.desligado", module: "rh", label: "Colaborador desligado", description: "O colaborador deixou o quadro." },
  { type: "rh.colaborador.reativado", module: "rh", label: "Colaborador reativado", description: "O colaborador voltou ao quadro." },
  { type: "rh.terceiro.incluido", module: "rh", label: "Terceiro incluído", description: "O RH incluiu um prestador no quadro de terceiros da Portaria." },
  { type: "rh.terceiro.excluido", module: "rh", label: "Terceiro excluído", description: "O RH tirou um prestador do quadro de terceiros da Portaria." },
  { type: "rh.ausencia.aprovada", module: "rh", label: "Ausência aprovada", description: "Férias, folga ou licença aprovada." },
  { type: "rh.ausencia.reprovada", module: "rh", label: "Ausência reprovada", description: "Solicitação de ausência reprovada." },
  { type: "financeiro.titulo.criado", module: "financeiro", label: "Título criado", description: "Conta a pagar ou a receber lançada." },
  { type: "financeiro.titulo.aprovado", module: "financeiro", label: "Título aprovado", description: "Título aprovado para pagamento ou cobrança." },
  { type: "financeiro.titulo.baixado", module: "financeiro", label: "Título quitado", description: "Pagamento ou recebimento concluído." },
  { type: "financeiro.titulo.alterado", module: "financeiro", label: "Título alterado", description: "Valor, cliente, documento, conta ou previsão de um título alterados." },
  { type: "financeiro.titulo.excluido", module: "financeiro", label: "Título excluído", description: "Título a pagar ou a receber apagado." },
  { type: "financeiro.titulo.cancelado", module: "financeiro", label: "Título cancelado", description: "Título a pagar ou a receber cancelado." },
  { type: "financeiro.revisao.aprovada", module: "financeiro", label: "Histórico aprovado", description: "Parcelamento ou lançamento antigo revisado e mantido no Contas a pagar." },
  { type: "financeiro.revisao.excluida", module: "financeiro", label: "Histórico excluído", description: "Parcelamento ou lançamento antigo retirado do Financeiro na revisão." },
  { type: "financeiro.revisao.editada", module: "financeiro", label: "Histórico editado", description: "Dados ou parcelas de um parcelamento antigo corrigidos na revisão." },
  { type: "financeiro.carga.concluida", module: "financeiro", label: "Carga concluída", description: "Títulos do sistema antigo carregados de uma vez." },
  { type: "financeiro.extrato.importado", module: "financeiro", label: "Extrato importado", description: "Lançamentos do extrato bancário carregados e conciliados com o contas a pagar." },
  { type: "financeiro.conciliacao.feita", module: "financeiro", label: "Conciliação feita", description: "Lançamento do extrato ligado a uma ou mais baixas." },
  { type: "financeiro.conciliacao.desfeita", module: "financeiro", label: "Conciliação desfeita", description: "Vínculo entre lançamento do extrato e baixa removido." },
  { type: "financeiro.conta.criada", module: "financeiro", label: "Conta criada", description: "Conta incluída no plano de contas." },
  { type: "financeiro.conta.alterada", module: "financeiro", label: "Conta alterada", description: "Nome, código, tipo ou situação de uma conta do plano alterados." },
  { type: "financeiro.conta.movida", module: "financeiro", label: "Conta movida", description: "Conta levada para outro grupo do plano, com novo código." },
  { type: "financeiro.conta.excluida", module: "financeiro", label: "Conta excluída", description: "Conta retirada do plano de contas." },
  { type: "portaria.visita.entrada", module: "portaria", label: "Entrada de visita", description: "Visitante entrou na empresa." },
  { type: "portaria.visita.saida", module: "portaria", label: "Saída de visita", description: "Visitante saiu da empresa." },
  { type: "portaria.recebido.registrado", module: "portaria", label: "Recebimento na portaria", description: "Encomenda ou entrega registrada." },
  { type: "acesso.usuario.criado", module: "acesso", label: "Acesso criado", description: "Nova conta na plataforma." },
  { type: "acesso.usuario.bloqueado", module: "acesso", label: "Acesso bloqueado", description: "Conta bloqueada ou desativada." },
  { type: "acesso.usuario.reativado", module: "acesso", label: "Acesso reativado", description: "Conta liberada de novo." },
  { type: "acesso.usuario.validade_alterada", module: "acesso", label: "Validade alterada", description: "Prazo de acesso de terceiro mudou." },
  { type: "cadastros.fornecedor.criado", module: "cadastros", label: "Fornecedor cadastrado", description: "Novo fornecedor no cadastro mestre." },
  { type: "cadastros.fornecedor.cnpj_confirmado", module: "cadastros", label: "CNPJ de fornecedor confirmado", description: "Alguém confirmou o CNPJ vindo de uma nota (gravou no fornecedor, cadastrou ou ligou a um existente)." },
  { type: "cadastros.fornecedor.unificado", module: "cadastros", label: "Fornecedores unificados", description: "Dois cadastros do mesmo fornecedor viraram um." },
  { type: "cadastros.cliente.criado", module: "cadastros", label: "Cliente cadastrado", description: "Novo cliente no cadastro mestre." },
  { type: "cadastros.cliente.unificado", module: "cadastros", label: "Clientes unificados", description: "Dois cadastros do mesmo cliente viraram um." },
  { type: "cadastros.centro_custo.criado", module: "cadastros", label: "Centro de custo criado", description: "Novo centro de custo." },
  { type: "cadastros.centro_custo.desativado", module: "cadastros", label: "Centro de custo desativado", description: "Centro de custo fora de uso." },
];

const INDEX = new Map(EVENT_CATALOG.map((event) => [event.type, event]));

export function findEventType(type: string): EventType | null {
  return INDEX.get(type) ?? null;
}
