/**
 * Núcleo puro da sincronização das OS do Forja (sem rede, sem banco).
 *
 * Converte o que o Forja devolve em `GET /api/os` e `GET /api/clientes` nas
 * linhas do espelho (`production_orders`, `production_order_financials`) e
 * aponta clientes com nome parecido, para o proprietário decidir se são o
 * mesmo — a sincronização nunca unifica sozinha.
 */

type Row = Record<string, unknown>;

const record = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const integer = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
/** Decimal do Prisma chega como string ("1234.50"); número também é aceito. */
const money = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
/** Data ISO do Forja → "AAAA-MM-DD" (a data civil, sem fuso). */
const dateOnly = (value: unknown): string | null => {
  const s = text(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const timestamp = (value: unknown): string | null => {
  const s = text(value);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

/**
 * Cópia exata de `public.normalize_party_name` (SQL). A gravação usa a função
 * do banco (`resolve_customer`); esta cópia serve só para a simulação, que não
 * grava. Um teste garante que as duas dão o mesmo resultado.
 */
export function normalizePartyName(raw: string | null | undefined): string | null {
  const from = "áàâãäéèêëíìîïóòôõöúùûüçñ.,;:/\\-_()\"'";
  const to = "aaaaaeeeeiiiiooooouuuucn              ";
  let out = "";
  for (const ch of (raw ?? "").toLowerCase()) {
    const i = from.indexOf(ch);
    out += i === -1 ? ch : to[i];
  }
  const result = out.replace(/\s+/g, " ").trim();
  return result || null;
}

export interface ForjaClient {
  externalId: string;
  name: string;
  active: boolean;
}

export interface MirrorOrder {
  external_id: string;
  code: string;
  external_customer_id: string | null;
  customer_name: string | null;
  article_code: string | null;
  article_description: string | null;
  product_type: string | null;
  quantity: number | null;
  due_date: string | null;
  opened_at: string | null;
  priority: string | null;
  status: string;
  lots_count: number | null;
  source_updated_at: string | null;
}

export interface MirrorFinancials {
  unit_price: number | null;
  total_value: number | null;
  customer_po: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  invoice_date: string | null;
  amount_received: number | null;
  paid_at: string | null;
}

export interface ParsedOrders {
  orders: { order: MirrorOrder; financials: MirrorFinancials }[];
  /** Itens que não puderam ser lidos (sem id, sem código ou sem status). */
  rejected: number;
}

export function parseClients(data: unknown): ForjaClient[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      const row = record(item);
      const externalId = text(row.id);
      const name = text(row.nome);
      if (!externalId || !name) return null;
      return { externalId, name, active: row.ativo !== false };
    })
    .filter((client): client is ForjaClient => client !== null);
}

export function parseOrders(data: unknown): ParsedOrders {
  const orders: ParsedOrders["orders"] = [];
  let rejected = 0;
  for (const item of Array.isArray(data) ? data : []) {
    const row = record(item);
    const externalId = text(row.id);
    const code = text(row.codigoGrv);
    const status = text(row.status);
    if (!externalId || !code || !status) {
      rejected += 1;
      continue;
    }
    const cliente = record(row.cliente);
    const artigo = record(row.artigo);
    orders.push({
      order: {
        external_id: externalId,
        code,
        external_customer_id: text(row.clienteId) ?? text(cliente.id),
        customer_name: text(cliente.nome),
        article_code: text(artigo.codigo),
        article_description: text(artigo.descricao),
        product_type: text(artigo.tipoProduto),
        quantity: integer(row.quantidadeTotal),
        due_date: dateOnly(row.prazoEntrega),
        opened_at: timestamp(row.dataAbertura),
        priority: text(row.prioridade),
        status,
        lots_count: integer(record(row._count).lotes),
        source_updated_at: timestamp(row.atualizadoEm),
      },
      financials: {
        unit_price: money(row.precoUnitario),
        total_value: money(row.valorTotal),
        customer_po: text(row.poCliente),
        invoice_number: text(row.numeroFiscal),
        invoice_status: text(row.statusFiscal),
        invoice_date: dateOnly(row.dataNf),
        amount_received: money(row.valorRecebido),
        paid_at: dateOnly(row.dataPagamento),
      },
    });
  }
  return { orders, rejected };
}

/** Palavras que não distinguem uma empresa de outra. */
const GENERIC = new Set(["ltda", "sa", "s", "a", "me", "epp", "eireli", "do", "da", "de", "dos", "das", "e", "industria", "ind", "comercio", "com", "brasil", "vidros", "vidro"]);

const tokens = (name: string) =>
  new Set((normalizePartyName(name) ?? "").split(" ").filter((t) => t.length > 1 && !GENERIC.has(t)));

/**
 * Pares de clientes com nome parecido: compartilham uma palavra marcante
 * (ex.: "Verallia" em "Verallia" e "Verallia / Saint-Gobain - Campo Bom").
 * É só uma lista para conferência humana.
 */
export function similarPairs(names: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  const sets = names.map((name) => ({ name, set: tokens(name) }));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (normalizePartyName(a.name) === normalizePartyName(b.name)) continue;
      const shared = [...a.set].filter((t) => b.set.has(t));
      if (shared.some((t) => t.length >= 4)) pairs.push([a.name, b.name]);
    }
  }
  return pairs;
}
