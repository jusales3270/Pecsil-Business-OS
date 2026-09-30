import { NextResponse } from "next/server";
import { requireFeature } from "../../../../../lib/auth/feature-guard";
import { isManagementType, validateCode } from "../../../../../lib/finance/plano-contas-core";
import { CHART_COLUMNS, chartError, toChartAccount, type ChartRow } from "../../../../../lib/finance/plano-contas-db";

export const dynamic = "force-dynamic";

/** Editar nome, tipo gerencial, situação (ativa/inativa) ou o código, dentro da classe do grupo. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("financeiro.plano", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { name?: string; code?: string; managementType?: string; active?: boolean };

  const { data: current } = await guard.supabase.from("finance_chart_accounts").select("id, code, parent_id").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });

  const changes: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return NextResponse.json({ error: "Informe o nome da conta." }, { status: 400 });
    changes.name = body.name.trim();
  }
  if (body.managementType !== undefined) {
    if (!isManagementType(body.managementType)) return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
    changes.management_type = body.managementType;
  }
  if (typeof body.active === "boolean") changes.active = body.active;
  if (body.code !== undefined && body.code.trim() !== (current.code ?? "")) {
    const code = body.code.trim();
    const { count } = await guard.supabase.from("finance_chart_accounts").select("id", { count: "exact", head: true }).eq("parent_id", id);
    if (count) return NextResponse.json({ error: "Esta conta tem subcontas com o código dela. Para trocar de classe, arraste a conta para o grupo de destino." }, { status: 400 });
    let parentCode: string | null = null;
    if (current.parent_id) {
      const { data: parent } = await guard.supabase.from("finance_chart_accounts").select("code").eq("id", current.parent_id).maybeSingle();
      parentCode = parent?.code ?? null;
    }
    const invalid = validateCode(code, parentCode);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    changes.code = code;
  }
  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });

  const { data, error } = await guard.supabase.from("finance_chart_accounts").update(changes).eq("id", id).select(CHART_COLUMNS).maybeSingle();
  if (error) { const e = chartError(error); return NextResponse.json({ error: e.error }, { status: e.status }); }
  if (!data) return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  return NextResponse.json({ account: toChartAccount(data as ChartRow) });
}

/** Excluir: só conta sem subcontas e sem título lançado (o banco recusa e explica). */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("financeiro.plano", "operar");
  if ("error" in guard) return guard.error;
  const { id } = await context.params;
  const { error } = await guard.supabase.rpc("finance_delete_account", { p_account: id });
  if (error) { const e = chartError(error); return NextResponse.json({ error: e.error }, { status: e.status }); }
  return NextResponse.json({ ok: true });
}
