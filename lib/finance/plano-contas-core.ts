/**
 * Regras puras do plano de contas (sem banco). As mesmas do banco — funções
 * `finance_next_account_code` e `finance_move_account` da migração
 * 202609300001 — para a tela mostrar o código que a conta vai receber antes de
 * confirmar. Quem grava (e decide de verdade) é o banco.
 */

export const MANAGEMENT_TYPES = {
  receita: "Receita",
  despesa_variavel: "Despesa variável",
  despesa_fixa: "Despesa fixa",
  custo_variavel: "Custo variável",
  custo_fixo: "Custo fixo",
  investimento: "Investimento",
  repasse: "Repasse",
} as const;

export type ManagementType = keyof typeof MANAGEMENT_TYPES;

export const isManagementType = (value: unknown): value is ManagementType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(MANAGEMENT_TYPES, value);

export type ChartAccount = {
  id: string;
  code: string | null;
  name: string;
  parentId: string | null;
  managementType: ManagementType;
  allowsPosting: boolean;
  active: boolean;
};

export type ChartNode = ChartAccount & { children: ChartNode[]; depth: number };

export const MAX_DEPTH = 3;
const CODE_FORMAT = /^\d{2,3}(\.\d{2,3}){0,2}$/;

/** Ordem do relatório do sistema: texto do código ("02.006" antes de "02.01"); sem código por último. */
export function compareAccounts(a: Pick<ChartAccount, "code" | "name">, b: Pick<ChartAccount, "code" | "name">): number {
  if (a.code && b.code) return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  if (a.code) return -1;
  if (b.code) return 1;
  return a.name.localeCompare(b.name, "pt-BR");
}

export function buildTree(accounts: readonly ChartAccount[]): ChartNode[] {
  const nodes = new Map<string, ChartNode>(accounts.map((a) => [a.id, { ...a, children: [], depth: 1 }]));
  const roots: ChartNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const arrange = (list: ChartNode[], depth: number) => {
    list.sort(compareAccounts);
    for (const node of list) {
      node.depth = depth;
      arrange(node.children, depth + 1);
    }
  };
  arrange(roots, 1);
  return roots;
}

export const codeDepth = (code: string | null): number => (code ? code.split(".").length : 0);

/** Quantos níveis a conta carrega abaixo dela (0 = sem subcontas). */
export function subtreeHeight(node: ChartNode): number {
  return node.children.length ? 1 + Math.max(...node.children.map(subtreeHeight)) : 0;
}

/**
 * Próximo código livre embaixo de um grupo: continua do maior número dos
 * irmãos; filho de grupo raiz tem 2 dígitos, 3º nível tem 3, raiz tem 2.
 * `taken` são todos os códigos existentes (o resultado nunca repete um).
 */
export function nextCode(parentCode: string | null, siblingCodes: readonly (string | null)[], taken: ReadonlySet<string>): string {
  const depth = codeDepth(parentCode);
  const width = depth === 1 ? 2 : depth === 2 ? 3 : 2;
  let n = Math.max(0, ...siblingCodes.filter((c): c is string => !!c).map((c) => Number(c.split(".")[depth]) || 0));
  for (;;) {
    n += 1;
    const candidate = `${parentCode ? `${parentCode}.` : ""}${String(n).padStart(width, "0")}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type MoveCheck = { ok: true; newCode: string } | { ok: false; reason: string };

/** A conta pode ir para dentro de `dest` (ou para a raiz, com `dest` nulo)? E com que código? */
export function checkMove(node: ChartNode, dest: ChartNode | null, all: readonly ChartAccount[]): MoveCheck {
  if ((dest?.id ?? null) === node.parentId) return { ok: false, reason: "A conta já está neste grupo." };
  if (dest) {
    if (dest.id === node.id || contains(node, dest.id)) return { ok: false, reason: "Uma conta não pode ir para dentro dela mesma." };
    if (!dest.code) return { ok: false, reason: "O grupo de destino ainda não tem código." };
    if (!dest.active) return { ok: false, reason: "O grupo de destino está inativo." };
  }
  const destDepth = codeDepth(dest?.code ?? null);
  if (destDepth + 1 + subtreeHeight(node) > MAX_DEPTH) return { ok: false, reason: `Não cabe: o plano tem no máximo ${MAX_DEPTH} níveis.` };
  const siblings = all.filter((a) => a.parentId === (dest?.id ?? null)).map((a) => a.code);
  const taken = new Set(all.map((a) => a.code).filter((c): c is string => !!c));
  return { ok: true, newCode: nextCode(dest?.code ?? null, siblings, taken) };
}

function contains(node: ChartNode, id: string): boolean {
  return node.children.some((child) => child.id === id || contains(child, id));
}

/** Código digitado à mão: formato válido e dentro da classe do grupo. */
export function validateCode(code: string, parentCode: string | null): string | null {
  const value = code.trim();
  if (!CODE_FORMAT.test(value)) return "Código inválido. Use o formato 02, 02.20 ou 02.01.016.";
  if (parentCode) {
    if (!value.startsWith(`${parentCode}.`) || codeDepth(value) !== codeDepth(parentCode) + 1) {
      return `O código precisa começar com ${parentCode}. (classe do grupo).`;
    }
  } else if (codeDepth(value) !== 1) {
    return "Conta na raiz tem código de um trecho só (ex.: 10).";
  }
  return null;
}

/**
 * Busca por código ou nome. Grupo que bate mostra todas as subcontas; conta que
 * bate traz os grupos do caminho. Inativas só aparecem com `showInactive`.
 */
export function filterTree(roots: readonly ChartNode[], query: string, showInactive: boolean): ChartNode[] {
  const q = query.trim().toLowerCase();
  const present = (list: (ChartNode | null)[]) => list.filter((n): n is ChartNode => n !== null);
  const whole = (node: ChartNode): ChartNode | null =>
    showInactive || node.active ? { ...node, children: present(node.children.map(whole)) } : null;
  const walk = (node: ChartNode): ChartNode | null => {
    if (!showInactive && !node.active) return null;
    if (!q || node.name.toLowerCase().includes(q) || (node.code ?? "").includes(q)) return whole(node);
    const children = present(node.children.map(walk));
    return children.length ? { ...node, children } : null;
  };
  return present(roots.map(walk));
}
