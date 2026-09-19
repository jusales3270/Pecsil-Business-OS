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
  compras: "Compras",
  rh: "Recursos Humanos",
  financeiro: "Financeiro",
  portaria: "Portaria & Acesso",
  acesso: "Acessos",
  cadastros: "Cadastros",
};

export const EVENT_CATALOG: readonly EventType[] = [
  { type: "compras.cotacao.criada", module: "compras", label: "Cotação lançada", description: "Uma cotação entrou para aprovação." },
  { type: "compras.cotacao.aprovada", module: "compras", label: "Cotação aprovada", description: "A cotação foi aprovada (total ou parcialmente)." },
  { type: "compras.cotacao.rejeitada", module: "compras", label: "Cotação rejeitada", description: "A cotação foi rejeitada." },
  { type: "compras.cotacao.reaberta", module: "compras", label: "Cotação reaberta", description: "A cotação voltou para aprovação." },
  { type: "compras.cotacao.comprada", module: "compras", label: "Cotação comprada", description: "A cotação virou compra." },
  { type: "compras.compra.registrada", module: "compras", label: "Compra registrada", description: "Compra efetivada com nota fiscal." },
  { type: "rh.colaborador.admitido", module: "rh", label: "Colaborador cadastrado", description: "Novo colaborador no quadro." },
  { type: "rh.colaborador.desligado", module: "rh", label: "Colaborador desligado", description: "O colaborador deixou o quadro." },
  { type: "rh.colaborador.reativado", module: "rh", label: "Colaborador reativado", description: "O colaborador voltou ao quadro." },
  { type: "rh.ausencia.aprovada", module: "rh", label: "Ausência aprovada", description: "Férias, folga ou licença aprovada." },
  { type: "rh.ausencia.reprovada", module: "rh", label: "Ausência reprovada", description: "Solicitação de ausência reprovada." },
  { type: "financeiro.titulo.criado", module: "financeiro", label: "Título criado", description: "Conta a pagar ou a receber lançada." },
  { type: "financeiro.titulo.aprovado", module: "financeiro", label: "Título aprovado", description: "Título aprovado para pagamento ou cobrança." },
  { type: "financeiro.titulo.baixado", module: "financeiro", label: "Título quitado", description: "Pagamento ou recebimento concluído." },
  { type: "portaria.visita.entrada", module: "portaria", label: "Entrada de visita", description: "Visitante entrou na empresa." },
  { type: "portaria.visita.saida", module: "portaria", label: "Saída de visita", description: "Visitante saiu da empresa." },
  { type: "portaria.recebido.registrado", module: "portaria", label: "Recebimento na portaria", description: "Encomenda ou entrega registrada." },
  { type: "acesso.usuario.criado", module: "acesso", label: "Acesso criado", description: "Nova conta na plataforma." },
  { type: "acesso.usuario.bloqueado", module: "acesso", label: "Acesso bloqueado", description: "Conta bloqueada ou desativada." },
  { type: "acesso.usuario.reativado", module: "acesso", label: "Acesso reativado", description: "Conta liberada de novo." },
  { type: "acesso.usuario.validade_alterada", module: "acesso", label: "Validade alterada", description: "Prazo de acesso de terceiro mudou." },
  { type: "cadastros.fornecedor.criado", module: "cadastros", label: "Fornecedor cadastrado", description: "Novo fornecedor no cadastro mestre." },
  { type: "cadastros.fornecedor.unificado", module: "cadastros", label: "Fornecedores unificados", description: "Dois cadastros do mesmo fornecedor viraram um." },
  { type: "cadastros.centro_custo.criado", module: "cadastros", label: "Centro de custo criado", description: "Novo centro de custo." },
  { type: "cadastros.centro_custo.desativado", module: "cadastros", label: "Centro de custo desativado", description: "Centro de custo fora de uso." },
];

const INDEX = new Map(EVENT_CATALOG.map((event) => [event.type, event]));

export function findEventType(type: string): EventType | null {
  return INDEX.get(type) ?? null;
}
