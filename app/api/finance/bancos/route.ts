import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { ROTULO_CATEGORIA, type CategoriaExtrato } from "../../../../lib/finance/extrato-classificar";

export const dynamic = "force-dynamic";

const TAMANHO = 50;
const SITUACOES = { pendente: ["pending", "partial"], conciliado: ["matched"], ignorado: ["ignored"] } as const;

type Linha = Record<string, unknown>;

/**
 * Extrato importado: uma página de lançamentos com filtro e, para cada um, com o que
 * está ligado a ele. As contas e os totais vêm do resumo calculado no banco.
 */
export async function GET(request: Request) {
  const guard = await requireFeature("financeiro.bancos");
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  const conta = url.searchParams.get("conta");
  const situacao = url.searchParams.get("situacao") ?? "pendente";
  const categoria = url.searchParams.get("categoria");
  const sentido = url.searchParams.get("sentido");
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");
  const busca = (url.searchParams.get("q") ?? "").trim();
  const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
  if ((de && !/^\d{4}-\d{2}-\d{2}$/.test(de)) || (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate))) return NextResponse.json({ error: "Data inválida." }, { status: 400 });

  let consulta = guard.supabase
    .from("finance_bank_entries")
    .select("id,bank_account_id,booking_date,direction,amount,description,category,counterparty_name,reconciliation_status", { count: "exact" })
    .order("booking_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range((pagina - 1) * TAMANHO, pagina * TAMANHO - 1);
  if (conta) consulta = consulta.eq("bank_account_id", conta);
  if (situacao in SITUACOES) consulta = consulta.in("reconciliation_status", [...SITUACOES[situacao as keyof typeof SITUACOES]]);
  if (categoria) consulta = consulta.eq("category", categoria);
  if (sentido === "credit" || sentido === "debit") consulta = consulta.eq("direction", sentido);
  if (de) consulta = consulta.gte("booking_date", de);
  if (ate) consulta = consulta.lte("booking_date", ate);
  if (busca) {
    const termo = busca.replace(/[%,()]/g, " ");
    consulta = consulta.or(`description.ilike.%${termo}%,counterparty_name.ilike.%${termo}%`);
  }

  const [lista, resumo, planoResult] = await Promise.all([
    consulta,
    guard.supabase.rpc("finance_bank_overview"),
    guard.supabase.from("finance_chart_accounts").select("id,code,name,account_type,allows_posting").eq("active", true).order("code"),
  ]);
  if (lista.error || resumo.error) {
    console.error("Falha ao ler o extrato", lista.error ?? resumo.error);
    return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  }

  const linhas = (lista.data ?? []) as Linha[];
  const ids = linhas.map((l) => String(l.id));
  const ligacoes = new Map<string, { valor: number; data: string | null; fornecedor: string | null; descricao: string | null }[]>();
  if (ids.length) {
    const { data } = await guard.supabase
      .from("finance_reconciliations")
      .select("bank_entry_id,matched_amount,finance_settlements(settlement_date,finance_installments(finance_titles(counterparty_name,description)))")
      .in("bank_entry_id", ids);
    for (const r of (data ?? []) as unknown as Linha[]) {
      const baixa = r.finance_settlements as { settlement_date?: string; finance_installments?: { finance_titles?: { counterparty_name?: string; description?: string } } } | null;
      const titulo = baixa?.finance_installments?.finance_titles;
      const lista2 = ligacoes.get(String(r.bank_entry_id)) ?? [];
      lista2.push({ valor: Number(r.matched_amount), data: baixa?.settlement_date ?? null, fornecedor: titulo?.counterparty_name ?? null, descricao: titulo?.description ?? null });
      ligacoes.set(String(r.bank_entry_id), lista2);
    }
  }

  return NextResponse.json({
    lancamentos: linhas.map((l) => ({
      id: String(l.id),
      conta: String(l.bank_account_id),
      data: String(l.booking_date),
      valor: l.direction === "credit" ? Number(l.amount) : -Number(l.amount),
      descricao: String(l.description),
      categoria: (l.category as string | null) ?? null,
      categoriaRotulo: l.category ? (ROTULO_CATEGORIA[l.category as CategoriaExtrato] ?? String(l.category)) : null,
      contraparte: (l.counterparty_name as string | null) ?? null,
      situacao: String(l.reconciliation_status),
      ligacoes: ligacoes.get(String(l.id)) ?? [],
    })),
    total: lista.count ?? 0,
    pagina,
    tamanho: TAMANHO,
    resumo: resumo.data ?? [],
    categorias: Object.entries(ROTULO_CATEGORIA).map(([codigo, rotulo]) => ({ codigo, rotulo })),
    plano: ((planoResult.data ?? []) as Linha[]).map((a) => ({ id: String(a.id), code: String(a.code), name: String(a.name), type: String(a.account_type), allowsPosting: Boolean(a.allows_posting) })),
    podeOperar: guard.access.can("financeiro.bancos", "operar"),
    podePagar: guard.access.can("financeiro.pagar", "aprovar"),
    podeReceber: guard.access.can("financeiro.receber", "aprovar"),
  });
}
