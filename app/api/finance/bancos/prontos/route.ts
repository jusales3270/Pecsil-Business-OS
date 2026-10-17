import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { paresProntos } from "../../../../../lib/finance/conciliacao-match";

export const dynamic = "force-dynamic";

type Linha = Record<string, unknown>;
const cents = (n: unknown) => Math.round(Number(n) * 100);

/**
 * F-08 · pares prontos para confirmar: lançamento do extrato ainda a conciliar com UMA parcela em
 * aberto do mesmo CNPJ (raiz) e do mesmo valor, vencimento até 60 dias. É só a lista: quem
 * concilia confirma cada par (nada é ligado sozinho). Par ambíguo (dois de um lado) fica de fora.
 */
export async function GET() {
  const guard = await requireFeature("financeiro.bancos");
  if ("error" in guard) return guard.error;
  // O Supabase devolve no máximo 1.000 linhas por consulta: lê em páginas.
  const tudo = async (consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null }>) => {
    const linhas: unknown[] = [];
    for (let de = 0; de < 20_000; de += 1000) {
      const { data } = await consulta(de, de + 999);
      linhas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return linhas;
  };
  const [entradas, parcelasBrutas] = await Promise.all([
    tudo((de, ate) => guard.supabase.from("finance_bank_entries")
      .select("id,booking_date,direction,amount,description,counterparty_name,counterparty_tax_id")
      .eq("reconciliation_status", "pending").not("counterparty_tax_id", "is", null).order("id").range(de, ate)),
    tudo((de, ate) => guard.supabase.from("finance_installments")
      .select("id,installment_number,due_date,amount,settled_amount,status,finance_titles!inner(id,direction,status,counterparty_name,counterparty_tax_id,document_number,description,suppliers(tax_id),customers(tax_id))")
      .in("status", ["pending", "overdue", "partially_settled"]).order("id").range(de, ate)),
  ]);
  const um = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { tax_id?: string | null } | null | undefined;
  const parcelas = (parcelasBrutas as Linha[])
    .map((p) => {
      const t = p.finance_titles as Linha;
      return {
        id: String(p.id), vencimento: String(p.due_date), saldo: cents(p.amount) - cents(p.settled_amount), numero: Number(p.installment_number),
        direcao: t.direction === "payable" ? "debit" : "credit", cancelado: t.status === "cancelled" || t.status === "pending_approval",
        cnpj: (t.counterparty_tax_id as string | null) ?? um(t.suppliers)?.tax_id ?? um(t.customers)?.tax_id ?? null,
        nome: (t.counterparty_name as string | null) ?? null, documento: (t.document_number as string | null) ?? null,
      };
    })
    .filter((p) => !p.cancelado && p.saldo > 0);
  const pares = paresProntos(
    (entradas as Linha[]).map((e) => ({ id: String(e.id), data: String(e.booking_date), centavos: cents(e.amount), direcao: String(e.direction), cnpj: (e.counterparty_tax_id as string | null) ?? null })),
    parcelas,
  );
  const porEntrada = new Map((entradas as Linha[]).map((e) => [String(e.id), e]));
  const porParcela = new Map(parcelas.map((p) => [p.id, p]));
  return NextResponse.json({
    pares: pares.map(({ entrada, parcela }) => {
      const e = porEntrada.get(entrada)!, p = porParcela.get(parcela)!;
      return {
        entryId: entrada, installmentId: parcela, data: String(e.booking_date), valor: Number(e.amount) * (e.direction === "debit" ? -1 : 1),
        extrato: (e.counterparty_name as string | null) ?? (e.description as string | null) ?? "", titulo: p.nome, documento: p.documento, vencimento: p.vencimento, parcela: p.numero,
      };
    }),
  });
}
