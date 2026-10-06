import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

const erro = (error: { code?: string; message: string }) =>
  NextResponse.json(
    { error: error.code === "P0001" || error.code === "42501" ? error.message : "Não foi possível concluir." },
    { status: error.code === "42501" ? 403 : 400 },
  );

type Corpo = {
  acao?: string;
  entryId?: string;
  entryIds?: string[];
  settlementIds?: string[];
  installmentId?: string;
  chartAccountId?: string;
  descricao?: string;
  motivo?: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ações da conciliação. As regras (quem pode, sentido pagar/receber, valor) estão nas
 * funções do banco; aqui só se confere o formato do pedido.
 */
export async function POST(request: Request) {
  const guard = await requireFeature("financeiro.bancos", "operar");
  if ("error" in guard) return guard.error;
  const corpo = (await request.json().catch(() => ({}))) as Corpo;
  const um = corpo.entryId && uuid.test(corpo.entryId) ? corpo.entryId : null;

  switch (corpo.acao) {
    case "conciliar": {
      const baixas = (corpo.settlementIds ?? []).filter((id) => uuid.test(id));
      if (!um || !baixas.length) return NextResponse.json({ error: "Escolha o lançamento e ao menos uma baixa." }, { status: 400 });
      const { data, error } = await guard.supabase.rpc("finance_reconcile_entry", { p_entry: um, p_settlements: baixas });
      return error ? erro(error) : NextResponse.json(data);
    }
    case "desfazer": {
      if (!um) return NextResponse.json({ error: "Lançamento inválido." }, { status: 400 });
      const { error } = await guard.supabase.rpc("finance_unreconcile_entry", { p_entry: um });
      return error ? erro(error) : NextResponse.json({ ok: true });
    }
    case "ignorar":
    case "reativar": {
      if (!um) return NextResponse.json({ error: "Lançamento inválido." }, { status: 400 });
      const { error } = await guard.supabase.rpc("finance_ignore_entry", { p_entry: um, p_ignore: corpo.acao === "ignorar", p_reason: corpo.motivo?.slice(0, 200) ?? null });
      return error ? erro(error) : NextResponse.json({ ok: true });
    }
    case "criar": {
      const ids = (corpo.entryIds ?? []).filter((id) => uuid.test(id));
      if (!ids.length || !corpo.chartAccountId || !uuid.test(corpo.chartAccountId)) return NextResponse.json({ error: "Escolha os lançamentos e a conta do plano." }, { status: 400 });
      const { data, error } = await guard.supabase.rpc("finance_entries_create_titles", {
        p_entries: ids,
        p_chart_account: corpo.chartAccountId,
        p_description: corpo.descricao?.slice(0, 200) ?? null,
        p_cost_center: null,
      });
      return error ? erro(error) : NextResponse.json(data);
    }
    case "baixar": {
      if (!um || !corpo.installmentId || !uuid.test(corpo.installmentId)) return NextResponse.json({ error: "Escolha o lançamento e a parcela." }, { status: 400 });
      const { data, error } = await guard.supabase.rpc("finance_entry_settle_installment", { p_entry: um, p_installment: corpo.installmentId });
      return error ? erro(error) : NextResponse.json(data);
    }
    default:
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
}
