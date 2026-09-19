import { NextResponse } from "next/server";
import { dbError, requireFeature } from "../../../../lib/auth/feature-guard";

export const dynamic = "force-dynamic";

export type CostCenter = { id: string; code: string; name: string; active: boolean; departmentId: string | null; department: string | null };

type Row = Record<string, unknown>;
const relationName = (value: unknown) => {
  const row = (Array.isArray(value) ? value[0] : value) as Row | null | undefined;
  return row?.name ? String(row.name) : null;
};

/** Centros de custo: cadastro comum a todos os módulos. */
export async function GET() {
  const guard = await requireFeature("fundacao.cadastros");
  if ("error" in guard) return guard.error;
  const [centers, departments] = await Promise.all([
    guard.supabase.from("finance_cost_centers").select("id, code, name, active, department_id, departments(name)").order("code"),
    guard.supabase.from("departments").select("id, name").eq("active", true).order("name"),
  ]);
  if (centers.error) return dbError(centers.error);
  return NextResponse.json({
    centers: (centers.data ?? []).map((row) => ({
      id: row.id, code: row.code, name: row.name, active: row.active,
      departmentId: row.department_id, department: relationName(row.departments),
    })) satisfies CostCenter[],
    departments: departments.data ?? [],
    canEdit: guard.access.can("fundacao.cadastros", "operar"),
  });
}

export async function POST(request: Request) {
  const guard = await requireFeature("fundacao.cadastros", "operar");
  if ("error" in guard) return guard.error;
  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!code || !name) return NextResponse.json({ error: "Informe código e nome." }, { status: 400 });
  const { data: org } = await guard.supabase.rpc("current_organization_id");
  const { data, error } = await guard.supabase
    .from("finance_cost_centers")
    .insert({ organization_id: org, code, name, department_id: body.departmentId || null })
    .select("id")
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
