/**
 * Catálogo de acesso: o que o proprietário pode liberar para cada usuário.
 *
 * O acesso é do USUÁRIO, não de um cargo: o proprietário marca os módulos e,
 * dentro de cada um, as funcionalidades com um nível. A migração
 * `202609190001_user_access.sql` semeia `access_features` com este mesmo
 * catálogo — o teste `tests/access-catalog.test.mjs` garante que não divergem.
 *
 * Níveis são cumulativos: operar inclui ver; aprovar inclui operar.
 */

export const ACCESS_LEVELS = ["ver", "operar", "aprovar"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export interface AccessFeature {
  code: string;
  label: string;
  description: string;
  levels: readonly AccessLevel[];
  /** Rótulos próprios por nível quando o genérico não descreve bem. */
  levelLabels?: Partial<Record<AccessLevel, string>>;
}

export interface AccessModule {
  code: string;
  label: string;
  /**
   * Departamento que abriga o módulo na tela de acessos (ex.: Compras dentro do
   * Comercial). É só organização visual: os códigos das funcionalidades, o seed
   * do banco e o RLS não mudam.
   */
  department?: string;
  features: readonly AccessFeature[];
}

/** Departamentos que agrupam módulos no menu e no credenciamento. */
export const ACCESS_DEPARTMENTS: Record<string, string> = {
  comercial: "Comercial",
};

export const LEVEL_LABELS: Record<AccessLevel, string> = {
  ver: "Ver",
  operar: "Operar",
  aprovar: "Aprovar",
};

const VER = ["ver"] as const;
const VER_OPERAR = ["ver", "operar"] as const;
const TODOS = ["ver", "operar", "aprovar"] as const;

export const ACCESS_CATALOG: readonly AccessModule[] = [
  {
    code: "rh",
    label: "Recursos Humanos",
    features: [
      { code: "rh.colaboradores", label: "Colaboradores", description: "Ficha dos colaboradores; operar cadastra, edita e vê dados pessoais (CPF, PIS).", levels: VER_OPERAR },
      { code: "rh.jornada", label: "Ponto e jornada", description: "Registros de ponto e jornada; aprovar ajusta e fecha.", levels: TODOS },
      { code: "rh.ferias", label: "Férias e ausências", description: "Solicitações, calendário e saldos; aprovar decide as solicitações.", levels: TODOS },
      { code: "rh.feriados", label: "Feriados", description: "Calendário de feriados; operar edita.", levels: VER_OPERAR },
      { code: "rh.beneficios", label: "Benefícios", description: "Planos, participantes e solicitações; aprovar decide as solicitações.", levels: TODOS },
      { code: "rh.sst", label: "Saúde e segurança", description: "Exames, treinamentos, EPIs e ocorrências; registros confidenciais só em aprovar.", levels: TODOS },
      { code: "rh.clinico", label: "Dados clínicos", description: "Diagnóstico, CID e observação clínica dos afastamentos. Dado sensível: libere só a quem precisa; operar corrige.", levels: VER_OPERAR },
      { code: "rh.terceiros", label: "Terceiros", description: "Acompanhar quem está na fábrica e gerar o relatório mensal de horas; os apontamentos continuam exclusivos da Portaria.", levels: VER },
      { code: "rh.documentos", label: "Documentos", description: "Documentos dos colaboradores; documentos sensíveis só em aprovar.", levels: TODOS },
      { code: "rh.relatorios", label: "Relatórios", description: "Relatórios do RH.", levels: VER },
      { code: "rh.homologacao", label: "Homologação", description: "Critérios e evidências de homologação do módulo.", levels: VER_OPERAR },
    ],
  },
  {
    code: "financeiro",
    label: "Financeiro",
    features: [
      { code: "financeiro.pagar", label: "Contas a pagar", description: "Títulos a pagar; aprovar autoriza e dá baixa (pagamento).", levels: TODOS },
      { code: "financeiro.receber", label: "Contas a receber", description: "Títulos a receber; aprovar dá baixa (recebimento).", levels: TODOS },
      { code: "financeiro.fluxo", label: "Fluxo de caixa", description: "Projeção de entradas e saídas.", levels: VER },
      { code: "financeiro.bancos", label: "Bancos e conciliação", description: "Contas bancárias e extratos; operar importa e concilia.", levels: VER_OPERAR },
      { code: "financeiro.centros", label: "Centros de custo", description: "Centros de custo; operar cadastra.", levels: VER_OPERAR },
      { code: "financeiro.plano", label: "Plano de contas", description: "Plano de contas; operar inclui, edita, move e exclui contas.", levels: VER_OPERAR },
      { code: "financeiro.relatorios", label: "Relatórios", description: "Relatórios financeiros e exportação.", levels: VER },
      { code: "financeiro.homologacao", label: "Homologação", description: "Plano de contas, alçadas e critérios de homologação.", levels: VER_OPERAR },
    ],
  },
  {
    code: "comercial",
    label: "CRM",
    department: "comercial",
    features: [
      { code: "comercial.caixa", label: "Caixa de entrada", description: "E-mails recebidos e a classificação de cada um; operar corrige a classificação e abre o card.", levels: VER_OPERAR },
      { code: "comercial.funil", label: "Funil", description: "Cards de pedido e atendimento por etapa; operar move, responde e fecha.", levels: VER_OPERAR },
      { code: "comercial.clientes", label: "Clientes", description: "Cadastro de clientes e os e-mails de cada um; operar edita.", levels: VER_OPERAR },
      { code: "comercial.cobranca", label: "Cobrança", description: "Títulos a receber vencidos e a régua de avisos; aprovar é quem dispara o e-mail ao cliente.", levels: TODOS },
      { code: "comercial.conexao", label: "Conexão de e-mail", description: "Situação da leitura das caixas de e-mail (última sincronização e erros).", levels: VER },
    ],
  },
  {
    code: "compras",
    label: "Compras",
    department: "comercial",
    features: [
      { code: "compras.cotacoes", label: "Cotações", description: "Lançar e acompanhar cotações.", levels: VER_OPERAR },
      { code: "compras.aprovacoes", label: "Aprovações", description: "Cotações pendentes e histórico de decisões; aprovar decide.", levels: ["ver", "aprovar"] },
      { code: "compras.realizadas", label: "Compras realizadas", description: "Compras efetivadas; operar registra a compra com NF.", levels: VER_OPERAR },
      { code: "compras.fornecedores", label: "Fornecedores", description: "Cadastro e histórico de compras por fornecedor; operar cadastra, edita e unifica.", levels: VER_OPERAR },
    ],
  },
  {
    code: "portaria",
    label: "Portaria & Acesso",
    features: [
      { code: "portaria.visitas", label: "Visitas", description: "Visitantes e visitas.", levels: TODOS, levelLabels: { aprovar: "Gerenciar" } },
      { code: "portaria.terceiros", label: "Terceiros", description: "Prestadores de serviço.", levels: TODOS, levelLabels: { aprovar: "Gerenciar" } },
      { code: "portaria.recebidos", label: "Recebidos", description: "Encomendas e entregas.", levels: TODOS, levelLabels: { aprovar: "Gerenciar" } },
      { code: "portaria.veiculos", label: "Veículos", description: "Frota e movimentação de veículos.", levels: TODOS, levelLabels: { aprovar: "Gerenciar" } },
    ],
  },
  {
    code: "producao",
    label: "Produção",
    features: [
      { code: "producao.painel", label: "Painel", description: "Visão geral da fábrica: status das OS, gargalos e alertas.", levels: VER },
      { code: "producao.os", label: "Ordens de serviço", description: "Lista de OS com cliente, artigo e prazo.", levels: VER },
      { code: "producao.fundicao", label: "Pipeline fundição", description: "Lotes fase a fase na fundição.", levels: VER },
      { code: "producao.paradas", label: "Paradas", description: "Máquinas paradas e tempo parado por motivo.", levels: VER },
      { code: "producao.qualidade", label: "Qualidade", description: "Resultados de inspeção.", levels: VER },
      { code: "producao.fantasmas", label: "Lotes fantasmas", description: "Lotes parados sem apontamento e turnos não fechados.", levels: VER },
      { code: "producao.externos", label: "Envios externos", description: "Lotes em fornecedores (metalização externa).", levels: VER },
      { code: "producao.bi", label: "BI & Análises", description: "Pontualidade de entrega e causas de parada.", levels: VER },
      { code: "producao.conexao", label: "Conexão Forja", description: "Situação da integração com o Forja.", levels: VER },
    ],
  },
  {
    code: "almoxarifado",
    label: "Almoxarifado",
    features: [
      { code: "almoxarifado.solicitacoes", label: "Solicitações", description: "Pedidos de material ao Compras; operar pede e cancela.", levels: VER_OPERAR },
      { code: "almoxarifado.recebimento", label: "Recebimento", description: "Material a caminho e entrada da nota fiscal; operar confere e lança a nota, que vira conta a pagar.", levels: VER_OPERAR },
    ],
  },
  {
    code: "fundicao",
    label: "Fundição",
    features: [
      { code: "fundicao.pedidos", label: "Pedidos de material", description: "Painel da Fundição: pede material ao Compras e acompanha cotação, aprovação, compra e chegada; operar pede e cancela.", levels: VER_OPERAR },
    ],
  },
  {
    code: "fiscal",
    label: "Fiscal",
    features: [
      { code: "fiscal.icms", label: "Painel do ICMS", description: "Notas de entrada do mês, ICMS e IPI por centro e livro de apuração; operar lança notas e marca XML, lançamento e autorização.", levels: VER_OPERAR },
    ],
  },
  {
    code: "fundacao",
    label: "Fundação",
    features: [
      { code: "fundacao.estrutura", label: "Estrutura", description: "Unidades, departamentos, equipes e cargos (consulta).", levels: VER },
      { code: "fundacao.auditoria", label: "Auditoria", description: "Trilha de auditoria da plataforma.", levels: VER },
      { code: "fundacao.cadastros", label: "Cadastros", description: "Fornecedores e centros de custo usados por todos os módulos; operar edita e unifica.", levels: VER_OPERAR },
      { code: "fundacao.eventos", label: "Eventos", description: "Linha do tempo do que acontece em cada módulo (base das integrações e da SARA).", levels: VER },
    ],
  },
];

export type AccessGrants = Record<string, AccessLevel>;

const FEATURE_INDEX = new Map(
  ACCESS_CATALOG.flatMap((module) => module.features.map((feature) => [feature.code, { module, feature }] as const)),
);

export function findFeature(code: string) {
  return FEATURE_INDEX.get(code) ?? null;
}

export function levelRank(level: AccessLevel | undefined | null): number {
  return level ? ACCESS_LEVELS.indexOf(level) + 1 : 0;
}

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && (ACCESS_LEVELS as readonly string[]).includes(value);
}

/**
 * Valida e normaliza um conjunto de permissões vindo da tela: descarta
 * funcionalidades desconhecidas e rebaixa níveis que a funcionalidade não tem
 * para o maior nível que ela aceita abaixo do pedido.
 */
export function normalizeGrants(input: unknown): AccessGrants {
  const grants: AccessGrants = {};
  if (!input || typeof input !== "object") return grants;
  for (const [code, level] of Object.entries(input as Record<string, unknown>)) {
    const entry = findFeature(code);
    if (!entry || !isAccessLevel(level)) continue;
    const allowed = [...entry.feature.levels].filter((candidate) => levelRank(candidate) <= levelRank(level));
    const best = allowed.at(-1);
    if (best) grants[code] = best;
  }
  return grants;
}

/** Nível máximo que a funcionalidade aceita. */
export function maxLevel(feature: AccessFeature): AccessLevel {
  return feature.levels[feature.levels.length - 1];
}

export function levelLabel(feature: AccessFeature, level: AccessLevel): string {
  return feature.levelLabels?.[level] ?? LEVEL_LABELS[level];
}

/** Quem tem o acesso: o proprietário passa em tudo; os demais pelas permissões. */
export interface FeatureAccess {
  isOwner?: boolean;
  grants?: AccessGrants;
}

export function hasFeature(access: FeatureAccess, code: string, level: AccessLevel = "ver"): boolean {
  if (access.isOwner) return true;
  return levelRank(access.grants?.[code]) >= levelRank(level);
}

export function hasModuleAccess(access: FeatureAccess, moduleCode: string, level: AccessLevel = "ver"): boolean {
  if (access.isOwner) return true;
  return Object.entries(access.grants ?? {}).some(
    ([code, granted]) => code.startsWith(`${moduleCode}.`) && levelRank(granted) >= levelRank(level),
  );
}

/**
 * Permissões no formato antigo (`modulo.acao`) derivadas das funcionalidades.
 * Espelha `has_permission` do banco (202609190001_user_access.sql) para o
 * código que ainda consulta `hasPermission` continuar coerente com o RLS.
 */
export function derivePermissions(grants: AccessGrants): string[] {
  const permissions = new Set<string>(["core.search.view", "core.notifications.view"]);
  for (const [code, level] of Object.entries(grants)) {
    const entry = findFeature(code);
    if (!entry) continue;
    const moduleCode = entry.module.code;
    const rank = levelRank(level);
    if (moduleCode === "fundacao") {
      if (code === "fundacao.estrutura") permissions.add("core.organization.view");
      if (code === "fundacao.auditoria") permissions.add("core.audit.view");
      if (code === "fundacao.cadastros") permissions.add("core.cadastros.view");
      if (code === "fundacao.eventos") permissions.add("core.eventos.view");
      continue;
    }
    permissions.add(`${moduleCode}.view`);
    if (rank >= 2) permissions.add(`${moduleCode}.create`).add(`${moduleCode}.edit`);
    if (rank >= 3) permissions.add(`${moduleCode}.approve`).add(`${moduleCode}.export`);
    if (code.endsWith(".homologacao") && rank >= 2) permissions.add(`${moduleCode}.admin`);
    if (code.endsWith(".relatorios")) permissions.add(`${moduleCode}.export`);
    if ((code === "financeiro.pagar" || code === "financeiro.receber") && rank >= 3) permissions.add("financeiro.settle");
    if (code === "financeiro.bancos" && rank >= 2) permissions.add("financeiro.reconcile");
    if (moduleCode === "rh") permissions.add("core.people.view");
    if (code === "rh.colaboradores" && rank >= 2) permissions.add("core.people.create").add("core.people.edit");
    if (code === "rh.documentos") {
      permissions.add("core.documents.view");
      if (rank >= 2) permissions.add("core.documents.create").add("core.documents.edit");
      if (rank >= 3) permissions.add("core.documents.approve");
    }
  }
  return [...permissions].sort();
}

/** Tipo da conta: colaborador (ficha no RH), terceiro (prestador externo) ou administrativo (pelo cargo). */
export type AccountType = "colaborador" | "terceiro" | "administrativo";

export const ACCOUNT_TYPES: readonly AccountType[] = ["colaborador", "terceiro", "administrativo"];

/** Cargos do administrativo. Espelha `profiles_job_title_check` do banco. */
export const JOB_TITLES = {
  diretor: "Diretor",
  gerente: "Gerente",
  assistente: "Assistente",
  estagiario: "Estagiário",
} as const;

export type JobTitle = keyof typeof JOB_TITLES;

export const isJobTitle = (value: unknown): value is JobTitle =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(JOB_TITLES, value);

/**
 * O acesso venceu? Sem data, nunca vence. Espelha `current_profile_id()` do
 * banco, que deixa de reconhecer o perfil depois de `access_expires_at`.
 */
export function isAccessExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const limit = Date.parse(expiresAt);
  return Number.isFinite(limit) && limit <= now.getTime();
}

/**
 * Converte a data escolhida na tela (AAAA-MM-DD) no fim daquele dia, no fuso
 * de Brasília: "válido até 30/09" vale o dia 30 inteiro.
 */
export function endOfDayBrasilia(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T23:59:59-03:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
