import { NextResponse } from "next/server";
import { requireAnyFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

type Body = {
  counterparty?: string;
  group?: string | null;
  documentNumber?: string | null;
  documentType?: string | null;
  description?: string;
  notes?: string | null;
  issueDate?: string;
  dueDate?: string;
  amount?: number;
  chartAccountId?: string;
  isForecast?: boolean;
  reviewed?: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FEATURE = { payable: "financeiro.pagar", receivable: "financeiro.receber" } as const;
const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

async function load(id: string) {
  const guard = await requireAnyFeature(Object.values(FEATURE), "operar");
  if ("error" in guard) return { ok: false as const, error: guard.error };
  const { data: title } = await guard.supabase
    .from("finance_titles")
    .select("id, organization_id, direction, original_amount, chart_account_id, status, finance_installments(id, amount, settled_amount, status), finance_title_allocations(chart_account_id)")
    .eq("id", id)
    .maybeSingle();
  if (!title) return { ok: false as const, error: NextResponse.json({ error: "Título não encontrado." }, { status: 404 }) };
  return { ok: true as const, guard, title, feature: FEATURE[title.direction as keyof typeof FEATURE] };
}

/** Editar um título (quem opera a direção dele). Valor e vencimento valem para título de parcela única. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await load(id);
  if (!found.ok) return found.error;
  const { guard, title, feature } = found;
  if (!guard.access.can(feature, "operar")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Body;

  const changes: Record<string, unknown> = {};
  if (body.counterparty !== undefined) {
    if (!body.counterparty.trim()) return NextResponse.json({ error: "Informe o cliente." }, { status: 400 });
    changes.counterparty_name = body.counterparty.trim();
  }
  if (body.description !== undefined) {
    if (!body.description.trim()) return NextResponse.json({ error: "Informe o histórico." }, { status: 400 });
    changes.description = body.description.trim();
  }
  if (body.group !== undefined) changes.counterparty_group = text(body.group);
  if (body.documentNumber !== undefined) changes.document_number = text(body.documentNumber);
  if (body.documentType !== undefined) changes.document_type = text(body.documentType);
  if (body.notes !== undefined) changes.notes = text(body.notes);
  if (body.issueDate !== undefined) {
    if (!DATE.test(body.issueDate)) return NextResponse.json({ error: "Data de lançamento inválida." }, { status: 400 });
    changes.issue_date = body.issueDate;
  }
  if (typeof body.isForecast === "boolean") changes.is_forecast = body.isForecast;
  if (body.reviewed) { changes.needs_review = false; changes.review_reason = null; }

  const installments = (title.finance_installments ?? []) as { id: string; amount: number; settled_amount: number; status: string }[];
  const amountChanged = body.amount !== undefined && Number(body.amount) !== Number(title.original_amount);
  if (body.dueDate !== undefined && !DATE.test(body.dueDate)) return NextResponse.json({ error: "Vencimento inválido." }, { status: 400 });
  if (amountChanged) {
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
    if (installments.length > 1) return NextResponse.json({ error: "Título com mais de uma parcela: o valor é alterado nas parcelas." }, { status: 400 });
    changes.original_amount = amount;
  }

  let accountChanged = false;
  if (body.chartAccountId !== undefined && body.chartAccountId !== title.chart_account_id) {
    const { data: account } = await guard.supabase.from("finance_chart_accounts").select("id, allows_posting, active").eq("id", body.chartAccountId).maybeSingle();
    if (!account) return NextResponse.json({ error: "Conta do plano não encontrada." }, { status: 400 });
    if (!account.allows_posting || !account.active) return NextResponse.json({ error: "Esta conta é um grupo ou está inativa: escolha uma conta que recebe lançamento." }, { status: 400 });
    changes.chart_account_id = account.id;
    accountChanged = true;
  }

  if (Object.keys(changes).length) {
    const { data: changed, error } = await guard.supabase.from("finance_titles").update(changes).eq("id", id).select("id");
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Já existe um título deste cliente com este número de documento." }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!changed?.length) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // Parcela única acompanha valor e vencimento; parcela já recebida continua recebida por inteiro.
  if (installments.length === 1 && (amountChanged || body.dueDate !== undefined)) {
    const only = installments[0];
    const next: Record<string, unknown> = {};
    if (body.dueDate !== undefined) next.due_date = body.dueDate;
    if (amountChanged) {
      const amount = changes.original_amount as number;
      next.amount = amount;
      next.settled_amount = only.status === "settled" ? amount : Math.min(Number(only.settled_amount), amount);
    }
    const { error } = await guard.supabase.from("finance_installments").update(next).eq("id", only.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Rateio: trocar a conta ou o valor volta o título para uma conta só (a atual).
  const allocations = (title.finance_title_allocations ?? []) as { chart_account_id: string }[];
  if (accountChanged || amountChanged) {
    const account = (changes.chart_account_id as string | undefined) ?? title.chart_account_id;
    if (allocations.length) {
      const { error } = await guard.supabase.from("finance_title_allocations").delete().eq("title_id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (account) {
      const { error } = await guard.supabase.from("finance_title_allocations").insert({
        organization_id: title.organization_id, title_id: id, chart_account_id: account, amount: (changes.original_amount as number | undefined) ?? title.original_amount,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }
  return NextResponse.json({ success: true });
}

/** Excluir um título: apaga o registro com parcelas e rateio. Só quem aprova na direção dele. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const found = await load(id);
  if (!found.ok) return found.error;
  const { guard, feature } = found;
  if (!guard.access.can(feature, "aprovar")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { data: removed, error } = await guard.supabase.from("finance_titles").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") return NextResponse.json({ error: "Este título tem recebimento registrado em banco. Estorne o recebimento antes de excluir, ou cancele o título." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!removed?.length) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ success: true });
}
