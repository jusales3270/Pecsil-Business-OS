import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../../lib/auth/feature-guard";
import { explicarSemPar, mesmoCnpj, parecenca, sugerirBaixas } from "../../../../../../lib/finance/conciliacao-match";

export const dynamic = "force-dynamic";

type Linha = Record<string, unknown>;
const cents = (n: unknown) => Math.round(Number(n) * 100);
const dia = (data: string, d: number) => new Date(Date.parse(`${data}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/**
 * Candidatos para um lançamento que o casamento automático não resolveu:
 *  - baixas ainda sem conta bancária, até 3 dias de diferença (as parecidas vêm primeiro);
 *  - parcelas em aberto de valor igual (ou parecido, com o mesmo nome) para dar baixa a partir do extrato.
 * Saída casa com contas a pagar; entrada, com contas a receber.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("financeiro.bancos");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;

  const { data: entrada, error } = await guard.supabase
    .from("finance_bank_entries")
    .select("id,booking_date,direction,amount,description,counterparty_name,counterparty_tax_id,reconciliation_status")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "FINANCE_UNAVAILABLE" }, { status: 503 });
  if (!entrada) return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });

  const direcao = entrada.direction === "debit" ? "payable" : "receivable";
  const valor = cents(entrada.amount);
  const alvo = { id: String(entrada.id), data: String(entrada.booking_date), centavos: valor, contraparte: (entrada.counterparty_name as string | null) ?? null, cnpj: (entrada.counterparty_tax_id as string | null) ?? null };
  // CNPJ do título: o do próprio título, senão o do fornecedor ou cliente ligado.
  const cnpjDo = (t: Linha) => {
    const um = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { tax_id?: string | null } | null | undefined;
    return (t.counterparty_tax_id as string | null) ?? um(t.suppliers)?.tax_id ?? um(t.customers)?.tax_id ?? null;
  };

  const { data: baixasBrutas } = await guard.supabase
    .from("finance_settlements")
    .select("id,settlement_date,amount,interest,penalty,finance_installments(installment_number,finance_titles(direction,counterparty_name,counterparty_tax_id,description,document_number,suppliers(tax_id),customers(tax_id)))")
    .is("reversed_at", null)
    .is("bank_account_id", null)
    .gte("settlement_date", dia(alvo.data, -3))
    .lte("settlement_date", dia(alvo.data, 3))
    .order("settlement_date")
    .limit(400);
  const baixas = ((baixasBrutas ?? []) as unknown as Linha[])
    .map((b) => {
      const t = (b.finance_installments as { finance_titles?: Linha } | null)?.finance_titles;
      return t && t.direction === direcao
        ? { id: String(b.id), data: String(b.settlement_date), centavos: cents(b.amount) + cents(b.interest) + cents(b.penalty), contraparte: (t.counterparty_name as string | null) ?? null, cnpj: cnpjDo(t), descricao: (t.description as string | null) ?? null, documento: (t.document_number as string | null) ?? null }
        : null;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);
  const sugeridas = sugerirBaixas(alvo, baixas);
  const ordem = new Map(sugeridas.map((s, i) => [s.baixaId, i]));
  const motivoDe = new Map(sugeridas.map((s) => [s.baixaId, s.motivo]));
  const baixasOrdenadas = [...baixas]
    .sort((a, b) => (ordem.get(a.id) ?? 99) - (ordem.get(b.id) ?? 99) || parecenca(alvo.contraparte, b.contraparte) - parecenca(alvo.contraparte, a.contraparte) || a.data.localeCompare(b.data))
    .slice(0, 60)
    .map((b) => ({ id: b.id, data: b.data, valor: b.centavos / 100, fornecedor: b.contraparte, descricao: b.descricao, documento: b.documento, sugerida: ordem.has(b.id), motivo: motivoDe.get(b.id) ?? null }));

  // O Supabase devolve no máximo 1.000 linhas por consulta: lê em páginas.
  const parcelasBrutas: unknown[] = [];
  for (let de = 0; de < 10_000; de += 1000) {
    const { data: pagina } = await guard.supabase
    .from("finance_installments")
    .select("id,installment_number,due_date,amount,settled_amount,status,finance_titles!inner(direction,counterparty_name,counterparty_tax_id,description,document_number,is_forecast,is_historical,status,suppliers(tax_id),customers(tax_id))")
    .eq("finance_titles.direction", direcao)
    .in("status", ["pending", "overdue", "partially_settled"])
    .gte("due_date", dia(alvo.data, -90))
    .lte("due_date", dia(alvo.data, 90))
      .order("id").range(de, de + 999);
    parcelasBrutas.push(...(pagina ?? []));
    if (!pagina || pagina.length < 1000) break;
  }
  const parcelas = (parcelasBrutas as Linha[])
    .map((p) => {
      const t = p.finance_titles as Linha;
      const saldo = cents(p.amount) - cents(p.settled_amount);
      const nome = parecenca(alvo.contraparte, (t.counterparty_name as string | null) ?? null);
      const igual = Math.abs(saldo - valor) <= 5;
      const cnpj = mesmoCnpj(alvo.cnpj, cnpjDo(t));
      return { p, t, saldo, nome, igual, cnpj };
    })
    .filter((x) => x.t.status !== "cancelled" && (x.igual || x.cnpj || (x.nome >= 0.6 && Math.abs(x.saldo - valor) <= valor * 0.1)));
  const doCnpj = parcelas.filter((x) => x.cnpj);
  const listadas = parcelas
    .sort((a, b) => Number(b.igual && b.cnpj) - Number(a.igual && a.cnpj) || Number(b.igual) - Number(a.igual) || Number(b.cnpj) - Number(a.cnpj) || b.nome - a.nome || Math.abs(a.saldo - valor) - Math.abs(b.saldo - valor))
    .slice(0, 12)
    .map(({ p, t, saldo, igual, cnpj }) => ({
      id: String(p.id),
      numero: Number(p.installment_number),
      vencimento: String(p.due_date),
      saldo: saldo / 100,
      fornecedor: (t.counterparty_name as string | null) ?? null,
      descricao: (t.description as string | null) ?? null,
      documento: (t.document_number as string | null) ?? null,
      previsao: Boolean(t.is_forecast),
      historico: Boolean(t.is_historical),
      valorIgual: igual,
      mesmoCnpj: cnpj,
    }));

  // Sem par forte (nenhuma baixa sugerida nem parcela de valor igual): explica por quê.
  let explicacao: string[] = [];
  if (!sugeridas.length && !listadas.some((p) => p.valorIgual)) {
    const digitos = (alvo.cnpj ?? "").replace(/\D/g, "");
    let dono: { nome: string; tipo: "fornecedor" | "cliente" } | null = null;
    if (digitos.length === 14) {
      const [{ data: f }, { data: c }] = await Promise.all([
        guard.supabase.from("suppliers").select("name, legal_name").eq("tax_id", digitos).limit(1).maybeSingle(),
        guard.supabase.from("customers").select("name").eq("tax_id", digitos).limit(1).maybeSingle(),
      ]);
      dono = f ? { nome: String(f.legal_name || f.name), tipo: "fornecedor" } : c ? { nome: String(c.name), tipo: "cliente" } : null;
    }
    explicacao = explicarSemPar({
      entrada: alvo, dono, baixasNaJanela: baixas.length,
      parcelasDoCnpj: doCnpj.map((x) => ({ saldo: x.saldo, vencimento: String(x.p.due_date), documento: (x.t.document_number as string | null) ?? null })),
    });
  }

  return NextResponse.json({ baixas: baixasOrdenadas, parcelas: listadas, explicacao });
}
