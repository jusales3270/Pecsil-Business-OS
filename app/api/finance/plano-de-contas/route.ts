import { NextResponse } from "next/server";
import { requireFeature } from "../../../../lib/auth/feature-guard";
import { isManagementType, validateCode } from "../../../../lib/finance/plano-contas-core";
import { CHART_COLUMNS, chartError, toChartAccount, type ChartRow } from "../../../../lib/finance/plano-contas-db";

export const dynamic = "force-dynamic";

/** Plano de contas completo (inclusive inativas), na ordem dos códigos. */
export async function GET() {
  const guard = await requireFeature("financeiro.plano");
  if ("error" in guard) return guard.error;
  const { data, error } = await guard.supabase.from("finance_chart_accounts").select(CHART_COLUMNS).order("code", { nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    accounts: ((data ?? []) as ChartRow[]).map(toChartAccount),
    canEdit: guard.access.can("financeiro.plano", "operar"),
  });
}

/** Nova conta embaixo de um grupo (ou na raiz). Sem código informado, entra no próximo livre do grupo. */
export async function POST(request: Request) {
  const guard = await requireFeature("financeiro.plano", "operar");
  if ("error" in guard) return guard.error;
  const body = (await request.json().catch(() => ({}))) as { name?: string; parentId?: string | null; code?: string; managementType?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Informe o nome da conta." }, { status: 400 });
  const parentId = body.parentId || null;

  type Parent = Pick<ChartRow, "id" | "code" | "management_type" | "active">;
  let parent: Parent | null = null;
  if (parentId) {
    const { data } = await guard.supabase.from("finance_chart_accounts").select("id, code, management_type, active").eq("id", parentId).maybeSingle();
    if (!data) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
    parent = data as Parent;
  }
  // Na raiz o tipo é escolhido; dentro de um grupo, é o do grupo (pode ser trocado depois).
  const managementType = isManagementType(body.managementType) ? body.managementType : parent?.management_type;
  if (!managementType) return NextResponse.json({ error: "Escolha o tipo da conta." }, { status: 400 });

  let code = body.code?.trim() || "";
  if (code) {
    const invalid = validateCode(code, parent?.code ?? null);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  } else {
    const next = await guard.supabase.rpc("finance_next_account_code", { p_parent: parentId });
    if (next.error) { const e = chartError(next.error); return NextResponse.json({ error: e.error }, { status: e.status }); }
    code = String(next.data);
  }

  const { data: organizationId, error: orgError } = await guard.supabase.rpc("current_organization_id");
  if (orgError || !organizationId) return NextResponse.json({ error: "Organização não encontrada." }, { status: 400 });

  const { data, error } = await guard.supabase
    .from("finance_chart_accounts")
    .insert({ organization_id: organizationId, parent_id: parentId, code, name, management_type: managementType, account_type: "expense" })
    .select(CHART_COLUMNS)
    .single();
  if (error) { const e = chartError(error); return NextResponse.json({ error: e.error }, { status: e.status }); }
  return NextResponse.json({ account: toChartAccount(data as ChartRow) }, { status: 201 });
}
