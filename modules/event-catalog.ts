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
};

export const EVENT_CATALOG: readonly EventType[] = [
  { type: "comercial.email.recebido", module: "comercial", label: "E-mail recebido", description: "Mensagem registrada numa das caixas monitoradas." },
  { type: "comercial.email.classificado", module: "comercial", label: "E-mail classificado", description: "O e-mail foi classificado (pedido, cobrança, dúvida ou outro) pelo Jev ou por uma pessoa." },
  { type: "comercial.card.criado", module: "comercial", label: "Card criado", description: "Um pedido, cobrança ou dúvida entrou no funil." },
  { type: "comercial.card.movido", module: "comercial", label: "Card movido", description: "O card mudou de etapa no funil." },
  { type: "comercial.card.ganho", module: "comercial", label: "Card ganho", description: "O card foi fechado como ganho." },
  { type: "comercial.card.perdido", module: "comercial", label: "Card perdido", description: "O card foi fechado como perdido, com motivo." },
  { type: "compras.cotacao.criada", module: "compras", label: "Cotação lançada", description: "Uma cotação entrou para aprovação." },
  { type: "compras.cotacao.aprovada", module: "compras", label: "Cotação aprovada", description: "A cotação foi aprovada (total ou parcialmente)." },
  { type: "compras.cotacao.rejeitada", module: "compras", label: "Cotação rejeitada", description: "A cotação foi rejeitada." },
  { type: "compras.cotacao.reaberta", module: "compras", label: "Cotação reaberta", description: "A cotação voltou para aprovação." },
  { type: "compras.cotacao.comprada", module: "compras", label: "Cotação comprada", description: "A cotação virou compra." },
  { type: "compras.compra.registrada", module: "compras", label: "Compra registrada", description: "Compra efetivada com nota fiscal." },
  { type: "almoxarifado.solicitacao.criada", module: "almoxarifado", label: "Material pedido", description: "O Almoxarifado pediu material ao Compras." },
  { type: "almoxarifado.recebimento.confirmado", module: "almoxarifado", label: "Material recebido", description: "Nota fiscal lançada no recebimento: virou conta a pagar e entrou no Painel do ICMS." },
  { type: "almoxarifado.solicitacao.cancelada", module: "almoxarifado", label: "Pedido de material cancelado", description: "O pedido de material foi cancelado antes da compra." },
  { type: "producao.os.aberta", module: "producao", label: "OS aberta", description: "Uma OS do Forja passou a existir no Business OS." },
  { type: "producao.os.status", module: "producao", label: "OS mudou de situação", description: "A OS mudou de status no Forja (em produção, finalizada, atrasada…)." },
  { type: "producao.os.faturada", module: "producao", label: "OS faturada", description: "A OS recebeu número de nota fiscal." },
  { type: "rh.colaborador.admitido", module: "rh", label: "Colaborador cadastrado", description: "Novo colaborador no quadro." },
  { type: "rh.colaborador.desligado", module: "rh", label: "Colaborador desligado", description: "O colaborador deixou o quadro." },
  { type: "rh.colaborador.reativado", module: "rh", label: "Colaborador reativado", description: "O colaborador voltou ao quadro." },
  { type: "rh.ausencia.aprovada", module: "rh", label: "Ausência aprovada", description: "Férias, folga ou licença aprovada." },
  { type: "rh.ausencia.reprovada", module: "rh", label: "Ausência reprovada", description: "Solicitação de ausência reprovada." },
  { type: "financeiro.titulo.criado", module: "financeiro", label: "Título criado", description: "Conta a pagar ou a receber lançada." },
  { type: "financeiro.titulo.aprovado", module: "financeiro", label: "Título aprovado", description: "Título aprovado para pagamento ou cobrança." },
  { type: "financeiro.titulo.baixado", module: "financeiro", label: "Título quitado", description: "Pagamento ou recebimento concluído." },
  { type: "financeiro.titulo.alterado", module: "financeiro", label: "Título alterado", description: "Valor, cliente, documento, conta ou previsão de um título alterados." },
  { type: "financeiro.titulo.excluido", module: "financeiro", label: "Título excluído", description: "Título a pagar ou a receber apagado." },
  { type: "financeiro.titulo.cancelado", module: "financeiro", label: "Título cancelado", description: "Título a pagar ou a receber cancelado." },
  { type: "financeiro.carga.concluida", module: "financeiro", label: "Carga concluída", description: "Títulos do sistema antigo carregados de uma vez." },
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
